/**
 * Audit log para acções de eliminação de conta GDPR (Story 6.9 AC7 / NFR9).
 *
 * Os valores `account_deletion_requested` e `account_deletion_canceled` já
 * existem em `auditActionEnum` (`packages/db/src/schema/audit.ts:42-44`). O helper
 * partilhado `insertAuditLog` (`api-helpers/audit.ts`) só aceita o union
 * `TasksAuditAction` (acções de tarefas/finanças/household), pelo que este helper
 * dedicado faz o INSERT directo destas acções GDPR (precedente `gdpr/audit.ts` da
 * Story 6.8). Best-effort: falhas são propagadas ao chamador, que as trata como
 * não-bloqueantes (audit é defesa em profundidade).
 *
 * A terceira acção (`account_deletion_executed`) é inserida pelo job Inngest
 * `gdpr-purge` com `household_id = NULL` via `getServiceDb()` — fora do âmbito
 * deste helper de utilizador (ver `gdpr-purge.ts`).
 *
 * Trace: Story 6.9 AC7; NFR9; `auditActionEnum`
 *        (account_deletion_requested/canceled).
 */
import { sql } from 'drizzle-orm';

import type { DbShim } from '@/lib/agent/db-shim';

export type AccountDeletionAuditAction =
  | 'account_deletion_requested'
  | 'account_deletion_canceled';

/**
 * INSERT em `audit_log` para acções de eliminação de conta GDPR.
 * `entityTable='account_deletion_jobs'`.
 */
export async function insertAccountDeletionAuditLog(params: {
  readonly db: DbShim;
  readonly householdId: string;
  readonly userId: string;
  readonly action: AccountDeletionAuditAction;
  readonly jobId: string;
}): Promise<void> {
  const { db, householdId, userId, action, jobId } = params;
  await db.execute(sql`
    insert into public.audit_log (household_id, user_id, action, entity_table, entity_id)
    values (
      ${householdId}::uuid,
      ${userId}::uuid,
      ${action}::audit_action,
      'account_deletion_jobs',
      ${jobId}::uuid
    )
  `);
}
