-- =====================================================================
-- 0028_daily_briefing_cache.sql
-- =====================================================================
-- Story J-4 — idempotência do brief diário proactivo no Telegram.
--
-- O job Inngest `generate-daily-brief` corre 1× por dia (07:30 Europe/Lisbon)
-- mas o Inngest tem entrega at-least-once. Esta tabela garante que cada
-- household recebe no máximo UM brief por dia: a linha `(household_id,
-- briefing_date)` é única, e o job só envia se ainda não existir registo para
-- o dia de hoje (Europe/Lisbon).
--
-- Guarda também o `message_text` gerado (para replay/auditoria) e o
-- `generated_at` (instante da síntese).
--
-- IMPORTANTE: cria APENAS a tabela + index. As 4 RLS policies
-- (SELECT/INSERT/UPDATE/DELETE) vão para 0001_rls_policies.sql via DO-block
-- condicional — `scripts/check-rls-coverage.ts:33` lê APENAS
-- 0001_rls_policies.sql como fonte de verdade do gate NFR5. Pattern espelhado
-- de telegram_link (0027 + 0001) e user_prefs (0007 + 0001).
--
-- Total tabelas pós-0028: 30 (era 29). Policies: +4.
--
-- Trace: Story J-4 AC1/AC2/AC7, epic-jarvis-fase1 §J-4.
-- =====================================================================

set local check_function_bodies = off;

-- ─── 1. daily_briefing_cache ─────────────────────────────────────────

create table if not exists public.daily_briefing_cache (
  id            uuid        not null default gen_random_uuid() primary key,
  household_id  uuid        not null references public.households(id) on delete cascade,
  briefing_date date        not null,
  message_text  text        not null,
  generated_at  timestamptz not null,
  created_at    timestamptz not null default now(),
  unique (household_id, briefing_date)
);

comment on table public.daily_briefing_cache is
  'Idempotência do brief diário (Story J-4) — no máximo 1 linha por household por dia (briefing_date em Europe/Lisbon). Guarda o texto sintetizado para replay/auditoria.';

comment on column public.daily_briefing_cache.briefing_date is
  'Dia do brief, calculado em Europe/Lisbon (não UTC) — alinha com o cron TZ=Europe/Lisbon.';

-- Index para o lookup de idempotência (household_id + briefing_date). O UNIQUE
-- já cobre o lookup, mas mantemos um index nomeado explícito por clareza.
create index if not exists daily_briefing_cache_household_date_idx
  on public.daily_briefing_cache (household_id, briefing_date);

-- =====================================================================
-- FIM DA MIGRAÇÃO 0028
-- =====================================================================
-- NOTA: As 4 RLS policies para daily_briefing_cache são adicionadas em
-- 0001_rls_policies.sql via DO-block condicional.
-- Predicate: household_id = public.current_household_id().
-- =====================================================================
