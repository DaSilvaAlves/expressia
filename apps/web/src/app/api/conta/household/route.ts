/**
 * GET / PATCH /api/conta/household — gestão do household + membros.
 *
 * **Story 6.x (gestão de household).** Expõe o contrato definido em
 * `@/lib/api-schemas/households` para a página `/conta/household`.
 *
 * GET:
 *   - Resolve o household activo do user (primeiro membership).
 *   - Devolve `{ household: { id, name, plan }, members: [...], myRole }`
 *     (`HouseholdResponse`). Membros ordenados por papel (owner → admin →
 *     member) e depois antiguidade. `myRole` derivado da própria row.
 *   - 401 sem auth · 404 sem household.
 *
 * PATCH:
 *   - Body `HouseholdPatchSchema` (`{ name }`, `.strict()`). 400 se inválido.
 *   - **Autorização de negócio:** só `owner`/`admin` podem renomear. A RLS
 *     `households_update` permite a qualquer membro (`is_household_member`),
 *     por isso a restrição de papel é aplicada na aplicação (403 para
 *     `member`). Trace: db-schema §2 (RLS não distingue role no UPDATE).
 *   - Retorna `{ household: { id, name, plan } }` actualizado.
 *   - Audit (NFR16) via logger estruturado (action `household.updated`).
 *
 * RLS: usa `getDb()` (role authenticated, RLS via JWT) — NUNCA `getServiceDb()`.
 * Trace: Story 6.x AC1-AC4; db-schema §2; NFR5/NFR13/NFR16.
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

import { getDb } from '@/lib/agent/db-shim';
import { HouseholdPatchSchema } from '@/lib/api-schemas/households';
import type {
  HouseholdMemberDTO,
  HouseholdResponse,
  HouseholdRole,
  PlanTier,
} from '@/lib/api-schemas/households';
import { apiError } from '@/lib/errors';

const ROUTE = '/api/conta/household';

/** Papéis com autorização para renomear o household. */
const ROLES_CAN_EDIT: readonly HouseholdRole[] = ['owner', 'admin'];

/** Ordem de apresentação dos membros: owner primeiro, member por último. */
const ROLE_SORT: Record<HouseholdRole, number> = {
  owner: 0,
  admin: 1,
  member: 2,
};

/**
 * Resolve `household_id` activo do user (primeiro household do membership).
 * Mesma lógica de `/api/conta/preferencias` e `/api/agent/prompt`.
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
 * GET /api/conta/household
 *
 * Responses:
 *   - 200 `HouseholdResponse`
 *   - 401 AUTH_REQUIRED
 *   - 404 HOUSEHOLD_NOT_FOUND
 *   - 500 INTERNAL_ERROR
 */
export async function GET(): Promise<NextResponse> {
  return withSpan(
    'GET /api/conta/household',
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

        // Household (RLS households_select via is_household_member).
        const householdRows = await db.execute<{
          id: string;
          name: string;
          plan: string;
        }>(sql`
          select id, name, plan from public.households
          where id = ${householdId}::uuid
          limit 1
        `);

        const household = householdRows[0];
        if (!household) {
          annotateSpan(span, { statusCode: 404 });
          return apiError(
            'HOUSEHOLD_NOT_FOUND',
            'Household não encontrado.',
            404,
          );
        }

        // Membros — lê APENAS `household_members` (RLS
        // household_members_select permite ver os memberships do household).
        // `auth.users` está no schema `auth` e não é acessível via role
        // `authenticated` por SQL directo (getDb), por isso o nome vem de
        // `display_name`; o email só é exposto para o próprio utilizador
        // (obtido da sessão). Trace: db-schema §2 (auth.users isolado);
        // tenancy.ts (household_members.display_name/joined_at).
        const memberRows = await db.execute<{
          user_id: string;
          role: string;
          display_name: string | null;
          joined_at: string | Date;
        }>(sql`
          select user_id, role, display_name, joined_at
          from public.household_members
          where household_id = ${householdId}::uuid
        `);

        const members: HouseholdMemberDTO[] = memberRows
          .map((row) => ({
            id: row.user_id,
            email: row.user_id === user.id ? (user.email ?? null) : null,
            fullName: row.display_name,
            role: row.role as HouseholdRole,
            createdAt:
              row.joined_at instanceof Date
                ? row.joined_at.toISOString()
                : String(row.joined_at),
          }))
          .sort((a, b) => {
            const byRole = ROLE_SORT[a.role] - ROLE_SORT[b.role];
            return byRole !== 0 ? byRole : a.createdAt.localeCompare(b.createdAt);
          });

        const myRole: HouseholdRole =
          members.find((m) => m.id === user.id)?.role ?? 'member';

        annotateSpan(span, { statusCode: 200 });
        log.info(
          {
            user_hash: hashForCorrelation(user.id),
            household_id: householdId,
            members: members.length,
          },
          'GET /api/conta/household OK',
        );

        const body: HouseholdResponse = {
          household: {
            id: household.id,
            name: household.name,
            plan: household.plan as PlanTier,
          },
          members,
          myRole,
        };
        return NextResponse.json(body);
      } catch (err) {
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'GET /api/conta/household falhou');
        captureException(err instanceof Error ? err : new Error(String(err)), {
          userId: user.id,
          route: ROUTE,
        });
        return apiError(
          'INTERNAL_ERROR',
          'Erro ao obter o household. Tenta novamente.',
          500,
        );
      }
    },
  );
}

