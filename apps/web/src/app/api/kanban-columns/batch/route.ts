/**
 * PATCH /api/kanban-columns/batch — Story 3.4 AC11 + DP-3.4.6 (Aria ratify HIGH).
 *
 * Single endpoint atómico para guardar todas as alterações da ColumnConfigSheet.
 * Tudo em `db.transaction()` (BEGIN/COMMIT manual via execute — pattern Story 3.2
 * `/api/tasks/[id]/move`). Rollback total se qualquer operação falhar.
 *
 * Guidance Aria aplicada:
 *   - G2.1: Zod `.strict()` em todos os shapes; validação semântica (id ∈ household,
 *           move_to ∈ household e ≠ id, names únicos) feita server-side antes do commit.
 *   - G2.2: Ordem dentro da transaction:
 *           (1) DELETEs (com UPDATE tasks SET kanban_column_id = move_to ANTES de DELETE)
 *           (2) CREATEs
 *           (3) UPDATEs (sort_order rebalance + is_done_column toggle)
 *   - G2.3: Invariants pós-batch validadas server-side PRÉ-COMMIT — 422
 *           UNPROCESSABLE_ENTITY com `{ violations: [...] }` se falhar.
 *   - G2.4: Response shape `{ columns: KanbanColumn[] }` é o estado FINAL completo
 *           do household pós-batch. audit_log entry com `changes_summary`.
 *
 * Endpoint usado pelo ColumnConfigSheet ao "Guardar" — single request em vez de
 * múltiplos PATCHs (atomicidade + invariants multi-row).
 */
import { sql } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import {
  annotateSpan,
  captureException,
  childLogger,
  withSpan,
} from '@meu-jarvis/observability';

import { apiError } from '@/lib/errors';
import { getDb } from '@/lib/agent/db-shim';
import {
  BatchKanbanColumnsSchema,
  type BatchKanbanColumnsInput,
} from '@/lib/api-schemas/kanban-columns';
import { requireAuth } from '@/lib/api-helpers/auth';
import { insertAuditLog } from '@/lib/api-helpers/audit';
import type { DbShim } from '@/lib/agent/db-shim';

const ROUTE = '/api/kanban-columns/batch';
const MIN_COLUMNS = 3;
const MAX_COLUMNS = 6;

interface KanbanColumnDbRow {
  id: string;
  household_id: string;
  name: string;
  sort_order: number;
  color: string;
  is_done_column: boolean | string;
}

function isDoneBool(value: boolean | string): boolean {
  return typeof value === 'boolean' ? value : value === 'true';
}

type InvariantViolation =
  | 'count_out_of_range'
  | 'no_done_column'
  | 'multiple_done_columns'
  | 'duplicate_names'
  | 'invalid_column_id'
  | 'invalid_move_to'
  | 'move_to_self'
  | 'create_name_conflict';

/** Validações server-side dos invariants pós-batch (G2.3). */
async function validateInvariants(
  db: DbShim,
  householdId: string,
): Promise<InvariantViolation[]> {
  const violations: InvariantViolation[] = [];
  const rows = await db.execute<{
    id: string;
    name: string;
    is_done_column: boolean | string;
  }>(sql`
    select id, name, is_done_column from public.kanban_columns
    where household_id = ${householdId}::uuid
  `);

  if (rows.length < MIN_COLUMNS || rows.length > MAX_COLUMNS) {
    violations.push('count_out_of_range');
  }

  const doneCount = rows.filter((r) => isDoneBool(r.is_done_column)).length;
  if (doneCount === 0) violations.push('no_done_column');
  if (doneCount > 1) violations.push('multiple_done_columns');

  const lowerNames = rows.map((r) => r.name.toLowerCase());
  const uniqueLowerNames = new Set(lowerNames);
  if (lowerNames.length !== uniqueLowerNames.size) {
    violations.push('duplicate_names');
  }

  return violations;
}

