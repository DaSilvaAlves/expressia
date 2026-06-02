/**
 * GET / POST /api/financas/categorias — Story 4.3 AC2 + AC3-AC9.
 *
 * GET:  List — globais (`household_id IS NULL`) + per-household (RLS
 *       `categories_select_global_or_member` trata). Filtros: `kind`, `archived`
 *       (boolean default false → `archived_at IS NULL`). Order: `sort_order asc,
 *       name asc`. Hard cap 200.
 * POST: Create — Zod `.strict()`. RLS injecta `household_id`; `is_default`
 *       forçado `false` (`categories_insert_member`). Validação `parent_id`
 *       (1-nível, AC6c). Nome único — `unique_violation` → 409 (PO_FIX F1).
 *
 * RLS (SEC-3 / ADR-003 Fase 2): a operação principal corre dentro de
 * `withHousehold` (2.ª rede, RLS activa via policy `categories_select_global_or_member`).
 * O filtro `(household_id = X OR household_id IS NULL)` (SEC-1, 1.ª rede — globais
 * visíveis a todos, AC-E1) MANTÉM-SE INALTERADO. No POST, a sub-query FK `parent_id`
 * corre no mesmo `tx` que o INSERT (AC5). O `insertAuditLog` permanece best-effort
 * FORA do `withHousehold` (PO-FIX-2). Nunca o cliente service-role — vulnerabilidade R-4.7.
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
import { CATEGORY_KINDS, CategoryCreateSchema } from '@/lib/api-schemas/categories';
import { requireAuth } from '@/lib/api-helpers/auth';
import { insertAuditLog } from '@/lib/api-helpers/audit';

const ROUTE = '/api/financas/categorias';

interface CategoryRow {
  id: string;
  household_id: string | null;
  name: string;
  icon: string | null;
  color: string;
  parent_id: string | null;
  is_default: boolean;
  kind: string;
  sort_order: number;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

const CATEGORY_COLUMNS = sql`
  id, household_id, name, icon, color, parent_id, is_default, kind,
  sort_order, archived_at, created_at, updated_at
`;

/** Filtros de query do GET — todos opcionais. */
const ListFilterSchema = z.object({
  kind: z.enum(CATEGORY_KINDS).optional(),
});

