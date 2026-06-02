-- =====================================================================
-- meu-jarvis (Expressia) — SQL function: accept_invite(p_token, p_user_id)
-- Migração: 0022_accept_invite_user_param.sql
-- Data: 2026-06-02
-- Autor: Dex (@dev) — Fix ACHADO-1 (Story 6.7 reaberta como bug)
--
-- Contexto / Causa raiz (ACHADO-1, smoke INVITE-E2E 02/06/2026):
--   A versão da 0020 fazia `v_user_id := auth.uid()`. Porém o `getDb()` runtime
--   liga como role `postgres` (DATABASE_URL, pgbouncer 6543) SEM injectar
--   `request.jwt.claims` → `auth.uid()` = NULL → a função levantava
--   `AUTH_REQUIRED` e a UI mostrava "Sessão inválida" apesar de a sessão do
--   browser ser VÁLIDA. Os testes db-test passavam porque o harness simula o JWT
--   via `set_config('request.jwt.claims', …, true)`; o runtime real não o faz.
--   accept_invite() era a 1ª função a depender de auth.uid() server-side — todas
--   as rotas anteriores contornam isto passando household_id/user_id EXPLÍCITOS
--   no SQL (padrão app-enforced, reforçado pela SEC-1).
--
-- Fix (idiomático ao codebase, app-enforced):
--   Passar o utilizador EXPLICITAMENTE como parâmetro `p_user_id`. O handler já
--   valida a sessão via `supabase.auth.getUser()` e passa `user.id`. A guarda de
--   `p_user_id is null` mantém-se (defesa em profundidade). TODAS as restantes
--   validações de segurança da 0020 são preservadas SEM enfraquecimento:
--     - token válido / não expirado / não usado;
--     - email-match (D-6.7.2 — convite nominal);
--     - já-membro (PK composta);
--     - limite de membros por plano com lock transaccional (R-6.5).
--
--   [DEV-DECISION D-6.7.6] Assinatura antiga `accept_invite(text)`: DROP nesta
--     migração. Justificação: só a rota /aceitar-convite a usa, e o handler passa
--     a chamar a nova assinatura (2 args). Manter ambas criaria overload ambíguo
--     desnecessário. O DROP é idempotente (`if exists`) e seguro em re-aplicação.
--
--   [DEV-DECISION D-6.7.7] auth.uid() removido por completo: o handler é a fonte
--     de verdade da identidade (sessão validada). Não há `raise AUTH_REQUIRED` por
--     NULL de auth.uid() — substituído por guarda em `p_user_id is null` (que só
--     dispara se o handler chamar mal). Mantém-se SECURITY DEFINER para ler
--     auth.users (email-match) e inserir membership cross-household controlado.
--
-- Nota de design (multi-household, NÃO-bloqueante — herdado do handoff):
--   Todo o signup cria household próprio (trigger handle_new_user). Logo, aceitar
--   um convite põe o utilizador em DOIS households. Isto NÃO é resolvido aqui
--   (fora de âmbito do fix). A função insere a membership adicional normalmente;
--   o /conta/household mostra o household do JWT. Tratamento do household activo
--   fica para follow-up de produto.
--
-- Idempotência: `create or replace function` + `drop function if exists`.
--
-- Trace: ACHADO-1 (handoff mj-handoff-smoke-6.7-blocked-authuid-rls-20260602);
--        Story 6.7 AC1; FR27; architecture §5.3/§6.4; R-6.5; SEC-1 (app-enforced).
-- =====================================================================

-- Remove a assinatura antiga (1 arg) para evitar overload ambíguo (D-6.7.6).
drop function if exists public.accept_invite(text);

