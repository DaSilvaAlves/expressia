/**
 * GET / POST /api/kanban-columns — Story 3.4 AC7 + AC8.
 *
 * GET: Lista colunas Kanban do household autenticado, ordenadas por sort_order ASC.
 *      Auth via JWT → RLS authenticated role (4 policies kanban_columns_*).
 *      Sem audit_log (read-only).
 *
 * POST: Cria nova coluna. Zod strict body. Valida count(*) < 6 server-side
 *       (defesa em profundidade — migration 0011 adicionará CHECK constraint DB).
 *       Nome único per household (constraint app-layer; DB unique pendente migration).
 *       sort_order = MAX+1 se omitido. audit_log entry `kanban_column.created`
 *       (skipped até KANBAN_AUDIT_ENABLED=true — ver audit.ts).
 *
 * Mantém pattern Story 3.2 (`api/tags/route.ts`): withSpan + childLogger + apiError
 * + requireAuth + getDb + insertAuditLog.
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
  CreateKanbanColumnSchema,
  type KanbanColumnRow,
} from '@/lib/api-schemas/kanban-columns';
import { requireAuth } from '@/lib/api-helpers/auth';
import { insertAuditLog } from '@/lib/api-helpers/audit';

const ROUTE = '/api/kanban-columns';
const MAX_COLUMNS_PER_HOUSEHOLD = 6;

interface KanbanColumnDbRow {
  id: string;
  household_id: string;
  name: string;
  sort_order: number;
  color: string;
  is_done_column: boolean | string;
  created_at: string;
  updated_at: string;
}

/**
 * Normaliza `is_done_column` para boolean — schema actual é text ('true'/'false'),
 * migration 0011 converte para boolean. Esta função funciona com ambos.
 */
function normalizeColumn(row: KanbanColumnDbRow): KanbanColumnRow {
  const isDone =
    typeof row.is_done_column === 'boolean'
      ? row.is_done_column
      : row.is_done_column === 'true';
  return {
    id: row.id,
    name: row.name,
    sort_order: row.sort_order,
    color: row.color,
    is_done_column: isDone,
  };
}

export async function GET(): Promise<NextResponse> {
  return withSpan(
    'GET /api/kanban-columns',
    { method: 'GET', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'GET' });
      const auth = await requireAuth(span);
      if (auth instanceof NextResponse) return auth;

      try {
        const db = getDb();
        const rows = await db.execute<KanbanColumnDbRow>(sql`
          select id, household_id, name, sort_order, color, is_done_column,
                 created_at, updated_at
          from public.kanban_columns
          where household_id = ${auth.householdId}::uuid
          order by sort_order asc
        `);
        annotateSpan(span, { statusCode: 200 });
        return NextResponse.json(
          { columns: rows.map(normalizeColumn) },
          { headers: { 'Cache-Control': 'no-store' } },
        );
      } catch (err) {
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'GET /api/kanban-columns falhou');
        captureException(err instanceof Error ? err : new Error(String(err)), {
          userId: auth.userId,
          route: ROUTE,
        });
        return apiError('INTERNAL_ERROR', 'Erro ao listar colunas Kanban. Tenta novamente.', 500);
      }
    },
  );
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return withSpan(
    'POST /api/kanban-columns',
    { method: 'POST', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'POST' });
      const auth = await requireAuth(span);
      if (auth instanceof NextResponse) return auth;

      let body;
      try {
        body = CreateKanbanColumnSchema.parse(await req.json());
      } catch (err) {
        annotateSpan(span, { statusCode: 400 });
        if (err instanceof z.ZodError) {
          return apiError('VALIDATION_ERROR', 'Dados inválidos.', 400, {
            issues: err.issues.map((i) => ({ path: i.path, message: i.message })),
          });
        }
        return apiError('VALIDATION_ERROR', 'Body inválido — JSON malformado.', 400);
      }

      try {
        const db = getDb();

        // 1. Defesa em profundidade — valida count < 6 antes do INSERT (DB CHECK pendente migration 0011).
        const countRows = await db.execute<{ count: string }>(sql`
          select count(*)::text as count from public.kanban_columns
          where household_id = ${auth.householdId}::uuid
        `);
        const currentCount = Number(countRows[0]?.count ?? '0');
        if (currentCount >= MAX_COLUMNS_PER_HOUSEHOLD) {
          annotateSpan(span, { statusCode: 409 });
          return apiError(
            'COLUMN_LIMIT_REACHED',
            'Máximo de 6 colunas atingido. Elimina uma antes de criar outra.',
            409,
          );
        }

        // 2. Nome único per household — verificação app-layer.
        const dupRows = await db.execute<{ id: string }>(sql`
          select id from public.kanban_columns
          where household_id = ${auth.householdId}::uuid and lower(name) = lower(${body.name})
          limit 1
        `);
        if (dupRows.length > 0) {
          annotateSpan(span, { statusCode: 409 });
          return apiError('DUPLICATE_NAME', 'Já existe uma coluna com este nome.', 409);
        }

        // 3. sort_order: MAX+1 se omitido.
        let sortOrder = body.sort_order;
        if (sortOrder === undefined) {
          const maxRows = await db.execute<{ max_order: number | null }>(sql`
            select coalesce(max(sort_order), -1) as max_order
            from public.kanban_columns
            where household_id = ${auth.householdId}::uuid
          `);
          sortOrder = (maxRows[0]?.max_order ?? -1) + 1;
        }

        // 4. INSERT
        const inserted = await db.execute<KanbanColumnDbRow>(sql`
          insert into public.kanban_columns (household_id, name, sort_order, color, is_done_column)
          values (
            ${auth.householdId}::uuid,
            ${body.name},
            ${sortOrder},
            ${body.color ?? '#6B7280'},
            'false'
          )
          returning id, household_id, name, sort_order, color, is_done_column,
                    created_at, updated_at
        `);

        const column = inserted[0];
        if (!column) throw new Error('INSERT kanban_columns retornou sem rows.');

        // 5. audit_log (best-effort + feature-flag gated até migration 0011)
        try {
          await insertAuditLog({
            db,
            householdId: auth.householdId,
            userId: auth.userId,
            action: 'kanban_column.created',
            entityTable: 'kanban_columns',
            entityId: column.id,
            afterState: {
              name: column.name,
              sort_order: column.sort_order,
              color: column.color,
            },
          });
        } catch (auditErr) {
          log.warn({ err: auditErr }, 'audit_log INSERT falhou (best-effort)');
        }

        annotateSpan(span, { statusCode: 201 });
        return NextResponse.json({ column: normalizeColumn(column) }, { status: 201 });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (/unique|duplicate|23505/i.test(message)) {
          annotateSpan(span, { statusCode: 409 });
          return apiError('CONFLICT', 'Já existe uma coluna com este nome ou ordem.', 409);
        }
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'POST /api/kanban-columns falhou');
        captureException(err instanceof Error ? err : new Error(String(err)), {
          userId: auth.userId,
          route: ROUTE,
        });
        return apiError('INTERNAL_ERROR', 'Erro ao criar coluna. Tenta novamente.', 500);
      }
    },
  );
}