/**
 * PATCH /api/conta/household
 *
 * Body: `HouseholdPatchSchema` (`{ name }`). Só `owner`/`admin`.
 *
 * Responses:
 *   - 200 `{ household: { id, name, plan } }`
 *   - 400 VALIDATION_ERROR (Zod)
 *   - 401 AUTH_REQUIRED
 *   - 403 FORBIDDEN (papel `member`)
 *   - 404 HOUSEHOLD_NOT_FOUND
 *   - 500 INTERNAL_ERROR
 */
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  return withSpan(
    'PATCH /api/conta/household',
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

      let body: { name: string };
      try {
        const raw = await req.json();
        body = HouseholdPatchSchema.parse(raw);
      } catch (err) {
        annotateSpan(span, { statusCode: 400 });
        if (err instanceof z.ZodError) {
          return apiError(
            'VALIDATION_ERROR',
            'Body inválido — `name` (string, 1–80 caracteres) é obrigatório.',
            400,
            {
              issues: err.issues.map((i: z.ZodIssue) => ({
                path: i.path,
                message: i.message,
              })),
            },
          );
        }
        return apiError('VALIDATION_ERROR', 'Body inválido — JSON malformado.', 400);
      }

      try {
        const db = getDb();

        // Autorização de negócio: confirmar papel do user no household.
        // A RLS permite o UPDATE a qualquer membro; restringimos a owner/admin
        // ao nível da aplicação (db-schema §2).
        const roleRows = await db.execute<{ role: string }>(sql`
          select role from public.household_members
          where household_id = ${householdId}::uuid
            and user_id = ${user.id}::uuid
          limit 1
        `);

        const myRole = roleRows[0]?.role as HouseholdRole | undefined;
        if (!myRole || !ROLES_CAN_EDIT.includes(myRole)) {
          annotateSpan(span, { statusCode: 403 });
          log.warn(
            { user_hash: hashForCorrelation(user.id), role: myRole ?? 'none' },
            'PATCH /api/conta/household negado — papel insuficiente',
          );
          return apiError(
            'FORBIDDEN',
            'Apenas o owner ou um admin podem alterar o nome da família.',
            403,
          );
        }

        const updatedRows = await db.execute<{
          id: string;
          name: string;
          plan: string;
        }>(sql`
          update public.households
          set name = ${body.name}, updated_at = now()
          where id = ${householdId}::uuid
          returning id, name, plan
        `);

        const updated = updatedRows[0];
        if (!updated) {
          annotateSpan(span, { statusCode: 404 });
          return apiError('HOUSEHOLD_NOT_FOUND', 'Household não encontrado.', 404);
        }

        annotateSpan(span, { statusCode: 200 });
        log.info(
          {
            user_hash: hashForCorrelation(user.id),
            household_id: householdId,
            action: 'household.updated',
          },
          'PATCH /api/conta/household OK',
        );

        return NextResponse.json({
          household: {
            id: updated.id,
            name: updated.name,
            plan: updated.plan as PlanTier,
          },
        });
      } catch (err) {
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'PATCH /api/conta/household falhou');
        captureException(err instanceof Error ? err : new Error(String(err)), {
          userId: user.id,
          route: ROUTE,
        });
        return apiError(
          'INTERNAL_ERROR',
          'Erro ao actualizar o household. Tenta novamente.',
          500,
        );
      }
    },
  );
}
