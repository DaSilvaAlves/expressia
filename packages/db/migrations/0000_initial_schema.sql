-- =====================================================================
-- meu-jarvis (Expressia) — Schema inicial
-- Migração: 0000_initial_schema.sql
-- Data: 2026-05-04
-- Autora: Dara (@data-engineer)
--
-- Conteúdo:
--   1. Extensões Postgres
--   2. Helpers SQL (funções current_household_id, is_household_member, set_updated_at)
--   3. Enums de domínio
--   4. Tabelas (tenancy → billing → agent → tasks → finance → audit)
--   5. Triggers (set_updated_at em todas as tabelas com updated_at)
--
-- RLS: ver migração 0001_rls_policies.sql (aplicada imediatamente a seguir).
-- Trace: PRD FR1-FR36, NFR5-NFR12, architecture §3, §5.
-- Idempotência: usa CREATE ... IF NOT EXISTS / CREATE OR REPLACE onde possível.
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- 1. EXTENSÕES
-- ─────────────────────────────────────────────────────────────────────

create extension if not exists "pgcrypto" with schema public;     -- gen_random_uuid()
create extension if not exists "pg_stat_statements";              -- métricas DB
-- pgvector preparado (Fase 3) — não usado no MVP mas activado conforme architecture §11.2
create extension if not exists "vector" with schema public;

-- ─────────────────────────────────────────────────────────────────────
-- 2. HELPERS SQL (RLS + audit)
-- ─────────────────────────────────────────────────────────────────────

-- Devolve o household_id activo (do JWT custom claim, ou GUC para scripts).
-- Ver architecture §3.2 e §5.2.
create or replace function public.current_household_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true)::json->>'household_id', ''),
    nullif(current_setting('app.current_household_id', true), '')
  )::uuid
$$;

comment on function public.current_household_id() is
  'Devolve o UUID do household activo na sessão (JWT claim ou GUC). Usado em RLS policies.';

-- Verifica se o utilizador autenticado é membro do household alvo.
create or replace function public.is_household_member(target_household uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.household_members hm
    where hm.user_id = auth.uid()
      and hm.household_id = target_household
  )
$$;

comment on function public.is_household_member(uuid) is
  'Retorna true se o utilizador autenticado pertence ao household alvo. Base de todas as RLS policies de domínio.';

-- Verifica se o utilizador autenticado é owner ou admin do household.
create or replace function public.is_household_owner_or_admin(target_household uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.household_members hm
    where hm.user_id = auth.uid()
      and hm.household_id = target_household
      and hm.role in ('owner', 'admin')
  )
$$;

comment on function public.is_household_owner_or_admin(uuid) is
  'Retorna true se o utilizador autenticado é owner ou admin do household. Usado em DELETE policies e operações sensíveis.';

-- Trigger genérico para auto-actualizar updated_at em qualquer tabela.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Trigger BEFORE UPDATE — actualiza updated_at automaticamente.';

-- ─────────────────────────────────────────────────────────────────────
-- 3. ENUMS
-- ─────────────────────────────────────────────────────────────────────

-- Tenancy
create type plan_tier as enum ('free', 'pessoal', 'familia', 'pro');
create type household_role as enum ('owner', 'admin', 'member');

-- Billing
create type subscription_status as enum (
  'trialing', 'active', 'past_due', 'past_due_pending',
  'canceled', 'incomplete', 'incomplete_expired', 'unpaid'
);
create type payment_method_type as enum ('card', 'multibanco', 'mb_way');
create type invoice_status as enum ('draft', 'open', 'paid', 'void', 'uncollectible');

-- Agent
create type agent_run_status as enum (
  'classifying', 'pending_preview', 'confirmed', 'executing',
  'success', 'failed', 'reverted'
);
create type agent_intent as enum (
  'criar_tarefa', 'criar_financa_variavel', 'criar_financa_recorrente',
  'criar_cartao', 'criar_parcelada', 'consultar_dados',
  'cancelar_ultima', 'unknown'
);
create type llm_model as enum ('gpt-4o-mini', 'claude-sonnet-4-5', 'claude-opus-4-7');

-- Tasks
create type task_priority as enum ('low', 'medium', 'high');
create type task_status as enum ('todo', 'doing', 'done', 'archived');
create type recurrence_frequency as enum (
  'daily', 'weekdays', 'weekends', 'weekly', 'biweekly',
  'monthly', 'yearly', 'custom'
);

