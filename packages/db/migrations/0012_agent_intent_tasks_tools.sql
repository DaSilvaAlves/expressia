-- =====================================================================
-- meu-jarvis (Expressia) — Agent intent enum: tasks tools (Story 3.8)
-- Migração: 0012_agent_intent_tasks_tools.sql
-- Data: 2026-05-19
-- Autor: Dex (@dev) — Story 3.8 T6 (R2 v1.1 fix aplicado pós PO re-validate)
--
-- Contexto:
--   Story 3.8 (Epic 3 — Tools cérebro do domínio Tarefas) adiciona 4 tools ao
--   toolRegistry:
--     - criar_tarefa       (JÁ EXISTE no enum — 0000_initial_schema.sql:125)
--     - completar_tarefa   (novo)
--     - listar_tarefas     (novo)
--     - listar_atrasadas   (novo)
--
--   O enum `agent_intent` é usado por `intent_classifications.intent` para
--   registar o intent detectado pelo Classifier (Story 2.4). Esta migration
--   adiciona 3 valores genuinamente novos + mantém `criar_tarefa` como no-op
--   idempotente (defensive programming — `IF NOT EXISTS` torna re-runs safe).
--
-- Decisões R2 v1.1 (cross-confirm @sm + @po):
--   - `criar_tarefa` já existe em `0000_initial_schema.sql:125` + `agent.ts:47`
--     (verificado por grep durante draft v1.1).
--   - Mantém-se 4× ALTER TYPE para consistência com lista da story + zero
--     overhead em reruns. `IF NOT EXISTS` garante idempotência total.
--   - Schema Drizzle `agentIntentEnum` em `packages/db/src/schema/agent.ts`
--     actualizado em paralelo (apenas os 3 valores novos adicionados ao array).
--
-- Idempotência:
--   `ALTER TYPE ... ADD VALUE IF NOT EXISTS` é não-destrutivo e idempotent
--   desde Postgres 9.6+. Re-run safe — `__schema_migrations` tracking impede
--   re-execução do ficheiro completo de qualquer forma.
--
-- Sem breaking change:
--   Adicionar values ao enum NÃO afecta queries existentes. Apenas amplia o
--   domínio de valores aceites em `intent_classifications.intent`.
--
-- Trace: Story 3.8 AC6 + Anti-Hallucination row #9 v1.1, EPIC-3-EXECUTION
--        §stories[3.8] migration plan, PRD FR2 (multi-intent classification).
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- ALTER TYPE agent_intent ADD VALUE — 4 valores (1 no-op + 3 novos)
-- IF NOT EXISTS: idempotente — `criar_tarefa` já existe (no-op), os outros 3
-- são adicionados.
-- ─────────────────────────────────────────────────────────────────────

alter type public.agent_intent add value if not exists 'criar_tarefa';
alter type public.agent_intent add value if not exists 'completar_tarefa';
alter type public.agent_intent add value if not exists 'listar_tarefas';
alter type public.agent_intent add value if not exists 'listar_atrasadas';

comment on type public.agent_intent is
  'Intent detectado pelo Classifier (Story 2.4). Atualizado em 0012 (Story 3.8) com 3 novos valores para tools cérebro do domínio Tarefas: completar_tarefa, listar_tarefas, listar_atrasadas. `criar_tarefa` já existia em 0000_initial_schema.sql.';
