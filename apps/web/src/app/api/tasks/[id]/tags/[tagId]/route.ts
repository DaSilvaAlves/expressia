/**
 * DELETE /api/tasks/[id]/tags/[tagId] — Story 3.2 AC4 (detach tag).
 *
 * Hard delete pivot row. Retorna 204 NO_CONTENT.
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
import { requireAuth } from '@/lib/api-helpers/auth';
import { insertAuditLog } from '@/lib/api-helpers/audit';

const ROUTE = '/api/tasks/[id]/tags/[tagId]';
const UuidParam = z.string().uuid();

interface RouteContext {
  params: Promise<{ id: string; tagId: string }>;
}

export async function DELETE(_req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  return withSpan(
    'DELETE /api/tasks/[id]/tags/[tagId]',
    { method: 'DELETE', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'DELETE' });
      const auth = await requireAuth(span);
      if (auth instanceof NextResponse) return auth;

      const { id: taskId, tagId } = await ctx.params;
      if (!UuidParam.safeParse(taskId).success || !UuidParam.safeParse(tagId).success) {
        annotateSpan(span, { statusCode: 400 });
        return apiError('VALIDATION_ERROR', 'IDs inválidos.', 400);
      }

      try {
        const db = getDb();
        const rows = await db.execute<{ task_id: string }>(sql`
          delete from public.task_tags
          where task_id = ${taskId}::uuid and tag_id = ${tagId}::uuid
          returning task_id
        `);

        if (rows.length === 0) {
          annotateSpan(span, { statusCode: 404 });
          return apiError('NOT_FOUND', 'Associação tarefa-tag não encontrada.', 404);
        }

        try {
          await insertAuditLog({
            db,
            householdId: auth.householdId,
            userId: auth.userId,
            action: 'task_tag.detached',
            entityTable: 'task_tags',
            beforeState: { task_id: taskId, tag_id: tagId },
          });
        } catch (auditErr) {
          log.warn({ err: auditErr }, 'audit_log INSERT falhou (best-effort)');
        }

        annotateSpan(span, { statusCode: 204 });
        return new NextResponse(null, { status: 204 });
      } catch (err) {
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'DELETE /api/tasks/[id]/tags/[tagId] falhou');
        captureException(err instanceof Error ? err : new Error(String(err)), {
          userId: auth.userId,
          route: ROUTE,
        });
        return apiError('INTERNAL_ERROR', 'Erro ao desassociar tag. Tenta novamente.', 500);
      }
    },
  );
}