-- Finance
create type account_type as enum (
  'corrente', 'poupanca', 'credito_consignado',
  'investimentos', 'dinheiro', 'outro'
);
create type card_type as enum ('credit', 'debit');
create type category_kind as enum ('expense', 'income', 'transfer');
create type transaction_kind as enum ('expense', 'income', 'transfer');
create type payment_method_finance as enum (
  'cash', 'card', 'transfer', 'direct_debit',
  'multibanco', 'mb_way', 'other'
);
create type recurrence_freq_finance as enum (
  'daily', 'weekly', 'biweekly', 'monthly',
  'quarterly', 'yearly', 'custom'
);

-- Audit
create type audit_action as enum (
  'login', 'logout', 'password_change', 'mfa_enabled', 'mfa_disabled',
  'plan_changed', 'invoice_paid', 'payment_failed',
  'data_export_requested', 'data_export_completed',
  'account_deletion_requested', 'account_deletion_canceled', 'account_deletion_executed',
  'household_created', 'household_invite_sent', 'household_invite_accepted',
  'household_invite_revoked', 'household_member_removed', 'household_role_changed',
  'agent_run_executed', 'agent_run_reverted'
);
create type data_export_status as enum (
  'pending', 'generating', 'ready', 'expired', 'failed'
);
create type account_deletion_status as enum (
  'scheduled', 'canceled', 'in_progress', 'completed', 'failed'
);

-- ─────────────────────────────────────────────────────────────────────
-- 4. TABELAS
-- ─────────────────────────────────────────────────────────────────────

-- ─── Tenancy ────────────────────────────────────────────────────────

-- Households (raiz multi-tenant)
create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  plan plan_tier not null default 'free',
  locale text not null default 'pt-PT',
  timezone text not null default 'Europe/Lisbon',
  currency text not null default 'EUR',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint households_currency_eur_only check (currency = 'EUR'),
  constraint households_locale_pt_only check (locale = 'pt-PT')
);
create index households_owner_idx on public.households(owner_user_id);
comment on table public.households is
  'Unidade de tenancy. Multi-tenant por household (CON2). Plan denormalizado para fast-path RLS/quotas.';

-- Household members (pivot)
create table public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role household_role not null default 'member',
  display_name text,
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id)
);
create index household_members_user_idx on public.household_members(user_id);
create index household_members_household_idx on public.household_members(household_id);
comment on table public.household_members is
  'Pivot user × household. Limites de membros por plano enforced em SQL function accept_invite().';

-- Household invites
create table public.household_invites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  invited_by_user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  role household_role not null default 'member',
  token text not null unique,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint household_invites_unique_pending unique (household_id, email)
);
create index household_invites_household_idx on public.household_invites(household_id);
create index household_invites_email_idx on public.household_invites(email);
create index household_invites_token_idx on public.household_invites(token);
comment on table public.household_invites is
  'Convites por email com token aleatório (FR27). Expira em 7d. Revogável até accept.';

-- Kanban columns (FR9 — colunas customizáveis por household)
create table public.kanban_columns (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  color text not null default '#6B7280',
  is_done_column text not null default 'false',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint kanban_columns_unique_order unique (household_id, sort_order)
);
create index kanban_columns_household_idx on public.kanban_columns(household_id);
comment on table public.kanban_columns is
  'Colunas Kanban customizáveis por household (FR9). is_done_column marca a coluna que move para status done.';

-- ─── Billing ────────────────────────────────────────────────────────

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text unique,
  plan plan_tier not null,
  status subscription_status not null,
  currency text not null default 'EUR',
  trial_ends_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscriptions_currency_eur_only check (currency = 'EUR'),
  constraint subscriptions_one_per_household unique (household_id)
);
create index subscriptions_household_idx on public.subscriptions(household_id);
create index subscriptions_status_idx on public.subscriptions(status);
create index subscriptions_trial_idx on public.subscriptions(trial_ends_at);
comment on table public.subscriptions is
  'Subscrição Stripe replicada localmente. 1 por household. Trial 14d activado em registo (FR33).';

create table public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  stripe_payment_method_id text not null unique,
  type payment_method_type not null,
  last4 text,
  brand text,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index payment_methods_household_idx on public.payment_methods(household_id);