/** Validações de input (pre-transaction — G2.1) — retorna lista de violations. */
async function validateInput(
  db: DbShim,
  householdId: string,
  body: BatchKanbanColumnsInput,
): Promise<InvariantViolation[]> {
  const violations: InvariantViolation[] = [];

  // Existing columns do household — usado para id checks + duplicate detection
  const existingRows = await db.execute<{ id: string; name: string }>(sql`
    select id, name from public.kanban_columns
    where household_id = ${householdId}::uuid
  `);
  const existingIds = new Set(existingRows.map((r) => r.id));
  const existingNamesLower = new Set(existingRows.map((r) => r.name.toLowerCase()));

  // columns[].id ∈ household
  for (const col of body.columns) {
    if (!existingIds.has(col.id)) {
      violations.push('invalid_column_id');
      break;
    }
  }

  // deletes[].id ∈ household + move_to ∈ household + move_to ≠ id
  if (body.deletes) {
    for (const del of body.deletes) {
      if (!existingIds.has(del.id)) {
        violations.push('invalid_column_id');
        break;
      }
      if (del.move_to) {
        if (del.move_to === del.id) {
          violations.push('move_to_self');
        } else if (!existingIds.has(del.move_to)) {
          violations.push('invalid_move_to');
        }
      }
    }
  }

  // creates[].name ≠ existing names (case-insensitive) e ≠ entre si
  if (body.creates) {
    const createLowerNames = body.creates.map((c) => c.name.toLowerCase());
    const seen = new Set<string>();
    for (const name of createLowerNames) {
      if (existingNamesLower.has(name) || seen.has(name)) {
        violations.push('create_name_conflict');
        break;
      }
      seen.add(name);
    }
    // Conflict com renames em columns[]
    if (body.columns.length > 0) {
      const renameLowerNames = body.columns
        .filter((c) => c.name !== undefined)
        .map((c) => c.name!.toLowerCase());
      for (const name of createLowerNames) {
        if (renameLowerNames.includes(name)) {
          violations.push('create_name_conflict');
          break;
        }
      }
    }
  }

  return Array.from(new Set(violations));
}

interface BatchSummary {
  creates_count: number;
  updates_count: number;
  deletes_count: number;
  renames: Array<{ id: string; from: string; to: string }>;
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  return withSpan(
    'PATCH /api/kanban-columns/batch',
    { method: 'PATCH', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'PATCH' });
      const auth = await requireAuth(span);
      if (auth instanceof NextResponse) return auth;

      let body: BatchKanbanColumnsInput;
      try {
        body = BatchKanbanColumnsSchema.parse(await req.json());
      } catch (err) {
        annotateSpan(span, { statusCode: 400 });
        if (err instanceof z.ZodError) {
          return apiError('VALIDATION_ERROR', 'Body inválido.', 400, {
            issues: err.issues.map((i) => ({ path: i.path, message: i.message })),
          });
        }
        return apiError('VALIDATION_ERROR', 'JSON malformado.', 400);
      }

      const summary: BatchSummary = {
        creates_count: 0,
        updates_count: 0,
        deletes_count: 0,
        renames: [],
      };

