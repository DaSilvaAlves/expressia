/**
 * DELETE /api/conta/household/members/[userId] — Story 6.7 (remover membro).
 *
 * Remove um membro do household (elimina a row `household_members`). Só
 * `owner`/`admin`. **Guard inegociável: nunca remover um membro `owner`** —
 * devolve 422 (DEV-DECISION D-6.7.4: Unprocessable Entity para "owner não
 * removível"). Remove apenas o membership; os dados do household (tarefas,
 * finanças) ficam (o `household_id` não muda).
 *
 * RLS: `getDb()` (role authenticated). A policy `household_members_delete_*`
 * permite owner/admin (ou auto-saída); a regra de negócio "nunca o owner" é
 * aplicada na app. Nunca `getServiceDb()`.
 * Trace: Story 6.7 AC5; 0001:94-110 (RLS household_members); FR27.
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

import { getDb } from '@/lib/agent/db-shim';
import { insertAuditLog } from '@/lib/api-helpers/audit';
import { requireAuth, resolveHouseholdRole } from '@/lib/api-helpers/auth';
import { apiError } from '@/lib/errors';

const ROUTE = '/api/conta/household/members/[userId]';
const UuidParam = z.string().uuid();
const ROLES_CAN_MANAGE = ['owner', 'admin'] as const;

interface RouteContext {
  params: Promise<{ userId: string }>;
}

export async function DELETE(_req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  return withSpan(
    'DELETE /api/conta/household/members/[userId]',
    { method: 'DELETE', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'DELETE' });
      const auth = await requireAuth(span);
      if (auth instanceof NextResponse) return auth;

      const { userId: targetUserId } = await ctx.params;
      if (!UuidParam.safeParse(targetUserId).success) {
        annotateSpan(span, { statusCode: 400 });
        return apiError('VALIDATION_ERROR', 'ID de membro inválido.', 400);
      }

      const role = await resolveHouseholdRole(auth.userId, auth.householdId);
      if (!role || !ROLES_CAN_MANAGE.includes(role as (typeof ROLES_CAN_MANAGE)[number])) {
        annotateSpan(span, { statusCode: 403 });
        return apiError('FORBIDDEN', 'Apenas o dono ou um admin podem remover membros.', 403);
      }

      try {
        const db = getDb();

        // Papel do membro-alvo (404 se não pertence ao household).
        const targetRows = await db.execute<{ role: string }>(sql`
          select role from public.household_members
          where household_id = ${auth.householdId}::uuid
            and user_id = ${targetUserId}::uuid
          limit 1
        `);

        const targetRole = targetRows[0]?.role;
        if (!targetRole) {
          annotateSpan(span, { statusCode: 404 });
          return apiError('NOT_FOUND', 'Membro não encontrado nesta família.', 404);
        }

        // Guard inegociável: o owner nunca pode ser removido (D-6.7.4 → 422).
        if (targetRole === 'owner') {
          annotateSpan(span, { statusCode: 422 });
          return apiError(
            'OWNER_NOT_REMOVABLE',
            'O dono da família não pode ser removido.',
            422,
          );
        }

        const deleted = await db.execute<{ user_id: string }>(sql`
          delete from public.household_members
          where household_id = ${auth.householdId}::uuid
            and user_id = ${targetUserId}::uuid
          returning user_id
        `);

        if (deleted.length === 0) {
          annotateSpan(span, { statusCode: 404 });
          return apiError('NOT_FOUND', 'Membro não encontrado nesta família.', 404);
        }

        try {
          await insertAuditLog({
            db,
            householdId: auth.householdId,
            userId: auth.userId,
            action: 'household_member_removed',
            entityTable: 'household_members',
            entityId: targetUserId,
            beforeState: { user_id: targetUserId, role: targetRole },
          });
        } catch (auditErr) {
          log.warn({ err: auditErr }, 'audit_log INSERT falhou (best-effort)');
        }

        annotateSpan(span, { statusCode: 200 });
        return NextResponse.json({ removed: true, userId: targetUserId });
      } catch (err) {
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'DELETE /api/conta/household/members/[userId] falhou');
        captureException(err instanceof Error ? err : new Error(String(err)), {
          userId: auth.userId,
          route: ROUTE,
        });
        return apiError('INTERNAL_ERROR', 'Erro ao remover o membro. Tenta novamente.', 500);
      }
    },
  );
}