comment on table public.payment_methods is
  'Métodos de pagamento PT (FR36): card, multibanco, mb_way.';

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  stripe_invoice_id text not null unique,
  invoice_number text unique,
  status invoice_status not null,
  amount_cents integer not null,
  currency text not null default 'EUR',
  nif_customer text,
  invoice_pdf_url text,
  paid_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoices_currency_eur_only check (currency = 'EUR'),
  constraint invoices_nif_format check (
    nif_customer is null or nif_customer ~ '^[0-9]{9}$'
  )
);
create index invoices_household_idx on public.invoices(household_id);
create index invoices_status_idx on public.invoices(status);
create index invoices_paid_at_idx on public.invoices(paid_at);
comment on table public.invoices is
  'Facturas Stripe com NIF PT (FR35). invoice_number formato AT (FT 2026/0001).';

create table public.payment_events (
  stripe_event_id text primary key,
  household_id uuid references public.households(id) on delete cascade,
  event_type text not null,
  payload jsonb not null,
  processed_at timestamptz,
  processing_error text,
  created_at timestamptz not null default now()
);
create index payment_events_household_idx on public.payment_events(household_id);
create index payment_events_type_idx on public.payment_events(event_type);
create index payment_events_processed_idx on public.payment_events(processed_at);
comment on table public.payment_events is
  'Append-only log de webhooks Stripe. PK em stripe_event_id garante idempotência (architecture §6.3).';

-- ─── Agent (Cérebro AI) ────────────────────────────────────────────

create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete restrict,
  prompt_text text not null,
  prompt_hash text not null,
  language text not null default 'pt-PT',
  intents_detected jsonb not null,
  confidence numeric(4, 3) not null,
  status agent_run_status not null default 'classifying',
  response_summary text,
  tool_calls jsonb,
  latency_ms integer,
  classifier_model llm_model,
  executor_model llm_model,
  tokens_input integer default 0,
  tokens_output integer default 0,
  cost_eur numeric(10, 5) default 0,
  trace_id text,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  reverted_at timestamptz,
  constraint agent_runs_confidence_range check (confidence >= 0 and confidence <= 1),
  constraint agent_runs_language_pt check (language = 'pt-PT')
);
create index agent_runs_household_idx on public.agent_runs(household_id);
create index agent_runs_user_idx on public.agent_runs(user_id);
create index agent_runs_status_idx on public.agent_runs(status);
create index agent_runs_created_at_idx on public.agent_runs(created_at desc);
create index agent_runs_undo_idx on public.agent_runs(user_id, created_at desc, status);
comment on table public.agent_runs is
  'Audit log imutável de execuções do agente AI (FR3, NFR9). REVOKE UPDATE/DELETE em RLS migration.';

