-- =====================================================================
-- meu-jarvis (Expressia) — Custom Access Token Hook
-- Migração: 0002_auth_hook.sql
-- Data: 2026-05-06
-- Autora: Dara (@data-engineer)
--
-- Contexto:
--   - Architecture §5.2: Supabase Auth Hook injecta `household_id` no JWT
--     em cada login. Esta função é o ponto de entrada do multi-tenant
--     em runtime — sem ela `current_household_id()` (helper RLS) não
--     consegue ler o claim e todas as policies bloqueiam acesso.
--   - Story 1.5 AC3 / Task 3: materializar a função SQL especificada na
--     architecture, aplicar grants Supabase obrigatórios para Auth Hooks,
--     deixar pronto para registo manual em Dashboard → Auth → Hooks.
--
-- Convenção:
--   - `security definer` + `set search_path = public`: padrão dos
--     helpers RLS (ver `current_household_id`, `is_household_member`
--     em 0000_initial_schema.sql). Necessário porque o role
--     `supabase_auth_admin` não tem privilégios de leitura sobre
--     tabelas `public.*` por defeito e o hook tem de funcionar antes
--     de qualquer JWT/RLS estar estabelecido.
--   - `stable`: a função não modifica estado, apenas lê + devolve jsonb.
--   - Idempotência: `create or replace function`.
--
-- Grants Supabase Auth Hooks (protocolo oficial):
--   1. `grant usage on schema public to supabase_auth_admin` — acesso ao schema
--   2. `grant execute on function ... to supabase_auth_admin` — invocar a função
--   3. `revoke execute ... from authenticated, anon, public` — só Auth invoca
--   4. `grant select on public.household_members to supabase_auth_admin` —
--      ler memberships do utilizador (a função usa `security definer`, mas
--      damos o grant explícito por defesa em profundidade)
--
-- Trace: architecture §5.2, Story 1.5 AC3, PRD FR1, NFR5.
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- 1. FUNÇÃO custom_access_token_hook
-- ─────────────────────────────────────────────────────────────────────

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  claims jsonb;
  default_household uuid;
begin
  claims := event->'claims';
  -- household_id default = primeiro membership do user (ordenado por joined_at).
  -- NOTA: a spec architecture §5.2 indicava `order by created_at`, mas o
  -- schema canónico (0000_initial_schema.sql) usa `joined_at` em
  -- household_members. Semanticamente equivalente — "primeiro membership
  -- por ordem temporal". Ground truth = schema aplicado.
  -- Mudança de household activo no runtime é feita via endpoint dedicado
  -- (POST /api/auth/switch-household) que reescreve o JWT — fora deste hook.
  select hm.household_id into default_household
  from public.household_members hm
  where hm.user_id = (event->>'user_id')::uuid
  order by hm.joined_at asc
  limit 1;

  if default_household is not null then
    claims := jsonb_set(claims, '{household_id}', to_jsonb(default_household));
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$$;

comment on function public.custom_access_token_hook(jsonb) is
  'Supabase Auth Hook (architecture §5.2): injecta `household_id` (primeiro membership do user) no JWT custom claim em cada login. Habilita `current_household_id()` e todas as RLS policies multi-tenant. Registar em Dashboard → Auth → Hooks após aplicar esta migration.';

-- ─────────────────────────────────────────────────────────────────────
-- 2. GRANTS Supabase Auth Hooks
-- ─────────────────────────────────────────────────────────────────────

-- Garantir que o role do Auth pode ver o schema public.
grant usage on schema public to supabase_auth_admin;

-- Permitir que apenas o role Auth invoque a função.
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;

-- Defesa em profundidade: a função usa `security definer` (corre com
-- privilégios do owner postgres), mas concedemos SELECT explícito para
-- alinhar com o padrão recomendado do Supabase para Auth Hooks que lêem
-- tabelas de domínio.
grant select on table public.household_members to supabase_auth_admin;
