/**
 * GET / PATCH / DELETE /api/financas/categorias/[id] — Story 4.3 AC2 + AC3-AC9.
 *
 * GET:    Single category. RLS filtra (globais visíveis a todos) — 404 se não
 *         existe ou custom cross-household.
 * PATCH:  Update parcial. Zod `.strict()`. `household_id`/`is_default` IMMUTABLE
 *         (`.strict()` rejeita). Categoria global → RLS `categories_update_member`
 *         (exige `household_id NOT NULL`) não encontra → 404. Nome duplicado → 409.
 * DELETE: Soft delete via `archived_at = now()` (DP-4.3.5 — preserva
 *         `transactions.category_id`). Categoria global → 404.
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
import { CategoryUpdateSchema } from '@/lib/api-schemas/categories';
import { requireAuth } from '@/lib/api-helpers/auth';
import { insertAuditLog } from '@/lib/api-helpers/audit';

const ROUTE = '/api/financas/categorias/[id]';
const UuidParam = z.string().uuid();

interface RouteContext {
  params: Promise<{ id: string }>;
}

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

export async function GET(_req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  return withSpan(
    'GET /api/financas/categorias/[id]',
    { method: 'GET', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'GET' });
      const auth = await requireAuth(span);
      if (auth instanceof NextResponse) return auth;

      const { id } = await ctx.params;
      if (!UuidParam.safeParse(id).success) {
        annotateSpan(span, { statusCode: 400 });
        return apiError('VALIDATION_ERROR', 'ID de categoria inválido.', 400);
      }

      try {
        const db = getDb();
        const rows = await db.execute<CategoryRow>(sql`
          select ${CATEGORY_COLUMNS}
          from public.categories where id = ${id}::uuid limit 1
        `);

        const category = rows[0];
        if (!category) {
          annotateSpan(span, { statusCode: 404 });
          return apiError('NOT_FOUND', 'Categoria não encontrada.', 404);
        }

        annotateSpan(span, { statusCode: 200 });
        return NextResponse.json({ category });
      } catch (err) {
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'GET /api/financas/categorias/[id] falhou');
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
    'PATCH /api/financas/categorias/[id]',
    { method: 'PATCH', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'PATCH' });
      const auth = await requireAuth(span);
      if (auth instanceof NextResponse) return auth;

      const { id } = await ctx.params;
      if (!UuidParam.safeParse(id).success) {
        annotateSpan(span, { statusCode: 400 });
        return apiError('VALIDATION_ERROR', 'ID de categoria inválido.', 400);
      }

      let body;
      try {
        body = CategoryUpdateSchema.parse(await req.json());
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

        // AC6(c) — `parent_id` (quando definido para um valor) tem de resolver a
        // uma categoria visível, não-arquivada, de 1.º nível, e nunca a si mesma.
        if (body.parent_id) {
          if (body.parent_id === id) {
            annotateSpan(span, { statusCode: 400 });
            return apiError(
              'VALIDATION_ERROR',
              'Uma categoria não pode ser pai de si mesma.',
              400,
            );
          }
          const parentRows = await db.execute<{ id: string; parent_id: string | null }>(sql`
            select id, parent_id from public.categories
            where id = ${body.parent_id}::uuid and archived_at is null
            limit 1
          `);
          const parent = parentRows[0];
          if (!parent) {
            annotateSpan(span, { statusCode: 404 });
            return apiError('NOT_FOUND', 'Categoria-pai não encontrada.', 404);
          }
          if (parent.parent_id !== null) {
            annotateSpan(span, { statusCode: 400 });
            return apiError(
              'VALIDATION_ERROR',
              'Categorias suportam apenas 1 nível de hierarquia.',
              400,
            );
          }
        }

        const sets = [];
        if (body.name !== undefined) sets.push(sql`name = ${body.name}`);
        if (body.icon !== undefined) sets.push(sql`icon = ${body.icon}`);
        if (body.color !== undefined) sets.push(sql`color = ${body.color}`);
        if (body.parent_id !== undefined) sets.push(sql`parent_id = ${body.parent_id}`);
        if (body.kind !== undefined) sets.push(sql`kind = ${body.kind}::category_kind`);
        if (body.sort_order !== undefined) sets.push(sql`sort_order = ${body.sort_order}`);

        if (sets.length === 0) {
          annotateSpan(span, { statusCode: 400 });
          return apiError('VALIDATION_ERROR', 'Nenhum campo fornecido para actualizar.', 400);
        }

        sets.push(sql`updated_at = now()`);
        const setSql = sets.reduce((acc, c, idx) => (idx === 0 ? c : sql`${acc}, ${c}`));

        // RLS `categories_update_member` exige `household_id NOT NULL` — uma
        // categoria global não é encontrada e o UPDATE devolve 0 rows → 404.
        const rows = await db.execute<CategoryRow>(sql`
          update public.categories set ${setSql} where id = ${id}::uuid
          returning ${CATEGORY_COLUMNS}
        `);

        const category = rows[0];
        if (!category) {
          annotateSpan(span, { statusCode: 404 });
          return apiError('NOT_FOUND', 'Categoria não encontrada.', 404);
        }

        try {
          await insertAuditLog({
            db,
            householdId: auth.householdId,
            userId: auth.userId,
            action: 'category.updated',
            entityTable: 'categories',
            entityId: category.id,
            afterState: { name: category.name, kind: category.kind },
          });
        } catch (auditErr) {
          log.warn({ err: auditErr }, 'audit_log INSERT falhou (best-effort)');
        }

        annotateSpan(span, { statusCode: 200 });
        return NextResponse.json({ category });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // PO_FIX F1 — renomear para um nome colidente viola
        // `categories_unique_global_name`: convertido em 409 (não 500).
        if (/categories_unique_global_name/i.test(message)) {
          annotateSpan(span, { statusCode: 409 });
          return apiError('CONFLICT', 'Já existe uma categoria com esse nome.', 409);
        }
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'PATCH /api/financas/categorias/[id] falhou');
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
    'DELETE /api/financas/categorias/[id]',
    { method: 'DELETE', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'DELETE' });
      const auth = await requireAuth(span);
      if (auth instanceof NextResponse) return auth;

      const { id } = await ctx.params;
      if (!UuidParam.safeParse(id).success) {
        annotateSpan(span, { statusCode: 400 });
        return apiError('VALIDATION_ERROR', 'ID de categoria inválido.', 400);
      }

      try {
        const db = getDb();
        // Soft delete (DP-4.3.5) — `archived_at = now()` preserva a categorização
        // do histórico (`transactions.category_id ON DELETE set null`). O soft-delete
        // é um UPDATE — a policy `categories_update_member` (household_id NOT NULL)
        // impede arquivar categorias globais → 0 rows → 404.
        const rows = await db.execute<{ id: string }>(sql`
          update public.categories set archived_at = now(), updated_at = now()
          where id = ${id}::uuid
          returning id
        `);

        if (rows.length === 0) {
          annotateSpan(span, { statusCode: 404 });
          return apiError('NOT_FOUND', 'Categoria não encontrada.', 404);
        }

        try {
          await insertAuditLog({
            db,
            householdId: auth.householdId,
            userId: auth.userId,
            action: 'category.deleted',
            entityTable: 'categories',
            entityId: id,
          });
        } catch (auditErr) {
          log.warn({ err: auditErr }, 'audit_log INSERT falhou (best-effort)');
        }

        annotateSpan(span, { statusCode: 200 });
        return NextResponse.json({ archived: true, id });
      } catch (err) {
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'DELETE /api/financas/categorias/[id] falhou');
        captureException(err instanceof Error ? err : new Error(String(err)), {
          userId: auth.userId,
          route: ROUTE,
        });
        return apiError('INTERNAL_ERROR', 'Erro ao processar pedido. Tenta novamente.', 500);
      }
    },
  );
}
