-- =====================================================================
-- 0016_user_prefs_theme_widgets.sql
-- =====================================================================
-- Story 5.1 — Extensão de user_prefs com 2 colunas para o Epic 5 (Web App UI):
--   1. theme text — modo claro/escuro/system (FR22).
--      DP2 Epic 5 = C (híbrido): user_prefs.theme é fonte de verdade
--      cross-device no servidor; localStorage é cache no cliente para
--      evitar flash no SSR. Toggle via PATCH /api/conta/preferencias
--      actualiza ambos.
--      Decisão AC8(a): CHECK constraint em vez de Postgres enum nativo
--      (3 valores estáveis; evita caveats de ALTER TYPE em transactions).
--
--   2. widgets_enabled jsonb — config dos 7 widgets do dashboard "Visão"
--      (FR21). DP3 Epic 5 = A: JSONB com Zod schema (.strict()) valida
--      o shape ao nível da API; migration aplica defaults SQL para os
--      rows existentes (5 default ON + 2 default OFF conforme
--      front-end-spec §5.4).
--
-- IMPORTANTE:
--   - Migration idempotente por construção (`ADD COLUMN IF NOT EXISTS`
--     Postgres 9.6+; CHECK constraint via DROP IF EXISTS + ADD pattern).
--   - As 4 RLS policies de user_prefs (0001_rls_policies.sql:711-755)
--     mantêm-se inalteradas — esta migration só estende colunas.
--   - O endpoint /api/conta/preferencias preserva o pattern lazy-init
--     D32 (Story 2.7): UPSERT sem valores explícitos para as colunas
--     novas faz fallback para os defaults SQL (sem flash de tema
--     incorrecto, sem widgets inválidos).
--
-- Total tabelas pós-0016: 28 (inalterado — só estende user_prefs).
-- RLS coverage gate NFR5 preservada (mesmas 116 policies).
--
-- Trace: Story 5.1 AC1 + AC2 + AC6 + AC8; PRD FR21 + FR22; Epic 5 §8
-- DP2 + DP3; front-end-spec §5.4.
-- =====================================================================

set local check_function_bodies = off;

-- ─── 1. theme (FR22 — DP2 Epic 5 = C híbrido) ────────────────────────

alter table public.user_prefs
  add column if not exists theme text not null default 'system';

-- CHECK constraint via DROP IF EXISTS + ADD para suportar re-run sem erro.
-- Pattern preferido em vez de pgEnum (AC8(a)): 3 valores estáveis; CHECK
-- é flexível para evolução futura (high-contrast, sepia) sem caveats de
-- ALTER TYPE em transactions Postgres.
alter table public.user_prefs
  drop constraint if exists user_prefs_theme_check;
alter table public.user_prefs
  add constraint user_prefs_theme_check
  check (theme in ('light', 'dark', 'system'));

comment on column public.user_prefs.theme is
  'Modo de tema preferido pelo utilizador (Story 5.1 / FR22). Valores: light, dark, system. Default ''system'' segue preferência do OS. DP2 Epic 5 = C (híbrido): servidor é fonte de verdade cross-device; localStorage no cliente evita flash no SSR.';

-- ─── 2. widgets_enabled (FR21 — DP3 Epic 5 = A JSONB) ────────────────

-- Default JSONB inclui os 7 widgets identificados em front-end-spec §5.4:
--   5 default ON  : briefing, tasks_today, finance_month,
--                   recurrences_next, tasks_overdue
--   2 default OFF : accounts_balance, calendar_week
-- Naming snake_case em vez de kebab-case para evitar escape de hyphens
-- em queries JSONB e para alinhar com convenção DB do projecto.
alter table public.user_prefs
  add column if not exists widgets_enabled jsonb not null default
    '{"briefing":true,"tasks_today":true,"finance_month":true,"recurrences_next":true,"tasks_overdue":true,"accounts_balance":false,"calendar_week":false}'::jsonb;

comment on column public.user_prefs.widgets_enabled is
  'Configuração de widgets activos no dashboard "Visão" (Story 5.1 / FR21). JSONB com 7 chaves booleanas validadas em runtime por Zod WidgetsEnabledSchema.strict() (apps/web/src/lib/api-schemas/preferences.ts). Default: 5 ON (briefing, tasks_today, finance_month, recurrences_next, tasks_overdue) + 2 OFF (accounts_balance, calendar_week) conforme front-end-spec §5.4. DP3 Epic 5 = A.';

-- =====================================================================
-- FIM DA MIGRAÇÃO 0016
-- =====================================================================
-- Nota: o trigger user_prefs_set_updated_at (0007:53-57) chama
-- set_updated_at() apenas em UPDATE — não em ALTER TABLE com DEFAULT.
-- Rows existentes recebem theme='system' e widgets_enabled={defaults}
-- via DEFAULT sem disparar UPDATE — comportamento documentado em
-- AC8(b) (Constitution Article IV — No Invention).
-- =====================================================================
