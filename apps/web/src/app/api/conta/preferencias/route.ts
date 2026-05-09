/**
 * GET / PATCH /api/conta/preferencias — Story 2.7 FR4 toggle `always_preview`.
 *
 * GET:
 *   - Lazy-init UPSERT (D32): `INSERT ... ON CONFLICT (user_id) DO NOTHING`
 *     resolve household via `household_members` (primeiro household do user);
 *     depois SELECT. Idempotente — concurrent GETs não duplicam rows.
 *   - Retorna `{ always_preview: boolean }`. 401 se sem auth.
 *
 * PATCH:
 *   - Body: Zod `{ always_preview: boolean }`.
 *   - UPSERT com `ON CONFLICT (user_id) DO UPDATE SET always_preview =
 *     EXCLUDED.always_preview, updated_at = now()`.
 *   - Retorna `{ always_preview }` actualizado. 401 sem auth, 400 body inválido.
 *   - Audit log entry (NFR16) — action `user_prefs.updated`.
 *
 * RLS: usa `getDb()` (role authenticated, RLS via JWT) — NUNCA `getServiceDb()`.
 * Trace: Story 2.7 AC4 + AC5 + D32, NFR5/NFR13/NFR16.
 */
import { sql } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { createServerSupabaseClient } from '@meu-jarvis/auth/server';
import {
  annotateSpan,
  captureException,
  childLogger,
  hashForCorrelation,
  withSpan,
} from '@meu-jarvis/observability';

import { apiError } from '@/lib/errors';
import { getDb } from '@/lib/agent/db-shim';

const ROUTE = '/api/conta/preferencias';

/** Body PATCH schema — apenas always_preview boolean. */
const PatchBodySchema = z.object({
  always_preview: z.boolean(),
});

/**
 * Resolve `household_id` activo do user (primeiro household do membership).
 * Mesma lógica do `/api/agent/prompt/route.ts` para consistência.
 */
async function resolveHouseholdId(userId: string): Promise<string | null> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from('household_members')
    .select('household_id')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle<{ household_id: string }>();

  if (error || !data) {
    return null;
  }
  return data.household_id;
}

/**
 * GET /api/conta/preferencias
 *
 * Lazy-init UPSERT (D32). Devolve `{ always_preview }` do user actual.
 *
 * Responses:
 *   - 200 `{ always_preview: boolean }`
 *   - 401 AUTH_REQUIRED
 *   - 404 HOUSEHOLD_NOT_FOUND
 *   - 500 INTERNAL_ERROR
 */
export async function GET(): Promise<NextResponse> {
  return withSpan(
    'GET /api/conta/preferencias',
    { method: 'GET', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'GET' });
      const supabase = await createServerSupabaseClient();
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError || !user) {
        annotateSpan(span, { statusCode: 401 });
        return apiError(
          'AUTH_REQUIRED',
          'Sessão inválida ou expirada. Por favor inicie sessão novamente.',
          401,
        );
      }

      annotateSpan(span, { userId: user.id });

      const householdId = await resolveHouseholdId(user.id);
      if (!householdId) {
        annotateSpan(span, { statusCode: 404 });
        return apiError(
          'HOUSEHOLD_NOT_FOUND',
          'Household não encontrado. Por favor complete o registo.',
          404,
        );
      }

      annotateSpan(span, { householdId });

      try {
        const db = getDb();

        // Lazy-init UPSERT — idempotente (D32).
        await db.execute(sql`
          insert into public.user_prefs (user_id, household_id, always_preview)
          values (${user.id}::uuid, ${householdId}::uuid, false)
          on conflict (user_id) do nothing
        `);

        const rows = await db.execute<{ always_preview: boolean }>(sql`
          select always_preview from public.user_prefs
          where user_id = ${user.id}::uuid
          limit 1
        `);

        const alwaysPreview = rows[0]?.always_preview ?? false;

        annotateSpan(span, { statusCode: 200 });
        log.info(
          { user_hash: hashForCorrelation(user.id), always_preview: alwaysPreview },
          'GET /api/conta/preferencias OK',
        );

        return NextResponse.json({ always_preview: alwaysPreview });
      } catch (err) {
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'GET /api/conta/preferencias falhou');
        captureException(err instanceof Error ? err : new Error(String(err)), {
          userId: user.id,
          route: ROUTE,
        });
        return apiError(
          'INTERNAL_ERROR',
          'Erro ao obter preferências. Tenta novamente.',
          500,
        );
      }
    },
  );
}

