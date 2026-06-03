/**
 * DELETE /api/conta/household/invites/[id] — Story 6.7 (revogar convite).
 *
 * Revoga (elimina) um convite pendente do household. Só `owner`/`admin` (403
 * limpo na app; a RLS `household_invites_delete_owner_admin` reforça). 404 se o
 * convite não existir ou não pertencer ao household (a RLS filtra por household).
 *
 * RLS (SEC-7 — ADR-003 Fase 4 Fatia C): o DELETE de domínio corre dentro de
 * `withHousehold` (role authenticated + JWT claims — 2.ª rede). O
 * `insertAuditLog` permanece best-effort FORA do `withHousehold` em `getDb()`
 * (handler misto — import expõe ambos). Nunca `getServiceDb()`.
 * Trace: Story 6.7 AC4; 0001:143-148 (RLS delete owner/admin); FR27; ADR-003 §11.3.
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

import { getDb, withHousehold } from '@/lib/agent/db-shim';
import { insertAuditLog } from '@/lib/api-helpers/audit';
import { requireAuth, resolveHouseholdRole } from '@/lib/api-helpers/auth';
import { apiError } from '@/lib/errors';

const ROUTE = '/api/conta/household/invites/[id]';
const UuidParam = z.string().uuid();
const ROLES_CAN_MANAGE = ['owner', 'admin'] as const;

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function DELETE(_req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  return withSpan(
    'DELETE /api/conta/household/invites/[id]',
    { method: 'DELETE', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'DELETE' });
      const auth = await requireAuth(span);
      if (auth instanceof NextResponse) return auth;

      const { id } = await ctx.params;
      if (!UuidParam.safeParse(id).success) {
        annotateSpan(span, { statusCode: 400 });
        return apiError('VALIDATION_ERROR', 'ID de convite inválido.', 400);
      }

      const role = await resolveHouseholdRole(auth.userId, auth.householdId);
      if (!role || !ROLES_CAN_MANAGE.includes(role as (typeof ROLES_CAN_MANAGE)[number])) {
        annotateSpan(span, { statusCode: 403 });
        return apiError('FORBIDDEN', 'Apenas o dono ou um admin podem revogar convites.', 403);
      }

      try {
        // `getDb()` mantém-se para o `insertAuditLog` best-effort (fora da tx).
        const db = getDb();
        // SEC-7 — DELETE de domínio dentro de `withHousehold` (2.ª rede RLS).
        const rows = await withHousehold(
          { userId: auth.userId, householdId: auth.householdId },
          (tx) =>
            tx.execute<{ id: string; email: string }>(sql`
              delete from public.household_invites
              where id = ${id}::uuid
                and household_id = ${auth.householdId}::uuid
              returning id, email
            `),
        );

        const deleted = rows[0];
        if (!deleted) {
          annotateSpan(span, { statusCode: 404 });
          return apiError('NOT_FOUND', 'Convite não encontrado.', 404);
        }

        try {
          await insertAuditLog({
            db,
            householdId: auth.householdId,
            userId: auth.userId,
            action: 'household_invite_revoked',
            entityTable: 'household_invites',
            entityId: deleted.id,
            beforeState: { email: deleted.email },
          });
        } catch (auditErr) {
          log.warn({ err: auditErr }, 'audit_log INSERT falhou (best-effort)');
        }

        annotateSpan(span, { statusCode: 200 });
        return NextResponse.json({ revoked: true, id: deleted.id });
      } catch (err) {
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'DELETE /api/conta/household/invites/[id] falhou');
        captureException(err instanceof Error ? err : new Error(String(err)), {
          userId: auth.userId,
          route: ROUTE,
        });
        return apiError('INTERNAL_ERROR', 'Erro ao revogar o convite. Tenta novamente.', 500);
      }
    },
  );
}
