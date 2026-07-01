-- Story J-7 — tool Gmail send (enviar/compor email via Telegram, preview→confirm).
-- Adiciona 1 valor ao enum `agent_intent`. ALTER TYPE ADD VALUE é não-destrutivo.
-- IF NOT EXISTS garante idempotência em reruns (padrão Stories 3.8 0012, 2.14 0026,
-- J-5 0030, J-6 0031). ALTER TYPE ... ADD VALUE corre dentro de transacção em
-- Postgres 12+ desde que o valor novo não seja USADO na mesma transacção — esta
-- migration só adiciona.
ALTER TYPE agent_intent ADD VALUE IF NOT EXISTS 'enviar_email';
