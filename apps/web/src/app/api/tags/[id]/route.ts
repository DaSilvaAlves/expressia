/**
 * PATCH / DELETE /api/tags/[id] — Story 3.2 AC3 + AC7-AC10.
 *
 * PATCH: Update (name/color). Unique constraint check em rename.
 * DELETE: Variant `tags_delete_owner_admin` (0001:416-418).
 *   - Member normal: 403 FORBIDDEN
 *   - Owner/admin: hard delete + CASCADE task_tags
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
import { TagUpdateSchema } from '@/lib/api-schemas/tags';
import { requireAuth, resolveHouseholdRole } from '@/lib/api-helpers/auth';
import { insertAuditLog } from '@/lib/api-helpers/audit';

const ROUTE = '/api/tags/[id]';
const UuidParam = z.string().uuid();

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  return withSpan(
    'PATCH /api/tags/[id]',
    { method: 'PATCH', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'PATCH' });
      const auth = await requireAuth(span);
      if (auth instanceof NextResponse) return auth;

      const { id } = await ctx.params;
      if (!UuidParam.safeParse(id).success) {
        annotateSpan(span, { statusCode: 400 });
        return apiError('VALIDATION_ERROR', 'ID de tag inválido.', 400);
      }

      let body;
      try {
        body = TagUpdateSchema.parse(await req.json());
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
        const db = getDb();
        const sets = [];
        if (body.name !== undefined) sets.push(sql`name = ${body.name}`);
        if (body.color !== undefined) sets.push(sql`color = ${body.color}`);

        if (sets.length === 0) {
          annotateSpan(span, { statusCode: 400 });
          return apiError('VALIDATION_ERROR', 'Nenhum campo fornecido para actualizar.', 400);
        }

        sets.push(sql`updated_at = now()`);
        const setSql = sets.reduce((acc, c, idx) => (idx === 0 ? c : sql`${acc}, ${c}`));

        const rows = await db.execute<{ id: string; name: string; color: string }>(sql`
          update public.tags set ${setSql}
          where id = ${id}::uuid and household_id = ${auth.householdId}::uuid
          returning id, household_id, name, color, created_at, updated_at
        `);

        const tag = rows[0];
        if (!tag) {
          annotateSpan(span, { statusCode: 404 });
          return apiError('NOT_FOUND', 'Tag não encontrada.', 404);
        }

        try {
          await insertAuditLog({
            db,
            householdId: auth.householdId,
            userId: auth.userId,
            action: 'tag.updated',
            entityTable: 'tags',
            entityId: tag.id,
            afterState: { name: tag.name, color: tag.color },
          });
        } catch (auditErr) {
          log.warn({ err: auditErr }, 'audit_log INSERT falhou (best-effort)');
        }

        annotateSpan(span, { statusCode: 200 });
        return NextResponse.json({ tag });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (/unique|duplicate|23505|tags_unique_name_per_household/i.test(message)) {
          annotateSpan(span, { statusCode: 409 });
          return apiError('CONFLICT', 'Tag com este nome já existe neste household.', 409);
        }
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'PATCH /api/tags/[id] falhou');
        captureException(err instanceof Error ? err : new Error(String(err)), {
          userId: auth.userId,
          route: ROUTE,
        });
        return apiError('INTERNAL_ERROR', 'Erro ao actualizar tag. Tenta novamente.', 500);
      }
    },
  );
}

export async function DELETE(_req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  return withSpan(
    'DELETE /api/tags/[id]',
    { method: 'DELETE', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'DELETE' });
      const auth = await requireAuth(span);
      if (auth instanceof NextResponse) return auth;

      const { id } = await ctx.params;
      if (!UuidParam.safeParse(id).success) {
        annotateSpan(span, { statusCode: 400 });
        return apiError('VALIDATION_ERROR', 'ID de tag inválido.', 400);
      }

      // Variant tags_delete_owner_admin: verificar role ANTES de DELETE
      const role = await resolveHouseholdRole(auth.userId, auth.householdId);
      if (role !== 'owner' && role !== 'admin') {
        annotateSpan(span, { statusCode: 403 });
        return apiError(
          'FORBIDDEN',
          'Apenas owner ou admin do household pode eliminar tags.',
          403,
        );
      }

      try {
        const db = getDb();
        const rows = await db.execute<{ id: string }>(sql`
          delete from public.tags
          where id = ${id}::uuid and household_id = ${auth.householdId}::uuid
          returning id
        `);

        if (rows.length === 0) {
          annotateSpan(span, { statusCode: 404 });
          return apiError('NOT_FOUND', 'Tag não encontrada.', 404);
        }

        try {
          await insertAuditLog({
            db,
            householdId: auth.householdId,
            userId: auth.userId,
            action: 'tag.deleted',
            entityTable: 'tags',
            entityId: id,
          });
        } catch (auditErr) {
          log.warn({ err: auditErr }, 'audit_log INSERT falhou (best-effort)');
        }

        annotateSpan(span, { statusCode: 200 });
        return NextResponse.json({ deleted: true, id });
      } catch (err) {
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'DELETE /api/tags/[id] falhou');
        captureException(err instanceof Error ? err : new Error(String(err)), {
          userId: auth.userId,
          route: ROUTE,
        });
        return apiError('INTERNAL_ERROR', 'Erro ao eliminar tag. Tenta novamente.', 500);
      }
    },
  );
}
