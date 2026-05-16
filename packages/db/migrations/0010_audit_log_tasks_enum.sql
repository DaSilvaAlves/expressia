-- =====================================================================
-- meu-jarvis (Expressia) — audit_action enum extension Tasks/Tags/Recurrences
-- Migração: 0010_audit_log_tasks_enum.sql
-- Data: 2026-05-16
-- Autor: Dex (@dev) — implementação Story 3.2 T1.5 (PO_FIX F1 HIGH)
--
-- Contexto:
--   Story 3.2 cria 15+ route handlers REST em apps/web/src/app/api/{tasks,
--   tags,recurrences}/. AC10 requer audit_log INSERT por mutation (POST/
--   PATCH/DELETE/move) com action enum apropriada.
--
--   Cross-confirm @po 2026-05-16 contra packages/db/src/schema/audit.ts:28-55
--   revelou que auditActionEnum tem apenas 21 valores existentes (auth +
--   billing + GDPR + household + agent — zero task/tag/recurrence/task_tag).
--   Migration é DEFINITIVAMENTE necessária (não conditional).
--
-- Decisão (PO_FIX F1 HIGH):
--   Adicionar 13 novos values ao audit_action enum:
--     - Tasks (5):       task.created, task.updated, task.deleted,
--                        task.moved, task.completed
--     - Tags (3):        tag.created, tag.updated, tag.deleted
--     - Task pivot (2):  task_tag.attached, task_tag.detached
--     - Recurrences (3): recurrence.created, recurrence.updated,
--                        recurrence.deleted
--
-- Notação:
--   Novos values usam separador `.` (e.g. `task.created`) em vez de `_`
--   (e.g. `household_created` existing). Convenção alinhada com Story 3.2
--   story spec — namespace claro task.*/tag.*/etc. Postgres enum não tem
--   constraint de formato (strings arbitrárias). Trade-off documentado.
--
-- Convenções (consistentes com 0009_kanban_seed.sql):
--   - `IF NOT EXISTS` em cada ALTER TYPE — idempotente (re-run safe).
--   - PG 16+ suporta ALTER TYPE ADD VALUE dentro de transação. Novos values
--     não podem ser usados na mesma transação que os adiciona — esta migração
--     apenas adiciona (zero INSERT), pelo que safe.
--   - Tracking via __schema_migrations (apply-migrations.ts runner).
--
-- Trace: Story 3.2 T1.5, AC10, F1 HIGH (PO_FIX_INLINE 2026-05-16).
--        Schema reference: packages/db/src/schema/audit.ts:28-55
--                          (auditActionEnum array — actualizado em sync).
-- =====================================================================

-- Tasks actions (5)
alter type public.audit_action add value if not exists 'task.created';
alter type public.audit_action add value if not exists 'task.updated';
alter type public.audit_action add value if not exists 'task.deleted';
alter type public.audit_action add value if not exists 'task.moved';
alter type public.audit_action add value if not exists 'task.completed';

-- Tags actions (3)
alter type public.audit_action add value if not exists 'tag.created';
alter type public.audit_action add value if not exists 'tag.updated';
alter type public.audit_action add value if not exists 'tag.deleted';

-- Task tags pivot actions (2)
alter type public.audit_action add value if not exists 'task_tag.attached';
alter type public.audit_action add value if not exists 'task_tag.detached';

-- Recurrences actions (3)
alter type public.audit_action add value if not exists 'recurrence.created';
alter type public.audit_action add value if not exists 'recurrence.updated';
alter type public.audit_action add value if not exists 'recurrence.deleted';