      try {
        const db = getDb();

        // Pre-input validation (G2.1) — referências cross-household + nomes duplicados
        const inputViolations = await validateInput(db, auth.householdId, body);
        if (inputViolations.length > 0) {
          annotateSpan(span, { statusCode: 422 });
          return NextResponse.json(
            {
              error: {
                code: 'INVARIANT_VIOLATION',
                message: 'Operação rejeitada: violações de invariants.',
                details: { violations: inputViolations },
                timestamp: new Date().toISOString(),
                requestId: crypto.randomUUID(),
              },
            },
            { status: 422 },
          );
        }

        // Snapshot pre-batch para audit + renames calc
        const beforeRows = await db.execute<KanbanColumnDbRow>(sql`
          select id, household_id, name, sort_order, color, is_done_column
          from public.kanban_columns
          where household_id = ${auth.householdId}::uuid
        `);
        const beforeById = new Map(beforeRows.map((r) => [r.id, r]));

        // Transaction (G2.2 — order: deletes, creates, updates)
        await db.execute(sql`begin`);
        try {
          // (1) DELETEs primeiro — move tasks ANTES de DELETE coluna
          if (body.deletes && body.deletes.length > 0) {
            for (const del of body.deletes) {
              if (del.move_to) {
                // SEC-1-F4: filtro household_id inline (defesa-em-profundidade;
                // validateInput já garante pertença, mas a RLS está inerte).
                await db.execute(sql`
                  update public.tasks
                  set kanban_column_id = ${del.move_to}::uuid, updated_at = now()
                  where kanban_column_id = ${del.id}::uuid
                    and household_id = ${auth.householdId}::uuid
                `);
              }
              await db.execute(sql`
                delete from public.kanban_columns
                where id = ${del.id}::uuid
                  and household_id = ${auth.householdId}::uuid
              `);
              summary.deletes_count++;
            }
          }

          // (2) CREATEs depois
          if (body.creates && body.creates.length > 0) {
            for (const create of body.creates) {
              // sort_order: MAX+1 se omitido
              let sortOrder = create.sort_order;
              if (sortOrder === undefined) {
                const maxRows = await db.execute<{ max_order: number | null }>(sql`
                  select coalesce(max(sort_order), -1) as max_order
                  from public.kanban_columns
                  where household_id = ${auth.householdId}::uuid
                `);
                sortOrder = (maxRows[0]?.max_order ?? -1) + 1;
              }
              await db.execute(sql`
                insert into public.kanban_columns (household_id, name, sort_order, color, is_done_column)
                values (
                  ${auth.householdId}::uuid,
                  ${create.name},
                  ${sortOrder},
                  ${create.color ?? '#6B7280'},
                  'false'
                )
              `);
              summary.creates_count++;
            }
          }

          // (3) UPDATEs — handle is_done_column toggle PRIMEIRO (single invariant)
          //     Se há um is_done_column=true a definir, desliga todos os outros.
          const newDoneCol = body.columns.find((c) => c.is_done_column === true);
          if (newDoneCol) {
            await db.execute(sql`
              update public.kanban_columns
              set is_done_column = 'false', updated_at = now()
              where household_id = ${auth.householdId}::uuid
                and id != ${newDoneCol.id}::uuid
                and is_done_column = 'true'
            `);
          }

          // sort_order trick: shift+offset para evitar colisão de unique(household_id, sort_order)
          //  Step 1: put all column sort_orders in temp negative space
          if (body.columns.length > 0) {
            for (const col of body.columns) {
              await db.execute(sql`
                update public.kanban_columns
                set sort_order = -100 - ${col.sort_order}, updated_at = now()
                where id = ${col.id}::uuid
                  and household_id = ${auth.householdId}::uuid
              `);
            }
            // Step 2: apply real sort_order + name + is_done_column
            for (const col of body.columns) {
              const sets: ReturnType<typeof sql>[] = [];
              sets.push(sql`sort_order = ${col.sort_order}`);
              if (col.name !== undefined) sets.push(sql`name = ${col.name}`);
              if (col.is_done_column !== undefined)
                sets.push(sql`is_done_column = ${col.is_done_column ? 'true' : 'false'}`);
              if (col.color !== undefined) sets.push(sql`color = ${col.color}`);
              sets.push(sql`updated_at = now()`);

              let updateSql = sql`update public.kanban_columns set `;
              for (let i = 0; i < sets.length; i++) {
                updateSql = i === 0 ? sql`${updateSql}${sets[i]}` : sql`${updateSql}, ${sets[i]}`;
              }
              updateSql = sql`${updateSql} where id = ${col.id}::uuid and household_id = ${auth.householdId}::uuid`;
              await db.execute(updateSql);

              summary.updates_count++;

              // Track renames
              const before = beforeById.get(col.id);
              if (before && col.name !== undefined && before.name !== col.name) {
                summary.renames.push({ id: col.id, from: before.name, to: col.name });
              }
            }
          }

          // (4) Validar invariants pós-batch (G2.3)
          const violations = await validateInvariants(db, auth.householdId);
          if (violations.length > 0) {
            await db.execute(sql`rollback`);
            annotateSpan(span, { statusCode: 422 });
            return NextResponse.json(
              {
                error: {
                  code: 'INVARIANT_VIOLATION',
                  message: 'Estado final viola invariants.',
                  details: { violations },
                  timestamp: new Date().toISOString(),
                  requestId: crypto.randomUUID(),
                },
              },
              { status: 422 },
            );
          }

          await db.execute(sql`commit`);
        } catch (txErr) {
          await db.execute(sql`rollback`);
          const message = txErr instanceof Error ? txErr.message : String(txErr);
          if (/unique|duplicate|23505/i.test(message)) {
            annotateSpan(span, { statusCode: 409 });
            return apiError(
              'CONFLICT',
              'Conflito ao guardar configuração — ordem ou nome duplicado.',
              409,
            );
          }
          throw txErr;
        }

        // Audit log (best-effort + feature flag gated)
        try {
          await insertAuditLog({
            db,
            householdId: auth.householdId,
            userId: auth.userId,
            action: 'kanban_column.batch_updated',
            entityTable: 'kanban_columns',
            entityId: null,
            afterState: {
              changes_summary: summary,
            },
          });
        } catch (auditErr) {
          log.warn({ err: auditErr }, 'audit_log INSERT falhou (best-effort)');
        }

        // G2.4: Response = estado final completo do household pós-batch
        const finalRows = await db.execute<KanbanColumnDbRow>(sql`
          select id, household_id, name, sort_order, color, is_done_column
          from public.kanban_columns
          where household_id = ${auth.householdId}::uuid
          order by sort_order asc
        `);
        annotateSpan(span, {
          statusCode: 200,
          extra: {
            'batch.creates_count': summary.creates_count,
            'batch.updates_count': summary.updates_count,
            'batch.deletes_count': summary.deletes_count,
            'batch.renames_count': summary.renames.length,
          },
        });
        return NextResponse.json({
          columns: finalRows.map((r) => ({
            id: r.id,
            name: r.name,
            sort_order: r.sort_order,
            color: r.color,
            is_done_column: isDoneBool(r.is_done_column),
          })),
        });
      } catch (err) {
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'PATCH /api/kanban-columns/batch falhou');
        captureException(err instanceof Error ? err : new Error(String(err)), {
          userId: auth.userId,
          route: ROUTE,
        });
        return apiError(
          'INTERNAL_ERROR',
          'Erro ao guardar configuração das colunas. Tenta novamente.',
          500,
        );
      }
    },
  );
}
