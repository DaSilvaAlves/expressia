-- =====================================================================
-- meu-jarvis (Expressia) — audit_action enum + idempotency index Finanças
-- Migração: 0015_finance_recurrences_generated_audit.sql
-- Data: 2026-05-22
-- Autor: Dex (@dev) — implementação Story 4.5 T1 (cron generate-finance-recurrences)
--
-- Contexto:
--   A Story 4.5 cria a Inngest function `generate-finance-recurrences` (cron
--   diário 03:00 UTC) que materializa as transacções das `recurrences` de
--   Finanças activas cujo `next_run_on <= today` (FR14, DP4=A). A function
--   precisa de 2 alterações de schema consolidadas:
--
--     (a) Novo value audit_action `finance_recurrences_generated` — para o
--         audit log INSERT agregado por job run (AC5 / NFR9). NÃO confundir
--         com `recurrences_generated` (migration 0013), que é o job sistémico
--         de TAREFAS (`generate-recurring-tasks`). Também distinto de
--         `finance_recurrence.created/updated/deleted` (migration 0014), que
--         são user-actions. O prefixo `finance_` alinha com a convenção
--         estabelecida na migration 0014 e desambigua de jobs de Tarefas.
--
--     (b) Índice unique parcial `transactions_recurrence_id_date_unique` —
--         idempotency da geração (R-4.5). O Inngest tem entrega at-least-once:
--         o mesmo cron tick pode disparar 2×. O handler usa INSERT ... ON
--         CONFLICT (recurrence_id, transaction_date) DO NOTHING; este índice
--         é a constraint que torna o ON CONFLICT possível. Parcial
--         (WHERE recurrence_id IS NOT NULL) — transacções não-recorrentes
--         (manuais ou de parcelas) não são afectadas.
--
-- Convenções (consistentes com 0013/0014):
--   - `IF NOT EXISTS` em ALTER TYPE / CREATE INDEX — idempotente (re-run safe).
--   - PG 16+ suporta ALTER TYPE ADD VALUE dentro de transação. O novo value
--     não pode ser usado na mesma transação que o adiciona — esta migração
--     apenas adiciona (zero INSERT que use o value), pelo que é safe.
--   - Tracking via __schema_migrations (apply-migrations.ts runner).
--
-- Sem breaking change:
--   - ALTER TYPE ADD VALUE é não-destrutivo (queries existentes inalteradas).
--   - O índice parcial só cobre rows com recurrence_id não-nulo; zero rows em
--     produção têm transacções de origem recorrente antes da Story 4.5 (esta
--     story é a primeira a popular `transactions.recurrence_id` via cron).
--
-- Trace: Story 4.5 T1, AC1, AC5, D-4.5.1, D-4.5.6, R-4.5.
--        Schema reference: packages/db/src/schema/audit.ts (auditActionEnum),
--                          packages/db/src/schema/finance.ts (transactions).
-- =====================================================================

-- (a) Audit action para o job sistémico de geração de finanças recorrentes.
alter type public.audit_action add value if not exists 'finance_recurrences_generated';

-- (b) Índice unique parcial — idempotency Inngest at-least-once delivery.
create unique index if not exists transactions_recurrence_id_date_unique
  on public.transactions (recurrence_id, transaction_date)
  where recurrence_id is not null;
