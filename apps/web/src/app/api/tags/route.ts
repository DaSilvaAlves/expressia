/**
 * GET / POST /api/tags — Story 3.2 AC3 + AC7-AC10 / Story 3.6 AC6 (extensão `?with_counts=true`).
 *
 * GET: List per household (RLS). Limit hard cap 200. Order: name asc.
 *      Query param opt-in `?with_counts=true` (Story 3.6 [STORY-INVENT-DP-3.6.7]) adiciona
 *      `task_count` ao response — usado pelo `TagsManager` UI. Backward compat 100% sem o param.
 * POST: Create — Zod strict. Unique constraint (household_id, name) → 409.
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
import { TagCreateSchema } from '@/lib/api-schemas/tags';
import { requireAuth } from '@/lib/api-helpers/auth';
import { insertAuditLog } from '@/lib/api-helpers/audit';

const ROUTE = '/api/tags';

interface TagRow {
  id: string;
  household_id: string;
  name: string;
  color: string;
  created_at: string;
  updated_at: string;
}

interface TagWithCountRow extends TagRow {
  task_count: number;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  return withSpan(
    'GET /api/tags',
    { method: 'GET', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'GET' });
      const auth = await requireAuth(span);
      if (auth instanceof NextResponse) return auth;

      // G2.1 (Aria) — boolean parse estrito: aceita APENAS o literal 'true'.
      // Rejeita `'1'`, `'yes'`, `'on'` e qualquer outro valor. Comportamento previsível.
      const withCounts = req.nextUrl.searchParams.get('with_counts') === 'true';

      try {
        const db = getDb();
        if (withCounts) {
          // G2.2 (Aria) — `current_household_id()` explicit no subquery COUNT.
          // RLS é a primeira linha de defesa; este filtro é a segunda (defesa em
          // profundidade). Performance overhead zero (mesmo index scan via
          // `task_tags_tag_idx` + `task_tags_household_idx`).
          // SEC-1: RLS inerte em runtime — filtro household_id explícito é a
          // garantia de isolamento (substitui current_household_id() = NULL).
          const tags = await db.execute<TagWithCountRow>(sql`
            select id, household_id, name, color, created_at, updated_at,
              (
                select count(*)::int
                from public.task_tags
                where task_tags.tag_id = tags.id
                  and task_tags.household_id = ${auth.householdId}::uuid
              ) as task_count
            from public.tags
            where tags.household_id = ${auth.householdId}::uuid
            order by name asc
            limit 200
          `);
          annotateSpan(span, { statusCode: 200 });
          return NextResponse.json({ tags });
        }

        const tags = await db.execute<TagRow>(sql`
          select id, household_id, name, color, created_at, updated_at
          from public.tags
          where household_id = ${auth.householdId}::uuid
          order by name asc limit 200
        `);
        annotateSpan(span, { statusCode: 200 });
        return NextResponse.json({ tags });
      } catch (err) {
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'GET /api/tags falhou');
        captureException(err instanceof Error ? err : new Error(String(err)), {
          userId: auth.userId,
          route: ROUTE,
        });
        return apiError('INTERNAL_ERROR', 'Erro ao listar tags. Tenta novamente.', 500);
      }
    },
  );
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return withSpan(
    'POST /api/tags',
    { method: 'POST', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'POST' });
      const auth = await requireAuth(span);
      if (auth instanceof NextResponse) return auth;

      let body;
      try {
        body = TagCreateSchema.parse(await req.json());
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
        const rows = await db.execute<TagRow>(sql`
          insert into public.tags (household_id, name, color)
          values (${auth.householdId}::uuid, ${body.name}, ${body.color ?? '#6B7280'})
          returning id, household_id, name, color, created_at, updated_at
        `);

        const tag = rows[0];
        if (!tag) throw new Error('INSERT tag retornou sem rows.');

        try {
          await insertAuditLog({
            db,
            householdId: auth.householdId,
            userId: auth.userId,
            action: 'tag.created',
            entityTable: 'tags',
            entityId: tag.id,
            afterState: { name: tag.name, color: tag.color },
          });
        } catch (auditErr) {
          log.warn({ err: auditErr }, 'audit_log INSERT falhou (best-effort)');
        }

        annotateSpan(span, { statusCode: 201 });
        return NextResponse.json({ tag }, { status: 201 });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // Postgres unique constraint → 23505
        if (/unique|duplicate|23505|tags_unique_name_per_household/i.test(message)) {
          annotateSpan(span, { statusCode: 409 });
          return apiError('CONFLICT', 'Tag com este nome já existe neste household.', 409);
        }
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'POST /api/tags falhou');
        captureException(err instanceof Error ? err : new Error(String(err)), {
          userId: auth.userId,
          route: ROUTE,
        });
        return apiError('INTERNAL_ERROR', 'Erro ao criar tag. Tenta novamente.', 500);
      }
    },
  );
}
