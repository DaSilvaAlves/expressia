-- =====================================================================
-- 0029_google_oauth_jarvis_facts.sql
-- =====================================================================
-- Story J-3 — Google Calendar OAuth readonly + cifragem de tokens.
--
-- Cria DUAS tabelas:
--   1. google_oauth_tokens — guarda o refresh_token OAuth do Google CIFRADO
--      (AES-256-GCM: ciphertext + IV + authTag em base64). Um token por
--      (household_id, user_id). O refresh_token nunca é guardado em plaintext;
--      a chave de cifragem vive APENAS em env var (OAUTH_TOKEN_ENCRYPTION_KEY,
--      Vercel Env UE) — nunca na DB, nunca em git. `access_token_hint` guarda
--      só os últimos 6 chars (debug) — nunca o token completo.
--   2. jarvis_facts — factos simples key-value por household (ex.: user_name,
--      timezone, brief_tone). Um facto por (household_id, key) — upsert por
--      chave. Âmbito mínimo v1; cresce na v2 com memória rica.
--
-- IMPORTANTE: cria APENAS as tabelas + triggers. As 4 RLS policies por tabela
-- (SELECT/INSERT/UPDATE/DELETE) vão para 0001_rls_policies.sql via DO-block
-- condicional — `scripts/check-rls-coverage.ts:33` lê APENAS
-- 0001_rls_policies.sql como fonte de verdade do gate NFR5. Pattern espelhado
-- de telegram_link (0027 + 0001) e daily_briefing_cache (0028 + 0001).
--
-- GOTCHA (Tarefa 7): as policies novas em 0001 NÃO chegam a produção via
-- `pnpm db:migrate` — o runner faz skip de ficheiros já registados em
-- __schema_migrations. Após o db:migrate aplicar a 0029, aplicar manualmente
-- os dois DO-blocks (`$rls_google_oauth_tokens$` + `$rls_jarvis_facts$`) via
-- Supabase SQL Editor em produção.
--
-- Total tabelas pós-0029: 31 (era 29). Policies: +8.
--
-- Trace: Story J-3 AC1/AC2/AC3/AC4, PRD-Jarvis §4.4/§6 (FR-J9/FR-J10).
-- =====================================================================

set local check_function_bodies = off;

-- ─── 1. google_oauth_tokens ──────────────────────────────────────────

create table if not exists public.google_oauth_tokens (
  id                      uuid        not null default gen_random_uuid() primary key,
  household_id            uuid        not null references public.households(id) on delete cascade,
  user_id                 uuid        not null references auth.users(id) on delete cascade,
  encrypted_refresh_token text        not null,
  token_iv                text        not null,
  token_auth_tag          text        not null,
  access_token_hint       text,
  token_expiry            timestamptz,
  google_email            text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (household_id, user_id)
);

comment on table public.google_oauth_tokens is
  'Tokens OAuth Google Calendar (Story J-3) — refresh_token cifrado AES-256-GCM (ciphertext+IV+authTag base64). A chave de cifragem vive só em OAUTH_TOKEN_ENCRYPTION_KEY (Vercel Env), nunca na DB. Um token por (household_id, user_id).';

comment on column public.google_oauth_tokens.encrypted_refresh_token is
  'refresh_token OAuth cifrado AES-256-GCM (ciphertext em base64). Nunca plaintext.';

comment on column public.google_oauth_tokens.token_iv is
  'IV (initialization vector) AES-GCM em base64 — 12 bytes / 96 bits, aleatório por cifração.';

comment on column public.google_oauth_tokens.token_auth_tag is
  'Authentication tag GCM em base64 — 16 bytes / 128 bits, garante integridade na decifração.';

comment on column public.google_oauth_tokens.access_token_hint is
  'Últimos 6 chars do access_token (debug) — NUNCA o token completo.';

-- Index para lookups por household (RLS-friendly; o UNIQUE (household_id,
-- user_id) já cobre o lookup principal).
create index if not exists google_oauth_tokens_household_id_idx
  on public.google_oauth_tokens (household_id);

-- ─── 2. Trigger updated_at (google_oauth_tokens) ────────────────────
-- Reutiliza o helper canónico public.set_updated_at() (0000_initial_schema.sql).
-- NÃO usar update_updated_at_column() — gotcha de J-2 (PO-MUST-FIX-1).

drop trigger if exists google_oauth_tokens_set_updated_at on public.google_oauth_tokens;

create trigger google_oauth_tokens_set_updated_at
  before update on public.google_oauth_tokens
  for each row
  execute function public.set_updated_at();

-- ─── 3. jarvis_facts ─────────────────────────────────────────────────

create table if not exists public.jarvis_facts (
  id           uuid        not null default gen_random_uuid() primary key,
  household_id uuid        not null references public.households(id) on delete cascade,
  key          text        not null,
  value        text        not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (household_id, key)
);

comment on table public.jarvis_facts is
  'Factos simples key-value por household (Story J-3) — ex.: user_name, timezone, brief_tone. Upsert por (household_id, key). Âmbito mínimo v1; cresce na v2 com memória rica.';

create index if not exists jarvis_facts_household_id_idx
  on public.jarvis_facts (household_id);

-- ─── 4. Trigger updated_at (jarvis_facts) ───────────────────────────

drop trigger if exists jarvis_facts_set_updated_at on public.jarvis_facts;

create trigger jarvis_facts_set_updated_at
  before update on public.jarvis_facts
  for each row
  execute function public.set_updated_at();

-- =====================================================================
-- FIM DA MIGRAÇÃO 0029
-- =====================================================================
-- NOTA: As 4 RLS policies por tabela (SELECT/INSERT/UPDATE/DELETE) são
-- adicionadas em 0001_rls_policies.sql via DO-block condicional
-- (`$rls_google_oauth_tokens$` + `$rls_jarvis_facts$`).
-- Predicate: household_id = public.current_household_id() (cross-tenancy).
-- =====================================================================