create or replace function public.accept_invite(p_token text, p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.household_invites%rowtype;
  v_user_id uuid;
  v_user_email text;
  v_user_name text;
  v_plan public.plan_tier;
  v_limit integer;
  v_count integer;
begin
  -- Identidade vem EXPLICITAMENTE do handler (sessão já validada server-side).
  -- Guarda defensiva: o handler nunca deve chamar com NULL (defesa em profundidade).
  v_user_id := p_user_id;
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  -- 1. Localizar o convite e bloquear a row (evita dupla aceitação concorrente).
  select * into v_invite
  from public.household_invites
  where token = p_token
  for update;

  if not found then
    raise exception 'INVITE_NOT_FOUND';
  end if;

  -- 2. Estado do convite.
  if v_invite.accepted_at is not null then
    raise exception 'INVITE_ALREADY_ACCEPTED';
  end if;
  if v_invite.expires_at <= now() then
    raise exception 'INVITE_EXPIRED';
  end if;

  -- 3. Email do convite tem de corresponder ao do utilizador autenticado (D-6.7.2).
  select email, nullif(trim(raw_user_meta_data->>'name'), '')
    into v_user_email, v_user_name
  from auth.users
  where id = v_user_id;

  if v_user_email is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  -- Comparação case- e whitespace-insensitive (defesa em profundidade vs emails
  -- com espaços acidentais; CodeRabbit MINOR sobre a 0022).
  if lower(trim(v_invite.email)) <> lower(trim(v_user_email)) then
    raise exception 'INVITE_EMAIL_MISMATCH';
  end if;

  -- 4. Já é membro deste household? (evita violar a PK composta.)
  if exists (
    select 1 from public.household_members
    where household_id = v_invite.household_id
      and user_id = v_user_id
  ) then
    raise exception 'ALREADY_MEMBER';
  end if;

  -- 5. Limite de membros por plano — lock no household (R-6.5, defesa em profundidade).
  select plan into v_plan
  from public.households
  where id = v_invite.household_id
  for update;

  v_limit := case v_plan
    when 'pessoal' then 1
    when 'familia' then 4
    when 'pro' then 10
    else 1 -- 'free' (D-6.7.1)
  end;

  select count(*) into v_count
  from public.household_members
  where household_id = v_invite.household_id;

  if v_count >= v_limit then
    raise exception 'MEMBER_LIMIT_REACHED';
  end if;

  -- 6. Inserir membership (display_name herda o nome do signup, se houver).
  insert into public.household_members (household_id, user_id, role, display_name)
  values (v_invite.household_id, v_user_id, v_invite.role, v_user_name);

  -- 7. Marcar o convite como aceite.
  update public.household_invites
  set accepted_at = now(),
      accepted_by_user_id = v_user_id
  where id = v_invite.id;

  -- 8. Auditoria (NFR9) — household_invite_accepted já existe no enum (0000).
  insert into public.audit_log (
    household_id, user_id, action, entity_table, entity_id, after_state
  )
  values (
    v_invite.household_id, v_user_id, 'household_invite_accepted',
    'household_invites', v_invite.id,
    jsonb_build_object(
      'invite_id', v_invite.id,
      'email', v_invite.email,
      'role', v_invite.role,
      'accepted_via', 'accept_invite(p_token, p_user_id) SECURITY DEFINER'
    )
  );

  return v_invite.household_id;
end;
$$;

comment on function public.accept_invite(text, uuid) is
  'Aceita um convite por token para o utilizador p_user_id (identidade fornecida pelo handler, app-enforced): valida estado/expiração/email/limite-de-plano e cria household_members atomicamente (lock vs R-6.5). SECURITY DEFINER. Fix ACHADO-1 (auth.uid() era NULL via getDb runtime). Story 6.7 (FR27). Erros tipados: INVITE_NOT_FOUND/ALREADY_ACCEPTED/EXPIRED/EMAIL_MISMATCH/ALREADY_MEMBER, MEMBER_LIMIT_REACHED, AUTH_REQUIRED.';

-- A função é invocada via getDb() — sem este GRANT a chamada falha com
-- "permission denied for function accept_invite".
grant execute on function public.accept_invite(text, uuid) to authenticated;
