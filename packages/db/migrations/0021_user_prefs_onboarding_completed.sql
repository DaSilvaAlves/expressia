-- =====================================================================
-- 0021_user_prefs_onboarding_completed.sql
-- =====================================================================
-- Story 6.2 — Onboarding (tour pós-registo) + confirmação de trial.
--
-- Adiciona 1 coluna a `user_prefs` para rastrear se o utilizador já viu
-- (completou OU saltou) o tour de onboarding:
--
--   onboarding_completed_at timestamptz null
--     - null  → utilizador ainda NÃO viu o tour → /visao redirecciona p/ /bem-vindo (AC2).
--     - now() → tour completado ou saltado (FR31 saltável; AC7 marcação idempotente).
--
-- DP-6.2.4 = A (travada pelo @po): o estado vive em `user_prefs` (e não em
-- cookie) porque é cross-device e a `/visao` JÁ lê esta tabela RSC-direct
-- (apps/web/.../visao/page.tsx) — o gate reusa a query existente.
--
-- IMPORTANTE:
--   - Idempotente: `ADD COLUMN IF NOT EXISTS` (Postgres 9.6+). Re-run seguro.
--   - As 4 RLS policies de user_prefs (0008_user_prefs_rls.sql) mantêm-se
--     INALTERADAS — esta migration só estende uma coluna. Zero policy nova.
--   - Coluna nullable sem default: rows existentes ficam `null` (= "não viu o
--     tour") — comportamento desejado para utilizadores pré-6.2 (verão o tour
--     na próxima visita à /visao). Constitution Article IV — No Invention.
--   - O trigger user_prefs_set_updated_at (0007) chama set_updated_at() apenas
--     em UPDATE — não em ALTER TABLE; rows existentes não disparam UPDATE.
--
-- Total tabelas pós-0021: 28 (inalterado — só estende user_prefs).
-- RLS coverage gate NFR5 preservada (mesmas policies).
--
-- Trace: Story 6.2 AC2/AC7/AC9; PRD FR30/FR31; Epic 6 §8 DP-6.2.4=A;
--        packages/db/src/schema/prefs.ts.
-- =====================================================================

set local check_function_bodies = off;

alter table public.user_prefs
  add column if not exists onboarding_completed_at timestamptz;

comment on column public.user_prefs.onboarding_completed_at is
  'Momento em que o utilizador completou OU saltou o tour de onboarding (Story 6.2 / FR30/FR31). null = ainda não viu o tour → /visao redirecciona para /bem-vindo. Marcação idempotente via UPSERT (AC7). DP-6.2.4 Epic 6 = A.';

-- =====================================================================
-- FIM DA MIGRAÇÃO 0021
-- =====================================================================
