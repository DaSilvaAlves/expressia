/**
 * Audit log helper Story 3.2 — INSERT em mutations POST/PATCH/DELETE (AC10).
 *
 * Enum values F1 HIGH migration 0010 — `task.created/updated/deleted/moved/completed`,
 * `tag.created/updated/deleted`, `task_tag.attached/detached`,
 * `recurrence.created/updated/deleted`.
 *
 * Story 3.4 (Kanban) — extension preparatória:
 *   4 novos values `kanban_column.created/updated/deleted/batch_updated` adicionados
 *   ao type union + `'kanban_columns'` adicionado ao `entityTable`. O enum Postgres
 *   correspondente é adicionado pela migration 0011 (T10.1 — pending Dara).
 *
 *   Feature flag `KANBAN_AUDIT_ENABLED` (env var, default `false`) protege os
 *   endpoints de kanban-columns de tentarem inserir um value de enum que ainda
 *   não existe na DB. Quando migration 0011 estiver aplicada em prod, flippar para
 *   `true` no `.env` + remover este flag em PR follow-up (T10.3 housekeeping).
 *
 *   [DEV-DECISION D-3.4.1]: Type rename `TasksAuditAction` → `DomainAuditAction`
 *   adiado como housekeeping NIT-AR-3.4.1 (não-bloqueante Story 3.4). Mantém-se
 *   nome `TasksAuditAction` por consistência com call-sites existentes em Story 3.2.
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
  | 'recurrence.deleted'
  // Story 3.4 Kanban (pendente migration 0011 — DB enum extension)
  | 'kanban_column.created'
  | 'kanban_column.updated'
  | 'kanban_column.deleted'
  | 'kanban_column.batch_updated'
  // Story 4.2 Módulo Finanças — enum values JÁ presentes na DB (migration 0014,
  // Story 4.1, pushed `57d369c`). Extensão puramente aditiva — sem migration nem
  // feature flag (contraste com o caso kanban_column.* acima).
  | 'account.created'
  | 'account.updated'
  | 'account.deleted'
  | 'card.created'
  | 'card.updated'
  | 'card.deleted';

export interface AuditLogParams {
  readonly db: DbShim;
  readonly householdId: string;
  readonly userId: string;
  readonly action: TasksAuditAction;
  readonly entityTable:
    | 'tasks'
    | 'tags'
    | 'task_tags'
    | 'task_recurrences'
    | 'kanban_columns'
    | 'accounts'
    | 'cards';
  readonly entityId?: string | null;
  readonly beforeState?: Record<string, unknown> | null;
  readonly afterState?: Record<string, unknown> | null;
}

/**
 * Feature flag — proteger audit log para kanban_column.* actions até migration 0011
 * estar aplicada (PG enum precisa de `ALTER TYPE ADD VALUE`).
 *
 * Default `false` em todos os ambientes. Quando migration 0011 estiver mergeada
 * + aplicada em prod (`pnpm db:migrate` corrido), env var `KANBAN_AUDIT_ENABLED=true`
 * liga. T10.3 housekeeping remove este flag e força sempre on.
 */
function isKanbanAuditEnabled(): boolean {
  return process.env.KANBAN_AUDIT_ENABLED === 'true';
}

function isKanbanAction(action: TasksAuditAction): boolean {
  return action.startsWith('kanban_column.');
}

/**
 * INSERT em audit_log para mutations. Best-effort — falhas são logged mas
 * não bloqueiam a operação principal (audit é defesa em profundidade).
 *
 * Para actions `kanban_column.*` é necessário que a migration 0011 esteja
 * aplicada (adiciona os enum values). Por defeito o INSERT é skipped quando
 * `KANBAN_AUDIT_ENABLED !== 'true'`. Ver `isKanbanAuditEnabled()`.
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

  // Story 3.4 — guard: kanban_column.* actions só inserem após migration 0011
  if (isKanbanAction(action) && !isKanbanAuditEnabled()) {
    return;
  }

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
