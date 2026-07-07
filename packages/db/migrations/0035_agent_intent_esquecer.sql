-- =====================================================================
-- 0035_agent_intent_esquecer.sql
-- =====================================================================
-- Story M-4 — Esquecer uma memória (quarta e última story da espinha da epic
-- v2 "Memória rica"). Âmbito: D5 do brief do @pm ("esquecer entra já — sem
-- ele, uma memória errada vira armadilha permanente"). Fecha o ciclo de
-- confiança: capturar (M-1) → usar no motor (M-2) → usar no brief (M-3) →
-- esquecer (M-4).
--
-- Ao contrário da 0034 (M-1), este ficheiro faz UMA SÓ coisa (padrão idêntico
-- à 0030-0033 — valor novo no enum agent_intent):
--   1. ALTER TYPE agent_intent ADD VALUE 'esquecer' (idempotente).
--
-- NÃO cria tabela nem RLS policies — `public.jarvis_memories` e as suas 4
-- policies (SELECT/INSERT/UPDATE/DELETE, predicate household_id =
-- public.current_household_id()) já existem desde a 0034 (M-1). `esquecer` é a
-- 2.ª tool a operar sobre a mesma tabela (a 1.ª é `memorizar`), sem qualquer
-- alteração de schema. `scripts/check-rls-coverage.ts` (gate NFR5) NÃO deve
-- reportar nenhuma alteração de cobertura.
--
-- ADD VALUE IF NOT EXISTS é idempotente. NÃO usamos o valor na mesma
-- transacção (nada aqui referencia o enum) — seguro no runner custom
-- (precedente 0030-0034).
--
-- Trace: Story M-4 AC1, brief epic v2-memoria-rica (D5), PRD-Jarvis §5/§9,
--        PRD FR4 (preview-then-confirm) + FR6 (undo 30s).
-- =====================================================================

set local check_function_bodies = off;

-- ─── Enum agent_intent — +1 valor 'esquecer' ────────────────────────

alter type agent_intent add value if not exists 'esquecer';

-- =====================================================================
-- FIM DA MIGRAÇÃO 0035
-- =====================================================================
