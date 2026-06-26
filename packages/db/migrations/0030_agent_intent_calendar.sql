-- Story J-5 — tools Calendar escrita (criar + reagendar evento via Telegram).
-- Adiciona 2 valores ao enum `agent_intent`. ALTER TYPE ADD VALUE é não-destrutivo.
-- IF NOT EXISTS garante idempotência em reruns (padrão Stories 3.8 0012 + 2.14 0026).
-- ALTER TYPE ... ADD VALUE corre dentro de transacção em Postgres 12+ desde que o
-- valor novo não seja USADO na mesma transacção — esta migration só adiciona.
ALTER TYPE agent_intent ADD VALUE IF NOT EXISTS 'criar_evento_calendario';
ALTER TYPE agent_intent ADD VALUE IF NOT EXISTS 'reagendar_evento_calendario';
