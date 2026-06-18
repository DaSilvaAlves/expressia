/**
 * Audit log para acções de export GDPR (Story 6.8 AC7 / NFR9).
 *
 * Os valores `data_export_requested` e `data_export_completed` já existem em
 * `auditActionEnum` (`packages/db/src/schema/audit.ts`). O helper partilhado
 * `insertAuditLog` (`api-helpers/audit.ts`) só aceita o union `TasksAuditAction`
 * (acções de tarefas/finanças/household), pelo que este helper dedicado faz o
 * INSERT directo destas duas acções GDPR. Best-effort: falhas são propagadas ao
 * chamador, que as trata como não-bloqueantes (audit é defesa em profundidade).
 *
 * Trace: Story 6.8 AC7; NFR9; `auditActionEnum` (data_export_requested/completed).
 */
import { sql } from 'drizzle-orm';

import type { DbShim } from '@/lib/agent/db-shim';

export type ExportAuditAction = 'data_export_requested' | 'data_export_completed';

/**
 * INSERT em `audit_log` para acções de export GDPR. `entityTable='data_export_jobs'`.
 */
export async function insertExportAuditLog(params: {
  readonly db: DbShim;
  readonly householdId: string;
  readonly userId: string;
  readonly action: ExportAuditAction;
  readonly jobId: string;
}): Promise<void> {
  const { db, householdId, userId, action, jobId } = params;
  await db.execute(sql`
    insert into public.audit_log (household_id, user_id, action, entity_table, entity_id)
    values (
      ${householdId}::uuid,
      ${userId}::uuid,
      ${action}::audit_action,
      'data_export_jobs',
      ${jobId}::uuid
    )
  `);
}