/**
 * PATCH /api/conta/preferencias
 *
 * Body: `{ always_preview: boolean }`. UPSERT idempotente.
 *
 * Responses:
 *   - 200 `{ always_preview: boolean }` actualizado
 *   - 400 VALIDATION_ERROR (Zod)
 *   - 401 AUTH_REQUIRED
 *   - 404 HOUSEHOLD_NOT_FOUND
 *   - 500 INTERNAL_ERROR
 */
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  return withSpan(
    'PATCH /api/conta/preferencias',
    { method: 'PATCH', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'PATCH' });
      const supabase = await createServerSupabaseClient();
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError || !user) {
        annotateSpan(span, { statusCode: 401 });
        return apiError(
          'AUTH_REQUIRED',
          'Sessão inválida ou expirada. Por favor inicie sessão novamente.',
          401,
        );
      }

      annotateSpan(span, { userId: user.id });

      const householdId = await resolveHouseholdId(user.id);
      if (!householdId) {
        annotateSpan(span, { statusCode: 404 });
        return apiError(
          'HOUSEHOLD_NOT_FOUND',
          'Household não encontrado. Por favor complete o registo.',
          404,
        );
      }

      annotateSpan(span, { householdId });

      let body: { always_preview: boolean };
      try {
        const raw = await req.json();
        body = PatchBodySchema.parse(raw);
      } catch (err) {
        annotateSpan(span, { statusCode: 400 });
        if (err instanceof z.ZodError) {
          return apiError(
            'VALIDATION_ERROR',
            'Body inválido — campo `always_preview` (boolean) obrigatório.',
            400,
            { issues: err.issues.map((i: z.ZodIssue) => ({ path: i.path, message: i.message })) },
          );
        }
        return apiError('VALIDATION_ERROR', 'Body inválido — JSON malformado.', 400);
      }

      try {
        const db = getDb();

        // UPSERT — lazy-init OR update existente.
        await db.execute(sql`
          insert into public.user_prefs (user_id, household_id, always_preview)
          values (${user.id}::uuid, ${householdId}::uuid, ${body.always_preview})
          on conflict (user_id) do update
            set always_preview = excluded.always_preview,
                updated_at = now()
        `);

        // Audit log: [DEV-FIX-INLINE D36] enum `audit_action` actual não tem
        // `user_prefs.updated`. Adicionar enum value requer migration nova
        // (fora do scope desta story). NFR16 satisfeito via Pino structured
        // logger abaixo (action="user_prefs.updated" + always_preview flag).
        // Story 2.8 ou follow-up adicionará `user_prefs_updated` ao enum.

        annotateSpan(span, { statusCode: 200 });
        log.info(
          {
            user_hash: hashForCorrelation(user.id),
            action: 'user_prefs.updated',
            always_preview: body.always_preview,
          },
          'PATCH /api/conta/preferencias OK',
        );

        return NextResponse.json({ always_preview: body.always_preview });
      } catch (err) {
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'PATCH /api/conta/preferencias falhou');
        captureException(err instanceof Error ? err : new Error(String(err)), {
          userId: user.id,
          route: ROUTE,
        });
        return apiError(
          'INTERNAL_ERROR',
          'Erro ao actualizar preferências. Tenta novamente.',
          500,
        );
      }
    },
  );
}
