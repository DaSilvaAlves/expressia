/**
 * Leitura server-side do estado de eliminação de conta — Story 6.9 AC6.
 *
 * Usado pela RSC `/conta/dados/page.tsx` para renderizar a secção de eliminação
 * com o estado actual (SSR, sem polling — AC6). Espelha a query do
 * `GET /api/conta/delete`.
 *
 * PO-FIX-1: filtro `household_id` explícito (RLS inerte em runtime via
 * `getDb()`); a policy `account_deletion_jobs_select_owner` é a 2.ª rede.
 *
 * Trace: Story 6.9 AC3/AC6; `account_deletion_jobs_select_owner`.
 */
import { sql } from 'drizzle-orm';

import { getDb } from '@/lib/agent/db-shim';
import type { AccountDeletionJobDTO } from '@/lib/api-schemas/account-deletion';

interface JobStatusRow {
  readonly id: string;
  readonly status: string;
  readonly scheduled_for: string;
  readonly created_at: string;
}

/**
 * Devolve o job de eliminação activo (`scheduled`/`in_progress`) do household,
 * ou `null` se não houver. Falha de DB devolve `null` (a UI mostra o estado
 * normal — degradação graciosa; o utilizador pode recarregar).
 */
export async function readActiveDeletionJob(
  householdId: string,
): Promise<AccountDeletionJobDTO | null> {
  try {
    const db = getDb();
    const result = await db.execute<JobStatusRow>(sql`
      select id, status, scheduled_for, created_at
      from public.account_deletion_jobs
      where household_id = ${householdId}::uuid
        and status in ('scheduled', 'in_progress')
      order by created_at desc
      limit 1
    `);
    const rows = Array.isArray(result) ? result : [];
    const row = rows[0];
    if (!row) return null;

    return {
      jobId: row.id,
      status: row.status as AccountDeletionJobDTO['status'],
      scheduledFor: new Date(row.scheduled_for).toISOString(),
      createdAt: new Date(row.created_at).toISOString(),
    };
  } catch {
    return null;
  }
}
