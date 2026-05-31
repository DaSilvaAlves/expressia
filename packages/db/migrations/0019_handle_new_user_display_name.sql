-- =====================================================================
-- meu-jarvis (Expressia) — Trigger SQL: nome próprio no signup
-- Migração: 0019_handle_new_user_display_name.sql
-- Data: 2026-06-01
-- Autor: Orion (@aiox-master) — make-it-work display_name no onboarding
--
-- Contexto:
--   O registo passou a capturar o nome do utilizador (campo "Nome" obrigatório
--   em `registar/page.tsx` → `signUpAction` grava em `options.data.name`, que o
--   Supabase persiste em `auth.users.raw_user_meta_data->>'name'`).
--
--   Esta migração recria `handle_new_user` para:
--     1. Ler o nome de `new.raw_user_meta_data->>'name'` (trim; null se vazio).
--     2. Preencher `household_members.display_name` com esse nome → a lista de
--        membros em `/conta/household` deixa de cair no email.
--     3. Usar o PRIMEIRO nome no household default: 'Casa de {primeiro nome}'
--        (ex.: 'Casa de João') em vez de 'Casa de {parte-local-do-email}'.
--        Fallback para a parte local do email se o nome não vier (defensivo).
--
--   IMPORTANTE — esta função é a EVOLUÇÃO da 0018 (não da 0003). Preserva
--   byte-a-byte os passos da 0018: conta "Dinheiro" default (3b, Story 2.13 /
--   GAP-6) + audit 'account.created' (5b) + fail-hard D2. Só ALTERA: derivação
--   do nome, household_name, e o display_name no INSERT de household_members.
--   O backfill de contas da 0018 NÃO se repete aqui (já correu).
--
-- Idempotência: `create or replace function` — re-aplicação segura. O trigger
--   `on_auth_user_created` (0003) já aponta para esta função; não é recriado.
--
-- Trace: 0018 (base imediata) + 0003 (origem); Story 6.1 / Story 2.13;
--        tenancy.ts (household_members.display_name); greeting.ts
--        (resolveDisplayName); api/conta/household/route.ts (fullName ← display_name).
-- =====================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_household_id uuid;
  new_account_id uuid;
  username text;
  member_display_name text;
  household_owner_label text;
  household_name text;
begin
  -- 1. Nome do utilizador a partir do metadata do signup (options.data.name).
  --    `nullif(trim(...), '')` → null quando ausente ou só espaços.
  member_display_name := nullif(trim(new.raw_user_meta_data->>'name'), '');

  -- 2. Etiqueta do household: primeiro nome se houver, senão parte local do email.
  --    'João Silva' → 'João'; sem nome → 'eurico' (de eurico@example.com).
  username := coalesce(split_part(new.email, '@', 1), 'utilizador');
  household_owner_label := coalesce(
    nullif(split_part(member_display_name, ' ', 1), ''),
    username
  );
  household_name := 'Casa de ' || household_owner_label;

  -- 3. Criar household default.
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

  -- 4. Membership: o utilizador é owner, com o seu display_name preenchido
  --    (Story 6.1 — antes ficava null e a lista de membros caía no email).
  insert into public.household_members (household_id, user_id, role, display_name)
  values (new_household_id, new.id, 'owner', member_display_name);

  -- 3b/4b. Conta financeira default "Dinheiro" (Story 2.13 AC1 — GAP-6).
  --     Sem isto, o utilizador novo tem 0 contas e toda a criação de despesas
  --     via chat falha no CHECK `transactions_account_or_card`. account_type=
  --     'dinheiro' (cash físico) já existe no enum. balance/initial_balance = 0.
  --     household_id herda new_household_id → coberta pelas RLS de accounts
  --     (NFR5, zero policy nova). Mesmo bloco fail-hard (D2).
  insert into public.accounts (
    household_id, name, account_type,
    currency, balance_cents, initial_balance_cents
  )
  values (
    new_household_id, 'Dinheiro', 'dinheiro',
    'EUR', 0, 0
  )
  returning id into new_account_id;

  -- 5. Subscription com trial 14d (D6, D7) — Architecture §6.4.
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

  -- 6. Auditoria (D4) — NFR9 append-only audit log (household_created).
  --    after_state inclui agora owner_display_name (Story 6.1).
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
      'owner_display_name', member_display_name,
      'plan', 'familia',
      'trial_ends_at', (now() + interval '14 days')::text,
      'currency', 'EUR',
      'locale', 'pt-PT',
      'timezone', 'Europe/Lisbon',
      'created_via', 'auth.users trigger (handle_new_user, 0019)'
    )
  );

  -- 6b. Auditoria da conta default (Story 2.13 — NFR9).
  insert into public.audit_log (
    household_id, user_id, action,
    entity_table, entity_id,
    before_state, after_state
  )
  values (
    new_household_id, new.id, 'account.created',
    'accounts', new_account_id,
    null,
    jsonb_build_object(
      'account_id', new_account_id,
      'household_id', new_household_id,
      'name', 'Dinheiro',
      'account_type', 'dinheiro',
      'currency', 'EUR',
      'balance_cents', 0,
      'created_via', 'auth.users trigger (handle_new_user) — conta default GAP-6'
    )
  );

  -- D2: fail-hard — qualquer falha aborta o insert em auth.users (rollback).
  -- Um household nunca fica sem conta nem sem membership.

  return new;
end;
$$;

comment on function public.handle_new_user() is
  'Trigger after insert em auth.users: cria household (Casa de {primeiro nome}) + membership owner (display_name de raw_user_meta_data.name) + conta Dinheiro default + subscription (trial 14d família) + audit_log. Fail-hard. Story 1.5 AC4 + Story 2.13 AC1 (conta default GAP-6) + Story 6.1 (display_name no onboarding). Migração 0019 (recria 0018).';
