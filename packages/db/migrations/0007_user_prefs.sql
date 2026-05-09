-- =====================================================================
-- 0007_user_prefs.sql
-- =====================================================================
-- Story 2.7 — Preferências de utilizador (FR4 toggle `always_preview`).
--
-- Adiciona:
--   1. user_prefs — tabela 1:1 user (D29 — não composite PK user×household).
--      Colunas: user_id (PK FK auth.users CASCADE), household_id (FK
--      households CASCADE para RLS pattern), always_preview boolean default
--      false, created_at/updated_at timestamptz.
--
--   2. Index user_prefs_household_idx — RLS-friendly + lookup queries.
--
-- IMPORTANTE: Esta migration cria APENAS a tabela + index. As 4 RLS
-- policies (SELECT/INSERT/UPDATE/DELETE) vão para 0001_rls_policies.sql
-- via DO block condicional (PO_FIX_INLINE 2 da Story 2.7 v1.1). Razão:
-- `scripts/check-rls-coverage.ts:33` lê APENAS 0001_rls_policies.sql como
-- fonte de verdade do gate NFR5.
--
-- Pattern espelhado de Story 2.6 D17 (`agent_rate_limit_counters`).
--
-- Total tabelas pós-0007: 28 (era 27). Policies: 112 + 4 = 116.
--
-- Trace: Story 2.7 D29 + D32 + AC1/AC2, PRD FR4, EPIC-2 §8 DP2.
-- =====================================================================

set local check_function_bodies = off;

-- ─── 1. user_prefs (D29 — 1:1 user) ─────────────────────────────────

create table if not exists public.user_prefs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  always_preview boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.user_prefs is
  'Preferências cognitivas de utilizador (Story 2.7 FR4). 1:1 com auth.users; household_id necessário para RLS pattern (cross-tenancy isolation). Multi-household users partilham mesma always_preview (D29 — edge case deferred DP).';

comment on column public.user_prefs.always_preview is
  'Quando true, força preview-then-confirm em todos os prompts (FR4) independentemente da confidence. Default false respeita threshold 0.70 (DP2 EPIC-2 §8).';

-- Index para lookups por household (RLS-friendly; o PK já cobre lookups por user_id)
create index if not exists user_prefs_household_idx
  on public.user_prefs (household_id);

-- ─── 2. Trigger updated_at ──────────────────────────────────────────
-- Reutiliza helper `set_updated_at()` do 0000_initial_schema.sql.

drop trigger if exists user_prefs_set_updated_at on public.user_prefs;

create trigger user_prefs_set_updated_at
  before update on public.user_prefs
  for each row
  execute function public.set_updated_at();

-- =====================================================================
-- FIM DA MIGRAÇÃO 0007
-- =====================================================================
-- NOTA: As 4 RLS policies para user_prefs (SELECT/INSERT/UPDATE/DELETE)
-- são adicionadas em 0001_rls_policies.sql via DO block condicional
-- (PO_FIX_INLINE 2 — `scripts/check-rls-coverage.ts:33` reads only 0001).
-- Predicate: public.is_household_member(household_id) AND auth.uid() = user_id
-- (combina cross-tenancy isolation com user-scoped constraint).
-- =====================================================================
