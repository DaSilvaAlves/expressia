-- =====================================================================
-- meu-jarvis (Expressia) — Fix RLS: policy SELECT de household_invites
--   deixar de aceder a `auth.users` INLINE (permission denied 42501).
-- Migração: 0024_fix_invites_select_policy_auth_users.sql
-- Data: 2026-06-19
-- Autor: orchestrator (/sdc) — hotfix de bug de produção apanhado pelo
--        smoke E2E de convites (INVITE-E2E).
--
-- Causa-raiz (evidência: Vercel runtime log, prod expressia.pt):
--   A policy `household_invites_select_household_or_invited` (0001:117-124)
--   tinha a cláusula:
--       or email = (select email from auth.users where id = auth.uid())
--   Essa subconsulta corre no contexto do role `authenticated`, que NÃO tem
--   SELECT em `auth.users`. Resultado em runtime:
--       SQLSTATE 42501 — "permission denied for table users"
--   Isto partia DOIS caminhos do utilizador:
--     1. GET  /api/conta/household/invites  (SELECT directo → avalia a policy).
--     2. POST /api/conta/household/invites  (INSERT ... RETURNING → o RETURNING
--        avalia a policy SELECT nas rows devolvidas → mesmo erro).
--   Sintoma visível: "Erro ao criar o convite. Tenta novamente." + a lista de
--   convites pendentes nunca carregava ("Sem convites pendentes").
--
--   NOTA: o `GRANT SELECT ON auth.users TO authenticated` sugerido pelo hint do
--   Postgres seria INSEGURO — exporia o email de TODOS os utilizadores ao role
--   authenticated, violando o isolamento multi-tenant (NFR5). Rejeitado.
--
-- Fix (mesmo padrão das funções RLS canónicas do schema —
--   is_household_member / is_household_owner_or_admin / accept_invite):
--   Encapsular o lookup numa função `public.current_user_email()`
--   SECURITY DEFINER que devolve APENAS o email do próprio utilizador
--   autenticado (`where id = auth.uid()`). A função corre como o owner (que tem
--   acesso a auth.users); não expõe a tabela nem emails de terceiros. Recriar a
--   policy a usá-la em vez da subconsulta inline.
--
-- Idempotência: `create or replace function` + `drop policy if exists` antes do
--   `create policy`. Re-aplicação segura.
--
-- Trace: 0001_rls_policies.sql:117-126; 0000_initial_schema.sql:51-87 (padrão
--   SECURITY DEFINER); memória auth_users_not_joinable; Story INVITE-E2E (smoke).
-- =====================================================================

set local check_function_bodies = off;

-- ─── Função: email do utilizador autenticado (SECURITY DEFINER) ──────
create or replace function public.current_user_email()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select email from auth.users where id = auth.uid()
$$;

comment on function public.current_user_email() is
  'Devolve o email do utilizador autenticado (auth.uid()). SECURITY DEFINER para ler auth.users sem expor a tabela ao role authenticated — devolve apenas o email do PRÓPRIO utilizador. Usado em RLS policies que comparam com o email do utilizador (ex.: household_invites_select_household_or_invited).';

-- ─── Recriar a policy SELECT de household_invites sem auth.users inline ──
drop policy if exists "household_invites_select_household_or_invited" on public.household_invites;

create policy "household_invites_select_household_or_invited"
  on public.household_invites for select
  to authenticated
  using (
    public.is_household_member(household_id)
    -- Convidado pode ver o seu próprio convite mesmo antes de fazer accept.
    -- Via current_user_email() SECURITY DEFINER (NÃO acede auth.users inline → evita 42501).
    or email = public.current_user_email()
  );

comment on policy "household_invites_select_household_or_invited" on public.household_invites is
  'Membros do household vêem convites enviados; convidado vê o próprio convite (via current_user_email() SECURITY DEFINER, sem aceder auth.users inline).';
