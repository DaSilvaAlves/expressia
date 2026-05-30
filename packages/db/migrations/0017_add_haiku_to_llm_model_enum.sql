-- =====================================================================
-- meu-jarvis (Expressia) — Adicionar Claude Haiku 4.5 ao enum llm_model (Story 2.12)
-- Migração: 0017_add_haiku_to_llm_model_enum.sql
-- Data: 2026-05-30
-- Autor: Dex (@dev) — Story 2.12 T1
--
-- Contexto:
--   Story 2.12 troca o modelo *default* do Executor de `claude-sonnet-4-5`
--   para Claude Haiku 4.5. A coluna `agent_runs.executor_model` é do tipo
--   enum Postgres `llm_model` (packages/db/src/schema/agent.ts:63-67), pelo
--   que o novo modelo tem de existir no enum antes de qualquer INSERT/UPDATE
--   o escrever.
--
--   Convenção de naming do enum (short-form, sem sufixo -YYYYMMDD): o enum já
--   guarda `claude-sonnet-4-5` (não `claude-sonnet-4-5-YYYYMMDD`). Por
--   coerência, adicionamos `claude-haiku-4-5` (short-form). O identificador
--   completo da API Anthropic (`claude-haiku-4-5-20251001`) é passado ao
--   provider em runtime via constante `CLAUDE_HAIKU_DEFAULT`, NUNCA à coluna DB.
--
-- ALTER TYPE ADD VALUE dentro de transacção:
--   O runner `apply-migrations.ts:93` envolve SEMPRE o SQL em `sql.begin(...)`.
--   O padrão `ALTER TYPE ... ADD VALUE IF NOT EXISTS` dentro dessa transacção
--   já corre com sucesso em Postgres 16 nas migrations 0010 (13 valores numa
--   tx), 0011, 0012, 0013, 0014, 0015. O novo valor NÃO é consumido na mesma
--   migration, pelo que é seguro. Nenhuma acção especial de transacção é
--   necessária — segue exactamente o template de 0012.
--
-- Idempotência:
--   `ALTER TYPE ... ADD VALUE IF NOT EXISTS` é não-destrutivo e idempotente
--   desde Postgres 9.6+. Re-run safe — `__schema_migrations` tracking impede
--   re-execução do ficheiro completo de qualquer forma.
--
-- Sem breaking change:
--   Adicionar um value ao enum NÃO afecta queries existentes. Apenas amplia o
--   domínio de valores aceites em `agent_runs.executor_model`. `claude-sonnet-4-5`
--   permanece válido (continua a ser usável via override `opts.model`).
--
-- Sem impacto RLS:
--   Zero tabelas novas, zero policies novas. `pnpm check:rls` mantém EXIT 0.
--
-- Trace: Story 2.12 AC2 + AC3, EPIC-2 §5 (decisão custo 2026-05-30),
--        ADR-001 (chaves directas OpenAI + Anthropic).
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- ALTER TYPE llm_model ADD VALUE — short-form `claude-haiku-4-5`
-- IF NOT EXISTS: idempotente — no-op em re-runs.
-- ─────────────────────────────────────────────────────────────────────

alter type public.llm_model add value if not exists 'claude-haiku-4-5';

comment on type public.llm_model is
  'Modelos LLM suportados. gpt-4o-mini (classifier). claude-sonnet-4-5, claude-opus-4-7, claude-haiku-4-5 (executor). Atualizado em 0017 (Story 2.12): claude-haiku-4-5 passou a ser o default do Executor. Short-form sem sufixo -YYYYMMDD; o API ID completo vive na constante CLAUDE_HAIKU_DEFAULT em @meu-jarvis/agent.';
