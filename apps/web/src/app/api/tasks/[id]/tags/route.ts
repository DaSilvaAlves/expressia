/**
 * POST /api/tasks/[id]/tags — Story 3.2 AC4 (attach tag a task).
 *
 * Body: { tag_id: uuid }
 * Idempotente via ON CONFLICT (task_id, tag_id) DO NOTHING.
 * Cross-household → RLS bloqueia ambos task e tag (200 OK mas 0 rows affected
 * é tratado como 404 NOT_FOUND).
 *
 * RLS (SEC-5 / ADR-003 Fase 4 Fatia A): a verificação de existência (task + tag)
 * e o INSERT idempotente correm no MESMO `withHousehold` (2.ª rede + atomicidade).
 * O filtro `household_id` (SEC-1, 1.ª rede) MANTÉM-SE. Retorno discriminado
 * preserva o 404 sem `return` de NextResponse dentro do callback. O `insertAuditLog`
 * permanece best-effort FORA do `withHousehold` em `getDb()` (PO-FIX-2 / D-SEC3).
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
import { getDb, withHousehold } from '@/lib/agent/db-shim';
import { TaskTagAttachSchema } from '@/lib/api-schemas/tags';
import { requireAuth } from '@/lib/api-helpers/auth';
import { insertAuditLog } from '@/lib/api-helpers/audit';

const ROUTE = '/api/tasks/[id]/tags';
const UuidParam = z.string().uuid();

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  return withSpan(
    'POST /api/tasks/[id]/tags',
    { method: 'POST', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'POST' });
      const auth = await requireAuth(span);
      if (auth instanceof NextResponse) return auth;

      const { id: taskId } = await ctx.params;
      if (!UuidParam.safeParse(taskId).success) {
        annotateSpan(span, { statusCode: 400 });
        return apiError('VALIDATION_ERROR', 'ID de tarefa inválido.', 400);
      }

      let body;
      try {
        body = TaskTagAttachSchema.parse(await req.json());
      } catch (err) {
        annotateSpan(span, { statusCode: 400 });
        if (err instanceof z.ZodError) {
          return apiError('VALIDATION_ERROR', 'Dados inválidos.', 400, {
            issues: err.issues.map((i) => ({ path: i.path, message: i.message })),
          });
        }
        return apiError('VALIDATION_ERROR', 'Body inválido.', 400);
      }

      try {
        // PO-FIX-2: `getDb()` mantém-se para o `insertAuditLog` best-effort (abaixo).
        const db = getDb();

        // SEC-5: verificação de existência (task + tag) + INSERT idempotente no
        // MESMO `withHousehold`. O filtro `household_id` app-enforced (SEC-1, 1.ª rede)
        // MANTÉM-SE; a RLS (2.ª rede) passa a estar viva via transação.
        const result = await withHousehold(
          { userId: auth.userId, householdId: auth.householdId },
          async (tx): Promise<{ notFound: true } | { ok: true }> => {
            const checkRows = await tx.execute<{ task_id: string; tag_id: string }>(sql`
              select
                (select id from public.tasks
                  where id = ${taskId}::uuid and household_id = ${auth.householdId}::uuid limit 1) as task_id,
                (select id from public.tags
                  where id = ${body.tag_id}::uuid and household_id = ${auth.householdId}::uuid limit 1) as tag_id
            `);

            const check = checkRows[0];
            if (!check?.task_id || !check?.tag_id) return { notFound: true };

            // INSERT idempotente
            await tx.execute(sql`
              insert into public.task_tags (task_id, tag_id, household_id)
              values (${taskId}::uuid, ${body.tag_id}::uuid, ${auth.householdId}::uuid)
              on conflict (task_id, tag_id) do nothing
            `);

            return { ok: true };
          },
        );

        if ('notFound' in result) {
          annotateSpan(span, { statusCode: 404 });
          return apiError('NOT_FOUND', 'Tarefa ou tag não encontradas.', 404);
        }

        try {
          await insertAuditLog({
            db,
            householdId: auth.householdId,
            userId: auth.userId,
            action: 'task_tag.attached',
            entityTable: 'task_tags',
            afterState: { task_id: taskId, tag_id: body.tag_id },
          });
        } catch (auditErr) {
          log.warn({ err: auditErr }, 'audit_log INSERT falhou (best-effort)');
        }

        annotateSpan(span, { statusCode: 201 });
        return NextResponse.json(
          { attached: true, task_id: taskId, tag_id: body.tag_id },
          { status: 201 },
        );
      } catch (err) {
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'POST /api/tasks/[id]/tags falhou');
        captureException(err instanceof Error ? err : new Error(String(err)), {
          userId: auth.userId,
          route: ROUTE,
        });
        return apiError('INTERNAL_ERROR', 'Erro ao associar tag. Tenta novamente.', 500);
      }
    },
  );
}
