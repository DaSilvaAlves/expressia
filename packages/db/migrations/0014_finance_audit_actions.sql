-- =====================================================================
-- meu-jarvis (Expressia) — audit_action enum extension Finanças
-- Migração: 0014_finance_audit_actions.sql
-- Data: 2026-05-21
-- Autor: Dex (@dev) — implementação Story 4.1 T2 (Epic 4 — Módulo Finanças)
--
-- Contexto:
--   O Epic 4 entrega as API routes CRUD das 6 tabelas de Finanças (Stories
--   4.2-4.4) que, conforme o padrão estabelecido na Story 3.2 (Tarefas),
--   gravam um audit_log INSERT por mutation (POST/PATCH/DELETE) via o helper
--   `insertAuditLog` (`@/lib/api-helpers/audit`). Cada mutation precisa de um
--   value `audit_action` apropriado.
--
--   Cross-confirm @sm + @po 2026-05-20/21 contra packages/db/src/schema/
--   audit.ts: o enum `audit_action` tinha 37 valores (auth + billing + GDPR +
--   household + agent + task.* + tag.* + task_tag.* + recurrence.* +
--   kanban_column.* + recurrences_generated) — zero valores de Finanças.
--   Migration DEFINITIVAMENTE necessária (não conditional).
--
-- Decisão (Story 4.1 AC2, scope aprovado @po):
--   Adicionar 17 novos values ao audit_action enum:
--     - Accounts (3):     account.created, account.updated, account.deleted
--     - Cards (3):        card.created, card.updated, card.deleted
--     - Categories (3):   category.created, category.updated, category.deleted
--     - Transactions (3): transaction.created, transaction.updated,
--                         transaction.deleted
--     - Recurrences (3):  finance_recurrence.created, finance_recurrence.updated,
--                         finance_recurrence.deleted
--     - Installments (2): installment.created, installment.deleted
--
-- Naming `finance_recurrence.*` (Story 4.1 AC10b — ratificado @po):
--   `recurrence.created/updated/deleted` JÁ EXISTEM no enum desde a migration
--   0010 (Story 3.2) e referem-se à tabela `task_recurrences` (recorrência de
--   Tarefas). A tabela `recurrences` de Finanças é uma entidade distinta — usar
--   o prefixo `finance_recurrence.*` desambigua sem tocar nos valores
--   existentes. Decisão ratificada por @po Pax em 2026-05-21.
--
-- `installment.updated` omitido (Story 4.1 AC2a — ratificado @po):
--   Coerente com a DP8=A do Epic 4 — as compras parceladas são geradas
--   atomicamente na criação do installment e são imutáveis no MVP (editar =
--   eliminar + recriar). Apenas `installment.created` + `installment.deleted`.
--
-- Fora de scope (deferido — Story 4.1 AC2c):
--   A audit action do job sistémico de geração de transacções recorrentes de
--   Finanças (análoga a `recurrences_generated` da migration 0013) será
--   adicionada pela migration da Story 4.5 (cron Inngest Finanças), que desenha
--   o seu próprio comportamento.
--
-- Convenções (consistentes com 0010_audit_log_tasks_enum.sql + 0013):
--   - `IF NOT EXISTS` em cada ALTER TYPE — idempotente (re-run safe).
--   - PG 16+ suporta ALTER TYPE ADD VALUE dentro de transação. Os novos values
--     não são usados na mesma transação que os adiciona — esta migração apenas
--     adiciona (zero INSERT que use os values), pelo que é safe.
--   - Tracking via __schema_migrations (apply-migrations.ts runner).
--   - Separador `.` no namespace (account.created), consistente com task.*/
--     tag.*/kanban_column.* das migrations 0010/0011.
--
-- Sem breaking change:
--   - ALTER TYPE ADD VALUE é não-destrutivo (queries existentes inalteradas).
--   - Zero rows existentes afectadas (apenas extensão do domínio do enum).
--
-- Trace: Story 4.1 T2, AC2. Epic `docs/epics/epic-4-modulo-financas.md` v1.0.
--        Schema reference: packages/db/src/schema/audit.ts (auditActionEnum —
--                          actualizado em sync nesta mesma story).
-- =====================================================================

-- Accounts actions (3)
alter type public.audit_action add value if not exists 'account.created';
alter type public.audit_action add value if not exists 'account.updated';
alter type public.audit_action add value if not exists 'account.deleted';

-- Cards actions (3)
alter type public.audit_action add value if not exists 'card.created';
alter type public.audit_action add value if not exists 'card.updated';
alter type public.audit_action add value if not exists 'card.deleted';

-- Categories actions (3)
alter type public.audit_action add value if not exists 'category.created';
alter type public.audit_action add value if not exists 'category.updated';
alter type public.audit_action add value if not exists 'category.deleted';

-- Transactions actions (3)
alter type public.audit_action add value if not exists 'transaction.created';
alter type public.audit_action add value if not exists 'transaction.updated';
alter type public.audit_action add value if not exists 'transaction.deleted';

-- Finance recurrences actions (3) — prefixo `finance_` desambigua de
-- `recurrence.*` (migration 0010 / task_recurrences).
alter type public.audit_action add value if not exists 'finance_recurrence.created';
alter type public.audit_action add value if not exists 'finance_recurrence.updated';
alter type public.audit_action add value if not exists 'finance_recurrence.deleted';

-- Installments actions (2) — `installment.updated` omitido (imutáveis, DP8=A).
alter type public.audit_action add value if not exists 'installment.created';
alter type public.audit_action add value if not exists 'installment.deleted';
