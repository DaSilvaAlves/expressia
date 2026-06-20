-- Story 2.14 — tools UPDATE/DELETE para Tarefas e Finanças.
-- Adiciona 4 valores ao enum `agent_intent`. ALTER TYPE ADD VALUE é não-destrutivo.
-- IF NOT EXISTS garante idempotência em reruns (padrão Stories 3.8 + 4.10).
ALTER TYPE agent_intent ADD VALUE IF NOT EXISTS 'atualizar_tarefa';
ALTER TYPE agent_intent ADD VALUE IF NOT EXISTS 'eliminar_tarefa';
ALTER TYPE agent_intent ADD VALUE IF NOT EXISTS 'update_finance_variable';
ALTER TYPE agent_intent ADD VALUE IF NOT EXISTS 'delete_finance_variable';
