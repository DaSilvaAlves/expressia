-- =====================================================================
-- meu-jarvis (Expressia) — Conta "Dinheiro" default no onboarding + backfill
-- Migração: 0018_finance_default_account_onboarding_backfill.sql
-- Data: 2026-05-30
-- Autor: Dara (@data-engineer) — implementação Story 2.13 T1 (GAP-6, ADR-002 §3/§4)
--
-- Contexto (GAP-6):
--   O teste E2E de 30/05/2026 provou que todo o subsistema Finanças via chat
--   está bloqueado: utilizador novo tem 0 contas (o trigger `handle_new_user`
--   da migration 0003 cria household + members + subscription + audit_log mas
--   NENHUMA conta financeira), logo o fallback `resolveDefaultAccount` não tem
--   nada para resolver e a tool `create_finance_variable` falha no CHECK
--   `transactions_account_or_card`.
--
--   Esta migration resolve a "Peça 3" da causa raiz (ADR-002 §1) em duas frentes:
--     (1) ONBOARDING: estende `handle_new_user` para criar uma conta "Dinheiro"
--         por household, logo após o INSERT do household (D2 fail-hard mantido).
--     (2) BACKFILL: cria a conta "Dinheiro" para os households JÁ existentes que
--         ainda não têm nenhuma conta (idempotente via WHERE NOT EXISTS).
--
-- Decisões de design (Story 2.13 AC1/AC2, ADR-002 §3/§4):
--   - `CREATE OR REPLACE FUNCTION` (sem DROP) — preserva o trigger
--     `on_auth_user_created` existente, que continua a apontar para a mesma
--     função. Evita janela em que o trigger fica sem função associada.
--   - A conta default herda `household_id = new_household_id` → coberta pelas
--     4 RLS policies EXISTENTES de `accounts` (0001_rls_policies.sql:441-456).
--     ZERO policy nova → NFR5 (RLS Coverage Gate) NÃO regride. A tabela
--     `accounts` não é nova e o schema TS não muda — `pnpm check:rls` verde.
--   - `account_type = 'dinheiro'` JÁ existe no enum `account_type`
--     (finance.ts:39-46) — ZERO ALTER TYPE. Só INSERT de dados.
--   - `created_by_user_id` NÃO existe na tabela `accounts` (finance.ts:82-114) —
--     o INSERT não a refere (confirmado byte-a-byte, ADR-002 §4 ponto 3).
--   - Auditoria: regista `account.created` em audit_log (valor já no enum desde
--     a migration 0014) — coerência NFR9 append-only com o snapshot existente.
--   - Mantém `security definer` + `set search_path = public` + bloco fail-hard
--     (D2) do trigger original (0003). O INSERT da conta corre dentro do mesmo
--     bloco: se falhar, todo o onboarding faz rollback (melhor falhar cedo do
--     que criar household sem conta).
--   - Colunas NOT NULL de `accounts` cobertas: `household_id`, `name`,
--     `account_type`, `balance_cents` (default 0), `initial_balance_cents`
--     (default 0), `currency` (default 'EUR'), `created_at`/`updated_at`
--     (defaultNow). Valores explícitos para name/type/currency/balances.
--
-- Idempotência:
--   - O trigger usa `CREATE OR REPLACE` — re-aplicação é safe.
--   - O backfill usa `INSERT … SELECT … WHERE NOT EXISTS` — re-execução não
--     duplica (households que já ganharam conta no 1.º run são ignorados no 2.º).
--   - Tracking via __schema_migrations (apply-migrations.ts runner). O runner
--     já faz `set local check_function_bodies = off` por ficheiro (gotcha
--     conhecido, apply-migrations.ts:94) — não é necessário repetir aqui.
--
-- Caminho de execução (admin / ignora RLS — intencional):
--   - O trigger corre `security definer` (privilégios do owner postgres).
--   - O backfill corre via runner com `DIRECT_URL` (role de migration / admin
--     path) — ignora RLS legitimamente (alinhado com `getServiceDb()` em
--     migrations/jobs, CLAUDE.md §multi-tenancy). Cada INSERT do backfill
--     carrega o `household_id` EXPLÍCITO derivado do SELECT de `households` —
--     zero cross-household (R-2.13.2 mitigado).
--
-- Trace: Story 2.13 T1, AC1, AC2. ADR-002 §3/§4 (Aria, @architect). Evidência
--        `docs/E2E-FINANCE-CHAT-GAP-20260530.md` (GAP-6). Directiva
--        `refocus_core_before_billing` — CORE, prioridade ALTA.
--        Schema reference: finance.ts (accounts, accountTypeEnum='dinheiro'),
--        0003_auth_user_trigger.sql (handle_new_user original).
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- 1. ESTENDER handle_new_user — conta "Dinheiro" default no onboarding (AC1)
-- ─────────────────────────────────────────────────────────────────────
-- CREATE OR REPLACE preserva o trigger on_auth_user_created (0003) intacto.
-- Mudança face ao 0003: adicionado o passo "3b" (INSERT conta Dinheiro) e o
-- respectivo audit_log 'account.created'. Tudo o resto (household, member,
-- subscription, audit household_created, fail-hard) é mantido byte-a-byte.

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

  -- 3b. Conta financeira default "Dinheiro" (Story 2.13 AC1 — GAP-6).
  --     Sem isto, o utilizador novo tem 0 contas e toda a criação de despesas
  --     via chat falha no CHECK `transactions_account_or_card` (não há conta
  --     nem cartão para o fallback resolver). account_type='dinheiro' (cash
  --     físico) já existe no enum. balance/initial_balance = 0 (cents).
  --     household_id herda new_household_id → coberta pelas RLS policies de
  --     accounts (NFR5, zero policy nova). Corre dentro do mesmo bloco
  --     fail-hard (D2): se falhar, todo o onboarding faz rollback.
  insert into public.accounts (
    household_id, name, account_type,
    currency, balance_cents, initial_balance_cents
  )
  values (
    new_household_id, 'Dinheiro', 'dinheiro',
    'EUR', 0, 0
  )
  returning id into new_account_id;

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

  -- 5. Auditoria (D4) — NFR9 append-only audit log (household_created).
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

  -- 5b. Auditoria da conta default (Story 2.13 — NFR9).
  --     Rastreia que a conta Dinheiro foi criada pelo onboarding (não pelo
  --     utilizador via UI), espelhando o padrão do audit household_created.
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

  -- D2: fail-hard. Se qualquer um dos inserts acima falhar (incluindo o da
  -- conta Dinheiro), a exceção propaga e Supabase aborta o insert original em
  -- auth.users. Não há tratamento defensivo (try/catch + log) — preferimos
  -- consistência total a recuperação parcial. Um household nunca fica sem conta.

  return new;
