-- =====================================================================
-- 0036_agent_intent_sugerir_memoria.sql
-- =====================================================================
-- Story M-5 — Captura inferida de memória com confirmação (primeira story do
-- arco v2.x, após a espinha da epic v2 "Memória rica" fechada: M-1 capturar →
-- M-2 usar no motor → M-3 usar no brief → M-4 esquecer). Âmbito: D1 do brief do
-- @pm ("Inferida… idealmente com confirmação") + R5 ("nunca captura sem
-- consentimento" → mitigação: sempre com confirmação quando entrar).
--
-- À semelhança da 0035 (M-4), este ficheiro faz UMA SÓ coisa (padrão idêntico
-- à 0030-0035 — valor novo no enum agent_intent):
--   1. ALTER TYPE agent_intent ADD VALUE 'sugerir_memoria' (idempotente).
--
-- NÃO cria tabela nem RLS policies — `public.jarvis_memories` e as suas 4
-- policies (SELECT/INSERT/UPDATE/DELETE, predicate household_id =
-- public.current_household_id()) já existem desde a 0034 (M-1). A coluna
-- `source` já existe desde a 0034, com o valor `'inferred'` explicitamente
-- reservado para esta story (comentário original da M-1). `sugerir_memoria` é a
-- 3.ª tool a operar sobre a mesma tabela (as 1.ª/2.ª são `memorizar`/`esquecer`),
-- sem qualquer alteração de schema. `scripts/check-rls-coverage.ts` (gate NFR5)
-- NÃO deve reportar nenhuma alteração de cobertura.
--
-- ADD VALUE IF NOT EXISTS é idempotente. NÃO usamos o valor na mesma
-- transacção (nada aqui referencia o enum) — seguro no runner custom
-- (precedente 0030-0035).
--
-- Trace: Story M-5 AC1, brief epic v2-memoria-rica (§2 D1, §7 R5), PRD FR4
--        (preview-then-confirm) + FR6 (undo 30s).
-- =====================================================================

set local check_function_bodies = off;

-- ─── Enum agent_intent — +1 valor 'sugerir_memoria' ─────────────────

alter type agent_intent add value if not exists 'sugerir_memoria';

-- =====================================================================
-- FIM DA MIGRAÇÃO 0036
-- =====================================================================
