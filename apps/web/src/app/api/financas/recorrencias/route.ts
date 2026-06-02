/**
 * GET / POST /api/financas/recorrencias — Story 4.4 AC1 + AC3-AC9.
 *
 * GET:  List per household (RLS filtra). Filtros: `active` (boolean),
 *       `frequency` (enum), `kind` (enum). Order: `created_at desc, id desc`.
 *       Hard cap 200 (volume baixo — sem paginação). Resposta `{ recurrences }`.
 * POST: Create — Zod `.strict()`. `created_by_user_id` + `household_id` via
 *       JWT. `currency` fixo `'EUR'`. `next_run_on` inicializado pelo handler
 *       `= starts_on` (gerido a partir daí pelo cron de Finanças, Story 4.5).
 *       `active` default `true`. Validação composta: pelo menos um de
 *       `account_id`/`card_id`; se `frequency='custom'` então `custom_rrule`.
 *
 * RLS (SEC-3 / ADR-003 Fase 2): a operação principal corre dentro de
 * `withHousehold` (2.ª rede, RLS activa). O filtro `household_id` (SEC-1, 1.ª rede)
 * MANTÉM-SE. No POST, as sub-queries FK `accounts`/`cards`/`categories` correm no
 * mesmo `tx` que o INSERT (AC5). O `insertAuditLog` permanece best-effort FORA do
 * `withHousehold` (PO-FIX-2). Nunca o cliente service-role — vulnerabilidade R-4.7.
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
import {
  FINANCE_RECURRENCE_FREQUENCIES,
  FINANCE_RECURRENCE_KINDS,
  FinanceRecurrenceCreateSchema,
} from '@/lib/api-schemas/finance-recurrences';
import { requireAuth } from '@/lib/api-helpers/auth';
import { insertAuditLog } from '@/lib/api-helpers/audit';

const ROUTE = '/api/financas/recorrencias';
const HARD_CAP = 200;

interface RecurrenceRow {
  id: string;
  household_id: string;
  created_by_user_id: string;
  description: string;
  kind: string;
  amount_cents: number;
  currency: string;
  account_id: string | null;
  card_id: string | null;
  category_id: string | null;
  payment_method: string;
  frequency: string;
  interval: number;
  custom_rrule: string | null;
  starts_on: string;
  ends_on: string | null;
  next_run_on: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

const RECURRENCE_COLUMNS = sql`
  id, household_id, created_by_user_id, description, kind, amount_cents, currency,
  account_id, card_id, category_id, payment_method, frequency, interval,
  custom_rrule, starts_on, ends_on, next_run_on, active, created_at, updated_at
`;

/** Filtros de query do GET — todos opcionais. */
const ListFilterSchema = z.object({
  frequency: z.enum(FINANCE_RECURRENCE_FREQUENCIES).optional(),
  kind: z.enum(FINANCE_RECURRENCE_KINDS).optional(),
});

