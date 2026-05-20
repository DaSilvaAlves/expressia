-- =====================================================================
-- meu-jarvis (Expressia) — audit_action enum + idempotency index recorrências
-- Migração: 0013_audit_action_recurrences_generated.sql
-- Data: 2026-05-20
-- Autor: Dex (@dev) — implementação Story 3.7 T5 (cron generate-recurring-tasks)
--
-- Contexto:
--   Story 3.7 cria a Inngest function `generate-recurring-tasks` (cron diário
--   03:00 UTC) que gera as instâncias futuras das `task_recurrences` activas
--   (FR8). A function precisa de 3 alterações de schema consolidadas:
--
--     (a) Novo value audit_action `recurrences_generated` — para o audit log
--         INSERT agregado por job run (AC6 / NFR9). NÃO confundir com
--         recurrence.created/updated/deleted (migration 0010), que são
--         user-actions; `recurrences_generated` é um job sistémico — origem
--         e semântica diferentes, mantido separado.
--
--     (b) Índice unique parcial `tasks_recurrence_id_due_date_unique` —
--         idempotency da geração (R-3.7.1). O Inngest tem entrega
--         at-least-once: o mesmo cron tick pode disparar 2x. O handler usa
--         INSERT ... ON CONFLICT (recurrence_id, due_date) DO NOTHING; este
--         índice é a constraint que torna o ON CONFLICT possível. Parcial
--         (WHERE recurrence_id IS NOT NULL) — tasks não-recorrentes não são
--         afectadas.
--
--     (c) COMMENT ON TABLE task_recurrences — corrige o JSDoc legado que
--         dizia "30 dias" para "90 dias" (EPIC DP6 / D-3.7.1). O horizonte
--         real de geração é 90 dias.
--
-- Convenções (consistentes com 0010_audit_log_tasks_enum.sql):
--   - `IF NOT EXISTS` em ALTER TYPE / CREATE INDEX — idempotente (re-run safe).
--   - PG 16+ suporta ALTER TYPE ADD VALUE dentro de transação. O novo value
--     não pode ser usado na mesma transação que o adiciona — esta migração
--     apenas adiciona (zero INSERT que use o value), pelo que é safe.
--   - Tracking via __schema_migrations (apply-migrations.ts runner).
--
-- Sem breaking change:
--   - ALTER TYPE ADD VALUE é não-destrutivo (queries existentes inalteradas).
--   - O índice parcial só cobre rows com recurrence_id não-nulo; zero rows em
--     produção têm recurrence_id populado antes da Story 3.7 (esta story é a
--     primeira a popular o campo).
--
-- Trace: Story 3.7 T5, AC5, AC6, D-3.7.1, D-3.7.6, R-3.7.1.
--        Schema reference: packages/db/src/schema/audit.ts (auditActionEnum),
--                          packages/db/src/schema/tasks.ts (taskRecurrences).
-- =====================================================================

-- (a) Audit action para o job sistémico de geração de recorrências.
alter type public.audit_action add value if not exists 'recurrences_generated';

-- (b) Índice unique parcial — idempotency Inngest at-least-once delivery.
create unique index if not exists tasks_recurrence_id_due_date_unique
  on public.tasks (recurrence_id, due_date)
  where recurrence_id is not null;

-- (c) Clarificação do COMMENT da tabela — horizonte real é 90 dias.
comment on table public.task_recurrences is
  'Definição de recorrência (FR8). O job Inngest diário (generate-recurring-tasks, Story 3.7) gera as instâncias futuras para os próximos 90 dias. Suporta os presets do FR8 (daily, weekly, monthly, weekdays, weekends, biweekly, yearly) + RRULE livre via custom_rrule (iCal RFC 5545) quando frequency=custom.';