create table public.intent_classifications (
  id uuid primary key default gen_random_uuid(),
  agent_run_id uuid not null references public.agent_runs(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  intent agent_intent not null,
  confidence numeric(4, 3) not null,
  raw_span text,
  params jsonb not null,
  executed boolean not null default false,
  target_entity_table text,
  target_entity_id uuid,
  created_at timestamptz not null default now(),
  constraint intent_classifications_confidence_range check (confidence >= 0 and confidence <= 1)
);
create index intent_classifications_run_idx on public.intent_classifications(agent_run_id);
create index intent_classifications_household_idx on public.intent_classifications(household_id);
create index intent_classifications_intent_idx on public.intent_classifications(intent);
comment on table public.intent_classifications is
  'Detalhe granular de cada intent detectada (FR2 multi-intent). 1 agent_run → N rows aqui.';

create table public.agent_reverse_ops (
  id uuid primary key default gen_random_uuid(),
  agent_run_id uuid not null references public.agent_runs(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  reverse_op jsonb not null,
  expires_at timestamptz not null,
  executed_at timestamptz,
  created_at timestamptz not null default now()
);
create index agent_reverse_ops_run_idx on public.agent_reverse_ops(agent_run_id);
create index agent_reverse_ops_household_idx on public.agent_reverse_ops(household_id);
create index agent_reverse_ops_undo_query_idx
  on public.agent_reverse_ops(household_id, expires_at, executed_at);
comment on table public.agent_reverse_ops is
  'Operações reversíveis declarativas (FR6 — undo 30s). Job Inngest limpa expirados após 1h.';

create table public.agent_quotas (
  household_id uuid primary key references public.households(id) on delete cascade,
  plan plan_tier not null,
  period_start timestamptz not null,
  period_end timestamptz not null,
  prompts_used integer not null default 0,
  tokens_input_used integer not null default 0,
  tokens_output_used integer not null default 0,
  cost_eur_accumulated numeric(10, 5) not null default 0,
  updated_at timestamptz not null default now()
);
create index agent_quotas_period_idx on public.agent_quotas(period_start, period_end);
comment on table public.agent_quotas is
  'Contadores rolling de quota LLM por household (NFR20). Reset alinhado com subscriptions.current_period_start.';

-- ─── Tasks (FR7-FR12) ──────────────────────────────────────────────

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  created_by_user_id uuid not null references auth.users(id) on delete restrict,
  assigned_to_user_id uuid references auth.users(id) on delete set null,
  title text not null,
  description text,
  due_date date,
  due_time text,
  priority task_priority not null default 'medium',
  status task_status not null default 'todo',
  kanban_column_id uuid references public.kanban_columns(id) on delete set null,
  kanban_position integer default 0,
  project text,
  recurrence_id uuid,  -- FK adicionada após task_recurrences existir
  is_recurrence_template boolean not null default false,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tasks_due_time_format check (
    due_time is null or due_time ~ '^[0-2][0-9]:[0-5][0-9]$'
  )
);
create index tasks_household_idx on public.tasks(household_id);
create index tasks_status_idx on public.tasks(household_id, status);
create index tasks_due_date_idx on public.tasks(household_id, due_date);
create index tasks_created_by_idx on public.tasks(created_by_user_id);
create index tasks_assigned_idx on public.tasks(assigned_to_user_id);
create index tasks_kanban_idx on public.tasks(kanban_column_id, kanban_position);
create index tasks_overdue_idx on public.tasks(household_id, due_date, status);
comment on table public.tasks is
  'Tarefas (FR7-FR12). due_time format HH:MM 24h opcional.';

create table public.task_recurrences (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  template_task_id uuid not null references public.tasks(id) on delete cascade,
  frequency recurrence_frequency not null,
  interval integer not null default 1,
  custom_rrule text,
  starts_on date not null,
  ends_on date,
  next_run_on date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_recurrences_interval_positive check (interval >= 1)
);
create index task_recurrences_household_idx on public.task_recurrences(household_id);
create index task_recurrences_template_idx on public.task_recurrences(template_task_id);
create index task_recurrences_next_run_idx on public.task_recurrences(next_run_on, active);
comment on table public.task_recurrences is
  'Definições de recorrência de tarefas (FR8). Job Inngest gera instâncias para next_run_on <= today.';

-- Agora podemos adicionar a FK circular tasks.recurrence_id → task_recurrences.id
alter table public.tasks
  add constraint tasks_recurrence_id_fkey
  foreign key (recurrence_id) references public.task_recurrences(id) on delete set null;

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  color text not null default '#6B7280',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tags_unique_name_per_household unique (household_id, name)
);
create index tags_household_idx on public.tags(household_id);
comment on table public.tags is
  'Tags globais por household (FR12). Aplicáveis a tasks via task_tags.';

create table public.task_tags (
  task_id uuid not null references public.tasks(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id, tag_id)
);
create index task_tags_household_idx on public.task_tags(household_id);
create index task_tags_tag_idx on public.task_tags(tag_id);

-- ─── Finance (FR13-FR19) ──────────────────────────────────────────

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  bank_name text,
  account_type account_type not null default 'corrente',
  iban_last4 text,
  balance_cents integer not null default 0,
  initial_balance_cents integer not null default 0,
  currency text not null default 'EUR',
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint accounts_currency_eur_only check (currency = 'EUR'),
  constraint accounts_iban_last4_format check (
    iban_last4 is null or iban_last4 ~ '^[0-9]{4}$'
  )
);
create index accounts_household_idx on public.accounts(household_id);
create index accounts_active_idx on public.accounts(household_id, archived_at);
comment on table public.accounts is
  'Contas bancárias / dinheiro (FR15). balance_cents em cêntimos (€8,88 = 888).';