export async function GET(req: NextRequest): Promise<NextResponse> {
  return withSpan(
    'GET /api/financas/recorrencias',
    { method: 'GET', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'GET' });
      const auth = await requireAuth(span);
      if (auth instanceof NextResponse) return auth;

      const params = req.nextUrl.searchParams;

      let filters;
      try {
        filters = ListFilterSchema.parse({
          frequency: params.get('frequency') ?? undefined,
          kind: params.get('kind') ?? undefined,
        });
      } catch (err) {
        annotateSpan(span, { statusCode: 400 });
        if (err instanceof z.ZodError) {
          return apiError('VALIDATION_ERROR', 'Filtros inválidos.', 400, {
            issues: err.issues.map((i) => ({ path: i.path, message: i.message })),
          });
        }
        return apiError('VALIDATION_ERROR', 'Filtros inválidos.', 400);
      }

      // Parse estrito: `active` aceita APENAS os literais 'true'/'false'.
      const rawActive = params.get('active');
      let activeFilter: boolean | null = null;
      if (rawActive === 'true') activeFilter = true;
      else if (rawActive === 'false') activeFilter = false;
      else if (rawActive !== null) {
        annotateSpan(span, { statusCode: 400 });
        return apiError('VALIDATION_ERROR', 'Filtro `active` inválido — true ou false.', 400);
      }

      try {
        const conditions = [sql`household_id = ${auth.householdId}::uuid`];
        if (activeFilter !== null) conditions.push(sql`active = ${activeFilter}`);
        if (filters.frequency) {
          conditions.push(sql`frequency = ${filters.frequency}::recurrence_freq_finance`);
        }
        if (filters.kind) conditions.push(sql`kind = ${filters.kind}::transaction_kind`);

        const whereSql =
          conditions.length > 0
            ? conditions.reduce((acc, c, idx) => (idx === 0 ? c : sql`${acc} and ${c}`))
            : sql`true`;

        const rows = await withHousehold(
          { userId: auth.userId, householdId: auth.householdId },
          (tx) =>
            tx.execute<RecurrenceRow>(sql`
              select ${RECURRENCE_COLUMNS}
              from public.recurrences
              where ${whereSql}
              order by created_at desc, id desc
              limit ${HARD_CAP}
            `),
        );

        annotateSpan(span, { statusCode: 200 });
        return NextResponse.json({ recurrences: rows });
      } catch (err) {
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'GET /api/financas/recorrencias falhou');
        captureException(err instanceof Error ? err : new Error(String(err)), {
          userId: auth.userId,
          route: ROUTE,
        });
        return apiError('INTERNAL_ERROR', 'Erro ao processar pedido. Tenta novamente.', 500);
      }
    },
  );
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return withSpan(
    'POST /api/financas/recorrencias',
    { method: 'POST', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'POST' });
      const auth = await requireAuth(span);
      if (auth instanceof NextResponse) return auth;

      let body;
      try {
        body = FinanceRecurrenceCreateSchema.parse(await req.json());
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
        // PO-FIX-2: `getDb()` mantém-se para o `insertAuditLog` best-effort (abaixo).
        const db = getDb();

        // AC5 — sub-queries FK + INSERT correm no MESMO `tx`. Retorno discriminado
        // preserva o early-return 404 por FK sem `return` dentro do callback.
        const result = await withHousehold(
          { userId: auth.userId, householdId: auth.householdId },
          async (
            tx,
          ): Promise<
            { notFound: 'account' | 'card' | 'category' } | { recurrence: RecurrenceRow }
          > => {
            // AC6(b) + SEC-1-F1 — `account_id`/`card_id`/`category_id` (quando
            // presentes) têm de pertencer ao household (filtro `household_id`
            // app-enforced explícito, 1.ª rede). Categorias globais válidas (AC-E1).
            if (body.account_id) {
              const rows = await tx.execute<{ id: string }>(sql`
                select id from public.accounts
                where id = ${body.account_id}::uuid and household_id = ${auth.householdId}::uuid
                limit 1
              `);
              if (rows.length === 0) return { notFound: 'account' };
            }
            if (body.card_id) {
              const rows = await tx.execute<{ id: string }>(sql`
                select id from public.cards
                where id = ${body.card_id}::uuid and household_id = ${auth.householdId}::uuid
                limit 1
              `);
              if (rows.length === 0) return { notFound: 'card' };
            }
            if (body.category_id) {
              const rows = await tx.execute<{ id: string }>(sql`
                select id from public.categories
                where id = ${body.category_id}::uuid
                  and (household_id = ${auth.householdId}::uuid or household_id is null)
                limit 1
              `);
              if (rows.length === 0) return { notFound: 'category' };
            }

            // `next_run_on` é inicializado `= starts_on` no POST — gerido a partir
            // daí pelo cron de Finanças (Story 4.5). NÃO vem do payload.
            const inserted = await tx.execute<RecurrenceRow>(sql`
              insert into public.recurrences
                (household_id, created_by_user_id, description, kind, amount_cents,
                 account_id, card_id, category_id, payment_method, frequency, interval,
                 custom_rrule, starts_on, ends_on, next_run_on)
              values (
                ${auth.householdId}::uuid,
                ${auth.userId}::uuid,
                ${body.description},
                ${body.kind}::transaction_kind,
                ${body.amount_cents},
                ${body.account_id ?? null},
                ${body.card_id ?? null},
                ${body.category_id ?? null},
                ${body.payment_method}::payment_method_finance,
                ${body.frequency}::recurrence_freq_finance,
                ${body.interval},
                ${body.custom_rrule ?? null},
                ${body.starts_on}::date,
                ${body.ends_on ?? null},
                ${body.starts_on}::date
              )
              returning ${RECURRENCE_COLUMNS}
            `);
            const row = inserted[0];
            if (!row) throw new Error('INSERT recurrence retornou sem rows.');
            return { recurrence: row };
          },
        );

        if ('notFound' in result) {
          annotateSpan(span, { statusCode: 404 });
          const messages = {
            account: 'Conta não encontrada.',
            card: 'Cartão não encontrado.',
            category: 'Categoria não encontrada.',
          } as const;
          return apiError('NOT_FOUND', messages[result.notFound], 404);
        }

        const recurrence = result.recurrence;

        try {
          await insertAuditLog({
            db,
            householdId: auth.householdId,
            userId: auth.userId,
            action: 'finance_recurrence.created',
            entityTable: 'recurrences',
            entityId: recurrence.id,
            afterState: {
              kind: recurrence.kind,
              amount_cents: recurrence.amount_cents,
              frequency: recurrence.frequency,
            },
          });
        } catch (auditErr) {
          log.warn({ err: auditErr }, 'audit_log INSERT falhou (best-effort)');
        }

        annotateSpan(span, { statusCode: 201 });
        return NextResponse.json({ recurrence }, { status: 201 });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // Defesa em profundidade — `account_or_card` violado (ambos NULL).
        if (/recurrences_account_or_card/i.test(message)) {
          annotateSpan(span, { statusCode: 400 });
          return apiError('VALIDATION_ERROR', 'Recorrência requer conta ou cartão.', 400);
        }
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'POST /api/financas/recorrencias falhou');
        captureException(err instanceof Error ? err : new Error(String(err)), {
          userId: auth.userId,
          route: ROUTE,
        });
        return apiError('INTERNAL_ERROR', 'Erro ao processar pedido. Tenta novamente.', 500);
      }
    },
  );
}
