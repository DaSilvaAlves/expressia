/**
 * GET / PATCH / DELETE /api/financas/cartoes/[id] — Story 4.2 AC2 + AC3-AC9.
 *
 * GET:    Single card. RLS filtra — 404 se não existe ou cross-household.
 * PATCH:  Update parcial. Zod `.strict()` (todos opcionais). `household_id` e
 *         `account_id` IMMUTABLE (`.strict()` rejeita-os com 400). A violação do
 *         CHECK `cards_credit_needs_limit` (mudar para `credit` sem limite) é
 *         convertida em 400 VALIDATION_ERROR.
 * DELETE: Soft delete via `archived_at = now()` (DP-4.2.2). Variant
 *         `cards_delete_owner_admin` (`0001:471`) — member recebe 403 (AC5).
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
import { CardUpdateSchema } from '@/lib/api-schemas/cards';
import { requireAuth, resolveHouseholdRole } from '@/lib/api-helpers/auth';
import { insertAuditLog } from '@/lib/api-helpers/audit';

const ROUTE = '/api/financas/cartoes/[id]';
const UuidParam = z.string().uuid();

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface CardRow {
  id: string;
  household_id: string;
  account_id: string;
  name: string;
  last4: string | null;
  card_type: string;
  closing_day: number | null;
  due_day: number | null;
  credit_limit_cents: number | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

const CARD_COLUMNS = sql`
  id, household_id, account_id, name, last4, card_type,
  closing_day, due_day, credit_limit_cents, archived_at, created_at, updated_at
`;

export async function GET(_req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  return withSpan(
    'GET /api/financas/cartoes/[id]',
    { method: 'GET', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'GET' });
      const auth = await requireAuth(span);
      if (auth instanceof NextResponse) return auth;

      const { id } = await ctx.params;
      if (!UuidParam.safeParse(id).success) {
        annotateSpan(span, { statusCode: 400 });
        return apiError('VALIDATION_ERROR', 'ID de cartão inválido.', 400);
      }

      try {
        const db = getDb();
        const rows = await db.execute<CardRow>(sql`
          select ${CARD_COLUMNS}
          from public.cards where id = ${id}::uuid limit 1
        `);

        const card = rows[0];
        if (!card) {
          annotateSpan(span, { statusCode: 404 });
          return apiError('NOT_FOUND', 'Cartão não encontrado.', 404);
        }

        annotateSpan(span, { statusCode: 200 });
        return NextResponse.json({ card });
      } catch (err) {
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'GET /api/financas/cartoes/[id] falhou');
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
    'PATCH /api/financas/cartoes/[id]',
    { method: 'PATCH', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'PATCH' });
      const auth = await requireAuth(span);
      if (auth instanceof NextResponse) return auth;

      const { id } = await ctx.params;
      if (!UuidParam.safeParse(id).success) {
        annotateSpan(span, { statusCode: 400 });
        return apiError('VALIDATION_ERROR', 'ID de cartão inválido.', 400);
      }

      let body;
      try {
        body = CardUpdateSchema.parse(await req.json());
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
        if (body.card_type !== undefined) {
          sets.push(sql`card_type = ${body.card_type}::card_type`);
        }
        if (body.last4 !== undefined) sets.push(sql`last4 = ${body.last4}`);
        if (body.closing_day !== undefined) sets.push(sql`closing_day = ${body.closing_day}`);
        if (body.due_day !== undefined) sets.push(sql`due_day = ${body.due_day}`);
        if (body.credit_limit_cents !== undefined) {
          sets.push(sql`credit_limit_cents = ${body.credit_limit_cents}`);
        }

        if (sets.length === 0) {
          annotateSpan(span, { statusCode: 400 });
          return apiError('VALIDATION_ERROR', 'Nenhum campo fornecido para actualizar.', 400);
        }

        sets.push(sql`updated_at = now()`);
        const setSql = sets.reduce((acc, c, idx) => (idx === 0 ? c : sql`${acc}, ${c}`));

        const rows = await db.execute<CardRow>(sql`
          update public.cards set ${setSql} where id = ${id}::uuid
          returning ${CARD_COLUMNS}
        `);

        const card = rows[0];
        if (!card) {
          annotateSpan(span, { statusCode: 404 });
          return apiError('NOT_FOUND', 'Cartão não encontrado.', 404);
        }

        try {
          await insertAuditLog({
            db,
            householdId: auth.householdId,
            userId: auth.userId,
            action: 'card.updated',
            entityTable: 'cards',
            entityId: card.id,
            afterState: { name: card.name, card_type: card.card_type },
          });
        } catch (auditErr) {
          log.warn({ err: auditErr }, 'audit_log INSERT falhou (best-effort)');
        }

        annotateSpan(span, { statusCode: 200 });
        return NextResponse.json({ card });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // Defesa em profundidade — mudar `card_type` para `credit` sem limite
        // viola o CHECK `cards_credit_needs_limit`: convertido em 400 (não 500).
        if (/cards_credit_needs_limit/i.test(message)) {
          annotateSpan(span, { statusCode: 400 });
          return apiError(
            'VALIDATION_ERROR',
            'Cartão de crédito requer limite de crédito.',
            400,
          );
        }
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'PATCH /api/financas/cartoes/[id] falhou');
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
    'DELETE /api/financas/cartoes/[id]',
    { method: 'DELETE', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'DELETE' });
      const auth = await requireAuth(span);
      if (auth instanceof NextResponse) return auth;

      const { id } = await ctx.params;
      if (!UuidParam.safeParse(id).success) {
        annotateSpan(span, { statusCode: 400 });
        return apiError('VALIDATION_ERROR', 'ID de cartão inválido.', 400);
      }

      // Variant cards_delete_owner_admin — verificar role ANTES do soft-delete
      // (UPDATE). Alinha a semântica de "arquivar" com a policy delete_owner_admin.
      const role = await resolveHouseholdRole(auth.userId, auth.householdId);
      if (role !== 'owner' && role !== 'admin') {
        annotateSpan(span, { statusCode: 403 });
        return apiError(
          'FORBIDDEN',
          'Apenas owner ou admin do household pode arquivar cartões.',
          403,
        );
      }

      try {
        const db = getDb();
        // Soft delete (DP-4.2.2) — preserva histórico financeiro (FK
        // `cards.account_id ON DELETE restrict` + `transactions.card_id`).
        const rows = await db.execute<{ id: string }>(sql`
          update public.cards set archived_at = now(), updated_at = now()
          where id = ${id}::uuid
          returning id
        `);

        if (rows.length === 0) {
          annotateSpan(span, { statusCode: 404 });
          return apiError('NOT_FOUND', 'Cartão não encontrado.', 404);
        }

        try {
          await insertAuditLog({
            db,
            householdId: auth.householdId,
            userId: auth.userId,
            action: 'card.deleted',
            entityTable: 'cards',
            entityId: id,
          });
        } catch (auditErr) {
          log.warn({ err: auditErr }, 'audit_log INSERT falhou (best-effort)');
        }

        annotateSpan(span, { statusCode: 200 });
        return NextResponse.json({ archived: true, id });
      } catch (err) {
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'DELETE /api/financas/cartoes/[id] falhou');
        captureException(err instanceof Error ? err : new Error(String(err)), {
          userId: auth.userId,
          route: ROUTE,
        });
        return apiError('INTERNAL_ERROR', 'Erro ao processar pedido. Tenta novamente.', 500);
      }
    },
  );
}
