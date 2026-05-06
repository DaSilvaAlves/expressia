-- =====================================================================
-- meu-jarvis (Expressia) — Trigger SQL: auto-criação de household no signup
-- Migração: 0003_auth_user_trigger.sql
-- Data: 2026-05-06
-- Autor: Dex (@dev) — implementação Story 1.5 AC4 / Task 4
--
-- Contexto:
--   Quando um utilizador se regista (Supabase inserts row em auth.users), o
--   sistema tem de criar automaticamente:
--     1. Household default ('Casa de {username}', plan = 'familia' durante trial).
--     2. Membership em household_members (role = 'owner').
--     3. Subscription com status 'trialing' por 14 dias (Architecture §6.4).
--     4. Linha de auditoria em audit_log (action = 'household_created') — NFR9.
--
-- Decisões de design (Story 1.5 Pre-Flight defaults D1-D7, aprovados Eurico):
--   D1: Trigger SQL nativo (NÃO Database Webhook) — atómico com o auth.users insert.
--   D2: Fail-hard — se qualquer INSERT falhar, o trigger faz raise exception e o
--       insert original em auth.users é abortado (transação Supabase faz rollback).
--       Isto garante consistência: nunca há um user sem household associado.
--   D3: households.plan = 'familia' (denormalizado, espelha subscriptions.plan).
--   D4: Escreve audit_log com action 'household_created', user_id = new.id,
--       household_id do household criado, after_state com snapshot da criação.
--   D5: Valores explícitos: currency = 'EUR', locale = 'pt-PT',
--       timezone = 'Europe/Lisbon' (inegociáveis CON8/CON9/CON10).
--   D6: subscriptions.plan = 'familia' (NÃO 'pessoal') — UX premium durante trial.
--   D7: status = 'trialing', trial_ends_at = now() + 14d, current_period_*
--       espelham os 14d para compatibilidade com queries de billing.
--
-- Convenções (consistentes com 0000_initial_schema.sql e 0002_auth_hook.sql):
--   - `security definer` — corre com privilégios do owner (postgres). Necessário
--     porque o role que insere em auth.users (supabase_auth_admin) não tem
--     privilégios INSERT em public.* por defeito.
--   - `set search_path = public` — defesa contra search_path injection em SECURITY
--     DEFINER. Padrão Supabase oficial.
--   - `language plpgsql` — precisamos de variáveis (new_household_id, username)
--     e DECLARE/BEGIN/END.
--   - Idempotência: `create or replace function` + `drop trigger if exists` antes
--     de `create trigger`.
--
-- Trace: Architecture §5.3, §6.4 (trial 14d família), Story 1.5 AC4, PRD FR24, FR25, FR33.
--        Schema reference: 0000_initial_schema.sql (households linha 180,
--        household_members linha 198, subscriptions linha 249, audit_log linha 688).
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- 1. FUNÇÃO handle_new_user
-- ─────────────────────────────────────────────────────────────────────

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_household_id uuid;
  username text;
  household_name text;
begin
  -- 1. Derivar nome do household a partir do email do user.
  --    'eurico@example.com' → 'eurico' → 'Casa de eurico'
  --    Se email for null (improvável em Supabase, mas defensivo): 'Casa de utilizador'.
  username := coalesce(split_part(new.email, '@', 1), 'utilizador');
  household_name := 'Casa de ' || username;

  -- 2. Criar household default.
  --    plan = 'familia' (D3) — espelha subscriptions.plan durante trial.
  --    currency/locale/timezone explícitos (D5) — CON8/CON9/CON10 inegociáveis.
  insert into public.households (
    name, owner_user_id, plan,
    currency, locale, timezone
  )
  values (
    household_name, new.id, 'familia',
    'EUR', 'pt-PT', 'Europe/Lisbon'
  )
  returning id into new_household_id;

  -- 3. Membership: o utilizador é owner do seu household.
  insert into public.household_members (household_id, user_id, role)
  values (new_household_id, new.id, 'owner');

  -- 4. Subscription com trial 14d (D6, D7) — Architecture §6.4.
  --    plan = 'familia' (UX premium durante trial), status = 'trialing'.
  --    current_period_* espelham trial_ends_at para que queries de billing
  --    que verificam `current_period_end > now()` funcionem durante o trial.
  insert into public.subscriptions (
    household_id, plan, status, currency,
    trial_ends_at, current_period_start, current_period_end
  )
  values (
    new_household_id, 'familia', 'trialing', 'EUR',
    now() + interval '14 days',
    now(),
    now() + interval '14 days'
  );

  -- 5. Auditoria (D4) — NFR9 append-only audit log.
  --    after_state captura snapshot do que foi criado para rastreabilidade.
  insert into public.audit_log (
    household_id, user_id, action,
    entity_table, entity_id,
    before_state, after_state
  )
  values (
    new_household_id, new.id, 'household_created',
    'households', new_household_id,
    null,
    jsonb_build_object(
      'household_id', new_household_id,
      'household_name', household_name,
      'owner_user_id', new.id,
      'plan', 'familia',
      'trial_ends_at', (now() + interval '14 days')::text,
      'currency', 'EUR',
      'locale', 'pt-PT',
      'timezone', 'Europe/Lisbon',
      'created_via', 'auth.users trigger (handle_new_user)'
    )
  );

  -- D2: fail-hard. Se qualquer um dos inserts acima falhar, a exceção propaga
  -- e Supabase aborta o insert original em auth.users. Não há tratamento
  -- defensivo (try/catch + log) — preferimos consistência total a recuperação parcial.

  return new;
end;
$$;

comment on function public.handle_new_user() is
  'Trigger after insert em auth.users: cria household + membership + subscription (trial 14d família) + audit_log para o novo utilizador. Fail-hard — se falhar, registo do user é abortado. Story 1.5 AC4, Architecture §5.3, §6.4.';

-- ─────────────────────────────────────────────────────────────────────
-- 2. TRIGGER on_auth_user_created
-- ─────────────────────────────────────────────────────────────────────
-- Idempotência: drop antes de create para suportar re-aplicação da migration.

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- NOTA sobre `comment on trigger ... on auth.users`:
--   `auth.users` é owned por `supabase_auth_admin`; o role `postgres` (que aplica
--   esta migration via pooler 5432) tem privilégio TRIGGER mas NÃO é owner da
--   tabela. `comment on trigger ... on <tabela>` exige ownership da tabela —
--   logo, omitimos o comentário no trigger. A descrição completa fica no
--   `comment on function public.handle_new_user()` acima.
