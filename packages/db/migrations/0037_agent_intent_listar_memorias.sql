-- =====================================================================
-- 0037_agent_intent_listar_memorias.sql
-- =====================================================================
-- Story M-6 — Consultar memória (recall) via chat. Fecha o ciclo da epic v2
-- "Memória rica": capturar (M-1/M-5) → usar (M-2/M-3) → esquecer (M-4) →
-- CONSULTAR (M-6). Âmbito: nova via de LEITURA explícita — o Eurico pergunta
-- "o que sabes sobre mim?" e o Jarvis LISTA as memórias guardadas.
--
-- À semelhança da 0035 (M-4) e 0036 (M-5), este ficheiro faz UMA SÓ coisa
-- (padrão idêntico à 0030-0036 — valor novo no enum agent_intent):
--   1. ALTER TYPE agent_intent ADD VALUE 'listar_memorias' (idempotente).
--
-- NÃO cria tabela nem RLS policies — `public.jarvis_memories` e as suas 4
-- policies (SELECT/INSERT/UPDATE/DELETE, predicate household_id =
-- public.current_household_id()) já existem desde a 0034 (M-1). `listar_memorias`
-- é a 4.ª tool a operar sobre a mesma tabela (as 1.ª/2.ª/3.ª são
-- `memorizar`/`esquecer`/`sugerir_memoria`), sem qualquer alteração de schema.
-- `listar_memorias` é read-only (SELECT), sem side-effects.
-- `scripts/check-rls-coverage.ts` (gate NFR5) NÃO deve reportar nenhuma
-- alteração de cobertura.
--
-- ADD VALUE IF NOT EXISTS é idempotente. NÃO usamos o valor na mesma
-- transacção (nada aqui referencia o enum) — seguro no runner custom
-- (precedente 0030-0036).
--
-- Trace: Story M-6 AC1, brief epic v2-memoria-rica (§3 — recall directo é a
--        lacuna identificada), PRD-Jarvis §5/§9 ("sabe tudo sobre mim").
-- =====================================================================

set local check_function_bodies = off;

-- ─── Enum agent_intent — +1 valor 'listar_memorias' ─────────────────

alter type agent_intent add value if not exists 'listar_memorias';

-- =====================================================================
-- FIM DA MIGRAÇÃO 0037
-- =====================================================================
