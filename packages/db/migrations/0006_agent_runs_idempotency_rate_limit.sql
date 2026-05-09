-- =====================================================================
-- 0006_agent_runs_idempotency_rate_limit.sql
-- =====================================================================
-- Story 2.6 — Endpoint POST /api/agent/prompt: idempotency + rate limit.
--
-- Adiciona:
--   1. agent_runs.idempotency_key (text, nullable) + partial unique index
--      por (idempotency_key, household_id) onde idempotency_key IS NOT NULL.
--      Permite replay determinístico de pedidos duplicados (NFR9, D19 24h).
--
--   2. agent_runs.confirm_expires_at (timestamptz, nullable) — apenas
--      populado quando status='pending_preview' (D20 5min TTL para FR4).
--
--   3. agent_rate_limit_counters — tabela MVP Postgres-based para rate limit
--      per household (D18 — Upstash Redis EU vai vir em Story 2.9 quando EB3
--      for desbloqueado). 10 req/min burst (Architecture §7.2 literal).
--      ENABLE RLS + 4 policies obrigatórias (NFR5).
--
-- IMPORTANTE: esta migration adiciona 1 tabela com household_id → check:rls
-- gate exige 4 RLS policies. Total tabelas pós-0006: 27 (era 26).
--
-- Trace: Story 2.6 D17/D18/D19/D20 + AC8/AC9, PRD NFR9/NFR13, architecture §7.2.
-- =====================================================================

set local check_function_bodies = off;

-- ─── 1. agent_runs.idempotency_key (D19 — 24h replay window) ────────

alter table public.agent_runs
  add column if not exists idempotency_key text;

comment on column public.agent_runs.idempotency_key is
  'Idempotency-Key header opcional (Story 2.6 NFR9 D19). Janela de 24h para replay determinístico de runs terminais. NULL = sem idempotency. Unique partial index por (key, household_id) onde NOT NULL.';

create unique index if not exists agent_runs_idempotency_household_uq
  on public.agent_runs (household_id, idempotency_key)
  where idempotency_key is not null;

-- ─── 2. agent_runs.confirm_expires_at (D20 — 5min preview TTL) ──────

alter table public.agent_runs
  add column if not exists confirm_expires_at timestamptz;

comment on column public.agent_runs.confirm_expires_at is
  'TTL absoluto da janela de confirmação (Story 2.6 D20 — 5min). Apenas populado quando status=''pending_preview''. NULL para outros estados.';

-- ─── 3. agent_rate_limit_counters (D18 — Postgres MVP) ──────────────

create table if not exists public.agent_rate_limit_counters (
  household_id uuid not null references public.households(id) on delete cascade,
  window_start timestamptz not null,
  count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (household_id, window_start)
);

comment on table public.agent_rate_limit_counters is
  'Rate limit counters MVP per household — janela de 1 minuto (Story 2.6 D18). 10 req/min burst (Architecture §7.2). Migração para Upstash Redis EU em Story 2.9 (EB3).';

create index if not exists agent_rate_limit_counters_window_idx
  on public.agent_rate_limit_counters (window_start desc);

-- ─── 4. RLS policies para agent_rate_limit_counters (NFR5) ──────────
--
-- Pattern espelhando agent_quotas (Story 2.1) — household_id check via helper.
-- service_role faz writes (upsert atomic counter); authenticated apenas SELECT
-- para debugging (admin UI futura). INSERT/UPDATE via service_role bypassa RLS.

alter table public.agent_rate_limit_counters enable row level security;
alter table public.agent_rate_limit_counters force row level security;

create policy "agent_rate_limit_counters_select_member"
  on public.agent_rate_limit_counters for select
  to authenticated
  using (public.is_household_member(household_id));
comment on policy "agent_rate_limit_counters_select_member" on public.agent_rate_limit_counters is
  'Membros do household podem ver os seus próprios counters (debug/observability).';

create policy "agent_rate_limit_counters_insert_member"
  on public.agent_rate_limit_counters for insert
  to authenticated
  with check (public.is_household_member(household_id));
comment on policy "agent_rate_limit_counters_insert_member" on public.agent_rate_limit_counters is
  'Membros do household podem criar entries do seu próprio counter (defensive — escrita real é via service_role).';

create policy "agent_rate_limit_counters_update_member"
  on public.agent_rate_limit_counters for update
  to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));
comment on policy "agent_rate_limit_counters_update_member" on public.agent_rate_limit_counters is
  'Membros do household podem actualizar o seu próprio counter (defensive — escrita real é via service_role).';

create policy "agent_rate_limit_counters_delete_member"
  on public.agent_rate_limit_counters for delete
  to authenticated
  using (public.is_household_member(household_id));
comment on policy "agent_rate_limit_counters_delete_member" on public.agent_rate_limit_counters is
  'Membros do household podem eliminar o seu próprio counter — purge job admin via service_role faz cleanup periódico.';