create table public.cards (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete restrict,
  name text not null,
  last4 text,
  card_type card_type not null default 'credit',
  closing_day integer,
  due_day integer,
  credit_limit_cents integer,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cards_last4_format check (last4 is null or last4 ~ '^[0-9]{4}$'),
  constraint cards_closing_day_range check (
    closing_day is null or (closing_day >= 1 and closing_day <= 28)
  ),
  constraint cards_due_day_range check (
    due_day is null or (due_day >= 1 and due_day <= 28)
  ),
  constraint cards_credit_needs_limit check (
    card_type <> 'credit' or credit_limit_cents is not null
  )
);
create index cards_household_idx on public.cards(household_id);
create index cards_account_idx on public.cards(account_id);
comment on table public.cards is
  'Cartões de crédito/débito (FR15). Closing/due day em 1..28 para evitar edge cases fim de mês.';

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  household_id uuid references public.households(id) on delete cascade,
  name text not null,
  icon text,
  color text not null default '#6B7280',
  parent_id uuid,
  is_default boolean not null default false,
  kind category_kind not null default 'expense',
  sort_order integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint categories_unique_global_name unique (household_id, name),
  constraint categories_default_is_global check (
    is_default = false or household_id is null
  )
);
create index categories_household_idx on public.categories(household_id);
create index categories_parent_idx on public.categories(parent_id);
create index categories_kind_idx on public.categories(kind);
-- FK self-reference para parent_id
alter table public.categories
  add constraint categories_parent_id_fkey
  foreign key (parent_id) references public.categories(id) on delete set null;
comment on table public.categories is
  'Categorias globais (household_id NULL, is_default=true) ou per-household. Seed PT-PT em 0002_default_categories.sql.';

create table public.recurrences (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  created_by_user_id uuid not null references auth.users(id) on delete restrict,
  description text not null,
  kind transaction_kind not null,
  amount_cents integer not null,
  currency text not null default 'EUR',
  account_id uuid references public.accounts(id) on delete set null,
  card_id uuid references public.cards(id) on delete set null,
  category_id uuid references public.categories(id) on delete set null,
  payment_method payment_method_finance not null default 'transfer',
  frequency recurrence_freq_finance not null,
  interval integer not null default 1,
  custom_rrule text,
  starts_on date not null,
  ends_on date,
  next_run_on date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recurrences_currency_eur_only check (currency = 'EUR'),
  constraint recurrences_interval_positive check (interval >= 1),
  constraint recurrences_account_or_card check (
    account_id is not null or card_id is not null
  )
);
create index recurrences_household_idx on public.recurrences(household_id);
create index recurrences_next_run_idx on public.recurrences(next_run_on, active);
create index recurrences_account_idx on public.recurrences(account_id);
create index recurrences_card_idx on public.recurrences(card_id);
comment on table public.recurrences is
  'Finanças recorrentes (FR14). Job Inngest materializa em transactions diariamente.';

create table public.installments (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  created_by_user_id uuid not null references auth.users(id) on delete restrict,
  card_id uuid not null references public.cards(id) on delete restrict,
  description text not null,
  total_amount_cents integer not null,
  num_installments integer not null,
  per_installment_cents integer not null,
  category_id uuid references public.categories(id) on delete set null,
  purchased_on date not null,
  first_installment_on date not null,
  currency text not null default 'EUR',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint installments_currency_eur_only check (currency = 'EUR'),
  constraint installments_num_positive check (num_installments >= 1 and num_installments <= 60),
  constraint installments_total_positive check (total_amount_cents > 0)
);
create index installments_household_idx on public.installments(household_id);
create index installments_card_idx on public.installments(card_id);
create index installments_purchased_idx on public.installments(purchased_on);
comment on table public.installments is
  'Compras parceladas (FR16). Gera N transactions com installment_index 1..N.';

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  created_by_user_id uuid not null references auth.users(id) on delete restrict,
  account_id uuid references public.accounts(id) on delete set null,
  card_id uuid references public.cards(id) on delete set null,
  category_id uuid references public.categories(id) on delete set null,
  amount_cents integer not null,
  currency text not null default 'EUR',
  kind transaction_kind not null,
  description text not null,
  transaction_date date not null,
  payment_method payment_method_finance not null default 'card',
  recurrence_id uuid references public.recurrences(id) on delete set null,
  installment_id uuid references public.installments(id) on delete set null,
  installment_index integer,
  agent_run_id uuid references public.agent_runs(id) on delete set null,
  notes text,
  is_projected boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transactions_currency_eur_only check (currency = 'EUR'),
  constraint transactions_account_or_card check (
    account_id is not null or card_id is not null
  ),
  constraint transactions_amount_positive check (amount_cents > 0),
  constraint transactions_installment_index_coherent check (
    (installment_id is null and installment_index is null)
    or (installment_id is not null and installment_index >= 1)
  )
);
create index transactions_household_idx on public.transactions(household_id);
create index transactions_date_range_idx on public.transactions(household_id, transaction_date);
create index transactions_category_idx on public.transactions(household_id, category_id);
create index transactions_account_idx on public.transactions(account_id, transaction_date);
create index transactions_card_idx on public.transactions(card_id, transaction_date);
create index transactions_recurrence_idx on public.transactions(recurrence_id);
create index transactions_installment_idx on public.transactions(installment_id);
create index transactions_kind_idx on public.transactions(household_id, kind, transaction_date);
create index transactions_agent_idx on public.transactions(agent_run_id);
create index transactions_projected_idx
  on public.transactions(household_id, is_projected, transaction_date);