export async function GET(req: NextRequest): Promise<NextResponse> {
  return withSpan(
    'GET /api/financas/categorias',
    { method: 'GET', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'GET' });
      const auth = await requireAuth(span);
      if (auth instanceof NextResponse) return auth;

      const params = req.nextUrl.searchParams;
      // Parse estrito: `archived` aceita APENAS o literal 'true'. Default false.
      const archived = params.get('archived') === 'true';

      let filters;
      try {
        filters = ListFilterSchema.parse({ kind: params.get('kind') ?? undefined });
      } catch (err) {
        annotateSpan(span, { statusCode: 400 });
        if (err instanceof z.ZodError) {
          return apiError('VALIDATION_ERROR', 'Filtros inválidos.', 400, {
            issues: err.issues.map((i) => ({ path: i.path, message: i.message })),
          });
        }
        return apiError('VALIDATION_ERROR', 'Filtros inválidos.', 400);
      }

      try {
        const conditions = [
          archived ? sql`archived_at is not null` : sql`archived_at is null`,
          // Globais (household_id IS NULL) ficam visíveis a todos os households (AC-E1).
          sql`(household_id = ${auth.householdId}::uuid or household_id is null)`,
        ];
        if (filters.kind) conditions.push(sql`kind = ${filters.kind}::category_kind`);
        const whereSql = conditions.reduce((acc, c, idx) =>
          idx === 0 ? c : sql`${acc} and ${c}`,
        );

        // RLS `categories_select_global_or_member` devolve globais + per-household.
        const rows = await withHousehold(
          { userId: auth.userId, householdId: auth.householdId },
          (tx) =>
            tx.execute<CategoryRow>(sql`
              select ${CATEGORY_COLUMNS}
              from public.categories
              where ${whereSql}
              order by sort_order asc, name asc
              limit 200
            `),
        );
        annotateSpan(span, { statusCode: 200 });
        return NextResponse.json({ categories: rows });
      } catch (err) {
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'GET /api/financas/categorias falhou');
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
    'POST /api/financas/categorias',
    { method: 'POST', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'POST' });
      const auth = await requireAuth(span);
      if (auth instanceof NextResponse) return auth;

      let body;
      try {
        body = CategoryCreateSchema.parse(await req.json());
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

        // AC5 — sub-query FK `parent_id` + INSERT correm no MESMO `tx`. Retorno
        // discriminado preserva os early-returns 404/400 sem `return` no callback.
        const result = await withHousehold(
          { userId: auth.userId, householdId: auth.householdId },
          async (
            tx,
          ): Promise<
            { error: 'parent_not_found' | 'parent_multilevel' } | { category: CategoryRow }
          > => {
            // AC6(c) + SEC-1-F1 — `parent_id` tem de resolver a uma categoria visível
            // (própria ou global), não-arquivada, e de 1.º nível (`parent_id IS NULL`).
            // Filtro `household_id` app-enforced explícito (1.ª rede). Mantém
            // `OR household_id IS NULL`: globais são parents válidos, coerente com a
            // listagem GET (AC-E1) e a rota [id] [DEV-DECISION D-SEC1.2].
            if (body.parent_id) {
              const parentRows = await tx.execute<{ id: string; parent_id: string | null }>(sql`
                select id, parent_id from public.categories
                where id = ${body.parent_id}::uuid
                  and (household_id = ${auth.householdId}::uuid or household_id is null)
                  and archived_at is null
                limit 1
              `);
              const parent = parentRows[0];
              if (!parent) return { error: 'parent_not_found' };
              if (parent.parent_id !== null) return { error: 'parent_multilevel' };
            }

            const inserted = await tx.execute<CategoryRow>(sql`
              insert into public.categories
                (household_id, name, icon, color, parent_id, kind, sort_order)
              values (
                ${auth.householdId}::uuid,
                ${body.name},
                ${body.icon ?? null},
                ${body.color},
                ${body.parent_id ?? null},
                ${body.kind}::category_kind,
                ${body.sort_order}
              )
              returning ${CATEGORY_COLUMNS}
            `);
            const row = inserted[0];
            if (!row) throw new Error('INSERT category retornou sem rows.');
            return { category: row };
          },
        );

        if ('error' in result) {
          if (result.error === 'parent_not_found') {
            annotateSpan(span, { statusCode: 404 });
            return apiError('NOT_FOUND', 'Categoria-pai não encontrada.', 404);
          }
          annotateSpan(span, { statusCode: 400 });
          return apiError(
            'VALIDATION_ERROR',
            'Categorias suportam apenas 1 nível de hierarquia.',
            400,
          );
        }

        const category = result.category;

        try {
          await insertAuditLog({
            db,
            householdId: auth.householdId,
            userId: auth.userId,
            action: 'category.created',
            entityTable: 'categories',
            entityId: category.id,
            afterState: { name: category.name, kind: category.kind },
          });
        } catch (auditErr) {
          log.warn({ err: auditErr }, 'audit_log INSERT falhou (best-effort)');
        }

        annotateSpan(span, { statusCode: 201 });
        return NextResponse.json({ category }, { status: 201 });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // PO_FIX F1 — nome duplicado viola `categories_unique_global_name`
        // (unique(household_id, name)): convertido em 409 (não 500).
        if (/categories_unique_global_name/i.test(message)) {
          annotateSpan(span, { statusCode: 409 });
          return apiError('CONFLICT', 'Já existe uma categoria com esse nome.', 409);
        }
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'POST /api/financas/categorias falhou');
        captureException(err instanceof Error ? err : new Error(String(err)), {
          userId: auth.userId,
          route: ROUTE,
        });
        return apiError('INTERNAL_ERROR', 'Erro ao processar pedido. Tenta novamente.', 500);
      }
    },
  );
}
