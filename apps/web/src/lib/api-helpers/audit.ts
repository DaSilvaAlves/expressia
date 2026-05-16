/**
 * Audit log helper Story 3.2 — INSERT em mutations POST/PATCH/DELETE (AC10).
 *
 * Enum values F1 HIGH migration 0010 — `task.created/updated/deleted/moved/completed`,
 * `tag.created/updated/deleted`, `task_tag.attached/detached`,
 * `recurrence.created/updated/deleted`.
 */
import { sql } from 'drizzle-orm';

import type { DbShim } from '@/lib/agent/db-shim';

export type TasksAuditAction =
  | 'task.created'
  | 'task.updated'
  | 'task.deleted'
  | 'task.moved'
  | 'task.completed'
  | 'tag.created'
  | 'tag.updated'
  | 'tag.deleted'
  | 'task_tag.attached'
  | 'task_tag.detached'
  | 'recurrence.created'
  | 'recurrence.updated'
  | 'recurrence.deleted';

export interface AuditLogParams {
  readonly db: DbShim;
  readonly householdId: string;
  readonly userId: string;
  readonly action: TasksAuditAction;
  readonly entityTable: 'tasks' | 'tags' | 'task_tags' | 'task_recurrences';
  readonly entityId?: string | null;
  readonly beforeState?: Record<string, unknown> | null;
  readonly afterState?: Record<string, unknown> | null;
}

/**
 * INSERT em audit_log para mutations. Best-effort — falhas são logged mas
 * não bloqueiam a operação principal (audit é defesa em profundidade).
 */
export async function insertAuditLog(params: AuditLogParams): Promise<void> {
  const {
    db,
    householdId,
    userId,
    action,
    entityTable,
    entityId = null,
    beforeState = null,
    afterState = null,
  } = params;

  await db.execute(sql`
    insert into public.audit_log (household_id, user_id, action, entity_table, entity_id, before_state, after_state)
    values (
      ${householdId}::uuid,
      ${userId}::uuid,
      ${action}::audit_action,
      ${entityTable},
      ${entityId ? sql`${entityId}::uuid` : sql`null`},
      ${beforeState ? sql`${JSON.stringify(beforeState)}::jsonb` : sql`null`},
      ${afterState ? sql`${JSON.stringify(afterState)}::jsonb` : sql`null`}
    )
  `);
}