end;
$$;

comment on function public.handle_new_user() is
  'Trigger after insert em auth.users: cria household + membership + conta Dinheiro default + subscription (trial 14d família) + audit_log para o novo utilizador. Fail-hard — se falhar, registo do user é abortado. Story 1.5 AC4 + Story 2.13 AC1 (conta default GAP-6), Architecture §5.3, §6.4.';

-- ─────────────────────────────────────────────────────────────────────
-- 2. BACKFILL idempotente — conta "Dinheiro" para households legacy (AC2)
-- ─────────────────────────────────────────────────────────────────────
-- Households criados ANTES desta migration não têm conta nenhuma. Sem backfill,
-- o fallback `resolveDefaultAccount` lança ToolExecutionError (precedência nível
-- 3) e o chat de Finanças continua bloqueado para esses households.
--
-- Idempotência: `WHERE NOT EXISTS (… accounts a WHERE a.household_id = h.id)`.
-- Re-run não duplica: households que já tenham QUALQUER conta (a default desta
-- migration, ou contas criadas manualmente) são ignorados. Critério "tem alguma
-- conta" (não "tem conta dinheiro") é deliberado — se o household já criou uma
-- conta própria, o fallback nível 2 (conta mais antiga) resolve; não impomos
-- uma conta Dinheiro a quem já se organizou.
--
-- household_id EXPLÍCITO por linha (derivado de h.id) — zero cross-household.
-- Corre via runner com DIRECT_URL (admin path, ignora RLS — intencional).

insert into public.accounts (
  household_id, name, account_type,
  currency, balance_cents, initial_balance_cents
)
select
  h.id, 'Dinheiro', 'dinheiro',
  'EUR', 0, 0
from public.households h
where not exists (
  select 1 from public.accounts a where a.household_id = h.id
);

-- Nota: o backfill NÃO escreve audit_log por household. O audit
-- 'household_created'/'account.created' destina-se ao evento de onboarding em
-- tempo real (com user_id do owner). Para o backfill (operação de dados em
-- massa, sem actor utilizador), a rastreabilidade fica neste ficheiro de
-- migration + no tracking __schema_migrations. Coerente com o padrão de
-- backfills anteriores (data migrations não poluem o audit append-only do
-- utilizador). Documentar no handoff de deploy (PO-FIX-C): a 0018 corre
-- backfill sobre TODOS os households existentes.