comment on table public.transactions is
  'Transacções financeiras (FR13, FR16). amount_cents sempre positivo, sinal vem de kind. is_projected=true para projecções FR18.';

-- ─── Audit + GDPR ──────────────────────────────────────────────────

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  household_id uuid references public.households(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  action audit_action not null,
  entity_table text,
  entity_id uuid,
  before_state jsonb,
  after_state jsonb,
  ip text,
  user_agent text,
  trace_id text,
  created_at timestamptz not null default now()
);
create index audit_log_household_idx on public.audit_log(household_id);
create index audit_log_user_idx on public.audit_log(user_id);
create index audit_log_action_idx on public.audit_log(action, created_at desc);
create index audit_log_entity_idx on public.audit_log(entity_table, entity_id);
create index audit_log_created_at_idx on public.audit_log(created_at desc);
comment on table public.audit_log is
  'Append-only (NFR9). UPDATE/DELETE revogados na migração RLS. Retenção 12 meses.';

create table public.data_export_jobs (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  requested_by_user_id uuid not null references auth.users(id) on delete cascade,
  status data_export_status not null default 'pending',
  storage_path text,
  download_url text,
  expires_at timestamptz,
  completed_at timestamptz,
  error_message text,
  created_at timestamptz not null default now()
);
create index data_export_jobs_household_idx on public.data_export_jobs(household_id);
create index data_export_jobs_status_idx on public.data_export_jobs(status);
comment on table public.data_export_jobs is
  'Pedidos GDPR Art. 20 (FR28). Inngest gera ZIP em Supabase Storage com signed URL 24h.';

create table public.account_deletion_jobs (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  requested_by_user_id uuid not null references auth.users(id) on delete cascade,
  status account_deletion_status not null default 'scheduled',
  scheduled_for timestamptz not null,
  canceled_at timestamptz,
  canceled_by_user_id uuid references auth.users(id) on delete set null,
  completed_at timestamptz,
  error_message text,
  created_at timestamptz not null default now()
);
create index account_deletion_jobs_household_idx on public.account_deletion_jobs(household_id);
create index account_deletion_jobs_scheduled_idx on public.account_deletion_jobs(scheduled_for, status);
comment on table public.account_deletion_jobs is
  'Eliminação GDPR Art. 17 (FR29). 30 dias agendado, revogável até execução.';

create table public.feature_flags (
  id uuid primary key default gen_random_uuid(),
  household_id uuid references public.households(id) on delete cascade,
  flag_key text not null,
  enabled boolean not null default false,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index feature_flags_household_idx on public.feature_flags(household_id);
create index feature_flags_flag_idx on public.feature_flags(flag_key);
comment on table public.feature_flags is
  'Feature flags simples (architecture §4.4). NULL household_id = flag global default.';

-- ─────────────────────────────────────────────────────────────────────
-- 5. TRIGGERS — set_updated_at em todas as tabelas com updated_at
-- ─────────────────────────────────────────────────────────────────────

do $$
declare
  t text;
begin
  for t in
    select table_name
    from information_schema.columns
    where table_schema = 'public'
      and column_name = 'updated_at'
      and table_name not in ('agent_quotas')  -- update manual gerido pela app
  loop
    execute format(
      'create trigger trg_%I_set_updated_at
        before update on public.%I
        for each row execute function public.set_updated_at();',
      t, t
    );
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- FIM DA MIGRAÇÃO 0000
-- ─────────────────────────────────────────────────────────────────────
