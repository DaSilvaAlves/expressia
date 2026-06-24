-- =====================================================================
-- 0027_telegram_link.sql
-- =====================================================================
-- Story J-2 — Mapeamento de identidade `chat_id` → household + user.
--
-- O webhook do Telegram não tem sessão Supabase (JWT). Esta tabela resolve a
-- identidade do utilizador a partir do `chat_id` do Telegram, substituindo a
-- allowlist env-var `TELEGRAM_ALLOWED_CHAT_ID` de J-1. É lida com
-- `getServiceDb()` (uso legítimo SEC-10 — resolve identidade fora de sessão
-- HTTP, não dados de domínio).
--
-- Adiciona:
--   1. telegram_link — colunas id (PK), household_id (FK households CASCADE),
--      user_id (FK auth.users CASCADE), chat_id (bigint UNIQUE),
--      created_at/updated_at timestamptz.
--   2. Index telegram_link_household_id_idx — RLS-friendly + lookup.
--   3. Trigger telegram_link_set_updated_at — reutiliza public.set_updated_at()
--      (helper canónico do 0000_initial_schema.sql).
--
-- IMPORTANTE: Esta migration cria APENAS a tabela + index + trigger. As 4 RLS
-- policies (SELECT/INSERT/UPDATE/DELETE) vão para 0001_rls_policies.sql via DO
-- block condicional — `scripts/check-rls-coverage.ts:33` lê APENAS
-- 0001_rls_policies.sql como fonte de verdade do gate NFR5. Pattern espelhado
-- de user_prefs (0007 + 0001) e agent_rate_limit_counters (0006 + 0001).
--
-- Total tabelas pós-0027: 29 (era 28). Policies: +4.
--
-- Trace: Story J-2 AC1/AC2/AC3, PRD-Jarvis §4.8, architecture §3.2.
-- =====================================================================

set local check_function_bodies = off;

-- ─── 1. telegram_link ────────────────────────────────────────────────

create table if not exists public.telegram_link (
  id           uuid        not null default gen_random_uuid() primary key,
  household_id uuid        not null references public.households(id) on delete cascade,
  user_id      uuid        not null references auth.users(id) on delete cascade,
  chat_id      bigint      not null unique,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.telegram_link is
  'Mapeamento de identidade chat_id (Telegram) → household + user (Story J-2). Lida via getServiceDb() para resolver identidade fora de sessão HTTP (webhook não tem JWT). Substitui a allowlist TELEGRAM_ALLOWED_CHAT_ID de J-1.';

comment on column public.telegram_link.chat_id is
  'chat_id do Telegram — único; bigint cobre o range completo dos IDs do Telegram (excede integer).';

-- Index para lookups por household (RLS-friendly; o chat_id já tem UNIQUE para
-- o lookup principal chat_id → identidade).
create index if not exists telegram_link_household_id_idx
  on public.telegram_link (household_id);

-- ─── 2. Trigger updated_at ──────────────────────────────────────────
-- Reutiliza o helper canónico public.set_updated_at() (0000_initial_schema.sql).
-- NÃO usar update_updated_at_column() — o helper canónico deste projecto é
-- set_updated_at() (PO-MUST-FIX-1 da Story J-2).

drop trigger if exists telegram_link_set_updated_at on public.telegram_link;

create trigger telegram_link_set_updated_at
  before update on public.telegram_link
  for each row
  execute function public.set_updated_at();

-- =====================================================================
-- FIM DA MIGRAÇÃO 0027
-- =====================================================================
-- NOTA: As 4 RLS policies para telegram_link (SELECT/INSERT/UPDATE/DELETE)
-- são adicionadas em 0001_rls_policies.sql via DO block condicional
-- (`scripts/check-rls-coverage.ts:33` reads only 0001).
-- Predicate: household_id = current_household_id() (cross-tenancy isolation).
-- =====================================================================
