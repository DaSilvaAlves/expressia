/**
 * GET / PATCH / DELETE /api/financas/contas/[id] — Story 4.2 AC1 + AC3-AC9.
 *
 * GET:    Single account. RLS filtra — 404 se não existe ou cross-household.
 * PATCH:  Update parcial. Zod `.strict()` (todos opcionais). `household_id` e
 *         `currency` IMMUTABLE (`.strict()` rejeita-os com 400).
 * DELETE: Soft delete via `archived_at = now()` (DP-4.2.2). Variant
 *         `accounts_delete_owner_admin` (`0001:454`) — member recebe 403; só
 *         owner/admin arquiva (AC5).
 *
 * RLS: usa `getDb()` (role authenticated, RLS via JWT). Nunca o cliente
 * service-role que ignora RLS — vulnerabilidade crítica R-4.7.
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
import { AccountUpdateSchema } from '@/lib/api-schemas/accounts';
import { requireAuth, resolveHouseholdRole } from '@/lib/api-helpers/auth';
import { insertAuditLog } from '@/lib/api-helpers/audit';

const ROUTE = '/api/financas/contas/[id]';
const UuidParam = z.string().uuid();

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface AccountRow {
  id: string;
  household_id: string;
  name: string;
  bank_name: string | null;
  account_type: string;
  iban_last4: string | null;
  balance_cents: number;
  initial_balance_cents: number;
  currency: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

const ACCOUNT_COLUMNS = sql`
  id, household_id, name, bank_name, account_type, iban_last4,
  balance_cents, initial_balance_cents, currency, archived_at, created_at, updated_at
`;

export async function GET(_req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  return withSpan(
    'GET /api/financas/contas/[id]',
    { method: 'GET', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'GET' });
      const auth = await requireAuth(span);
      if (auth instanceof NextResponse) return auth;

      const { id } = await ctx.params;
      if (!UuidParam.safeParse(id).success) {
        annotateSpan(span, { statusCode: 400 });
        return apiError('VALIDATION_ERROR', 'ID de conta inválido.', 400);
      }

      try {
        const db = getDb();
        const rows = await db.execute<AccountRow>(sql`
          select ${ACCOUNT_COLUMNS}
          from public.accounts where id = ${id}::uuid limit 1
        `);

        const account = rows[0];
        if (!account) {
          annotateSpan(span, { statusCode: 404 });
          return apiError('NOT_FOUND', 'Conta não encontrada.', 404);
        }

        annotateSpan(span, { statusCode: 200 });
        return NextResponse.json({ account });
      } catch (err) {
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'GET /api/financas/contas/[id] falhou');
        captureException(err instanceof Error ? err : new Error(String(err)), {
          userId: auth.userId,
          route: ROUTE,
        });
        return apiError('INTERNAL_ERROR', 'Erro ao processar pedido. Tenta novamente.', 500);
      }
    },
  );
}

export async function PATCH(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  return withSpan(
    'PATCH /api/financas/contas/[id]',
    { method: 'PATCH', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'PATCH' });
      const auth = await requireAuth(span);
      if (auth instanceof NextResponse) return auth;

      const { id } = await ctx.params;
      if (!UuidParam.safeParse(id).success) {
        annotateSpan(span, { statusCode: 400 });
        return apiError('VALIDATION_ERROR', 'ID de conta inválido.', 400);
      }

      let body;
      try {
        body = AccountUpdateSchema.parse(await req.json());
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
        const sets = [];
        if (body.name !== undefined) sets.push(sql`name = ${body.name}`);
        if (body.account_type !== undefined) {
          sets.push(sql`account_type = ${body.account_type}::account_type`);
        }
        if (body.bank_name !== undefined) sets.push(sql`bank_name = ${body.bank_name}`);
        if (body.iban_last4 !== undefined) sets.push(sql`iban_last4 = ${body.iban_last4}`);

        if (sets.length === 0) {
          annotateSpan(span, { statusCode: 400 });
          return apiError('VALIDATION_ERROR', 'Nenhum campo fornecido para actualizar.', 400);
        }

        sets.push(sql`updated_at = now()`);
        const setSql = sets.reduce((acc, c, idx) => (idx === 0 ? c : sql`${acc}, ${c}`));

        const rows = await db.execute<AccountRow>(sql`
          update public.accounts set ${setSql} where id = ${id}::uuid
          returning ${ACCOUNT_COLUMNS}
        `);

        const account = rows[0];
        if (!account) {
          annotateSpan(span, { statusCode: 404 });
          return apiError('NOT_FOUND', 'Conta não encontrada.', 404);
        }

        try {
          await insertAuditLog({
            db,
            householdId: auth.householdId,
            userId: auth.userId,
            action: 'account.updated',
            entityTable: 'accounts',
            entityId: account.id,
            afterState: { name: account.name, account_type: account.account_type },
          });
        } catch (auditErr) {
          log.warn({ err: auditErr }, 'audit_log INSERT falhou (best-effort)');
        }

        annotateSpan(span, { statusCode: 200 });
        return NextResponse.json({ account });
      } catch (err) {
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'PATCH /api/financas/contas/[id] falhou');
        captureException(err instanceof Error ? err : new Error(String(err)), {
          userId: auth.userId,
          route: ROUTE,
        });
        return apiError('INTERNAL_ERROR', 'Erro ao processar pedido. Tenta novamente.', 500);
      }
    },
  );
}

export async function DELETE(_req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  return withSpan(
    'DELETE /api/financas/contas/[id]',
    { method: 'DELETE', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'DELETE' });
      const auth = await requireAuth(span);
      if (auth instanceof NextResponse) return auth;

      const { id } = await ctx.params;
      if (!UuidParam.safeParse(id).success) {
        annotateSpan(span, { statusCode: 400 });
        return apiError('VALIDATION_ERROR', 'ID de conta inválido.', 400);
      }

      // Variant accounts_delete_owner_admin: o soft-delete é tecnicamente um
      // UPDATE — a policy de UPDATE deixa passar qualquer member. Alinhamos a
      // semântica de "arquivar" com a intenção da policy `delete_owner_admin`
      // verificando o role explicitamente ANTES do UPDATE (AC5).
      const role = await resolveHouseholdRole(auth.userId, auth.householdId);
      if (role !== 'owner' && role !== 'admin') {
        annotateSpan(span, { statusCode: 403 });
        return apiError(
          'FORBIDDEN',
          'Apenas owner ou admin do household pode arquivar contas.',
          403,
        );
      }

      try {
        const db = getDb();
        // Soft delete (DP-4.2.2) — `archived_at = now()`, preserva histórico
        // financeiro (a FK `cards.account_id ON DELETE restrict` impede hard delete).
        const rows = await db.execute<{ id: string }>(sql`
          update public.accounts set archived_at = now(), updated_at = now()
          where id = ${id}::uuid
          returning id
        `);

        if (rows.length === 0) {
          annotateSpan(span, { statusCode: 404 });
          return apiError('NOT_FOUND', 'Conta não encontrada.', 404);
        }

        try {
          await insertAuditLog({
            db,
            householdId: auth.householdId,
            userId: auth.userId,
            action: 'account.deleted',
            entityTable: 'accounts',
            entityId: id,
          });
        } catch (auditErr) {
          log.warn({ err: auditErr }, 'audit_log INSERT falhou (best-effort)');
        }

        annotateSpan(span, { statusCode: 200 });
        return NextResponse.json({ archived: true, id });
      } catch (err) {
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'DELETE /api/financas/contas/[id] falhou');
        captureException(err instanceof Error ? err : new Error(String(err)), {
          userId: auth.userId,
          route: ROUTE,
        });
        return apiError('INTERNAL_ERROR', 'Erro ao processar pedido. Tenta novamente.', 500);
      }
    },
  );
}
