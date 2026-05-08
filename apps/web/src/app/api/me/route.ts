/**
 * GET /api/me — Endpoint canary para validar autenticação + RLS multi-tenant.
 *
 * Devolve `{ user, household, role }` do utilizador autenticado. Cumpre a
 * função de smoke test fim-a-fim de Epic 1: auth → JWT com `household_id` →
 * RLS activa → acesso correcto e bloqueio cross-household verificado em E2E.
 *
 * RLS strategy (Story 1.6 — decisão Eurico Opção A para C6):
 *   Usa o cliente Supabase JS (`createServerSupabaseClient`) que faz queries
 *   via PostgREST. PostgREST popula `request.jwt.claims.household_id`
 *   automaticamente em cada query, fazendo com que `current_household_id()`
 *   SQL function (migration 0000) funcione e as policies RLS filtrem
 *   correctamente por household.
 *
 *   Nunca usa `SUPABASE_SERVICE_ROLE_KEY` — todas as queries respeitam RLS
 *   via JWT do utilizador autenticado. Tipos e schemas Drizzle continuam
 *   source-of-truth em `@meu-jarvis/db`.
 *
 *   Story 1.4 (RLS Test Suite) eventualmente extenderá `getDb()` (Drizzle
 *   direct connection) com JWT injection para endpoints futuros — fora do
 *   scope desta story.
 *
 * Observability (Story 1.7 AC5):
 *   - Span OTel por request com atributos `http.method`, `http.route`,
 *     `http.status_code`, `user.id` (hashed), `household.id`.
 *   - Logger Pino com PII redaction para correlação trace ↔ logs.
 *   - Erros 5xx delegados a Sentry via `captureException` wrapper (com
 *     contexto `householdId` + `userId` hashed).
 *
 * Trace: Story 1.6 AC1-AC9, Story 1.7 AC5, Architecture §5.1, §7.1, §7.3,
 *        §9.1, ADR-002, ADR-004.
 */
import { NextResponse } from 'next/server';

import { createServerSupabaseClient } from '@meu-jarvis/auth/server';
import {
  annotateSpan,
  captureException,
  childLogger,
  hashForCorrelation,
  recordSpanError,
  withSpan,
} from '@meu-jarvis/observability';

import { apiError } from '@/lib/errors';

/**
 * Tipos de plano (espelho de `plan_tier` enum em `packages/db/src/schema/tenancy.ts`).
 * Mantemos cópia local para evitar runtime dependency em `@meu-jarvis/db` no
 * client bundle do Next.js.
 */
type PlanTier = 'free' | 'pessoal' | 'familia' | 'pro';

/**
 * Papel do utilizador num household (espelho de `household_role` enum).
 */
type HouseholdRole = 'owner' | 'admin' | 'member';

/**
 * Shape esperada da row retornada pelo PostgREST quando seleccionamos
 * `household_members` com a relação aninhada `households`.
 *
 * Para FK simples (`household_members.household_id → households.id`), o
 * Supabase retorna `households` como objecto único (não array).
 */
interface MembershipRow {
  readonly role: HouseholdRole;
  readonly households: {
    readonly id: string;
    readonly name: string;
    readonly plan: PlanTier;
  } | null;
}

interface MeResponse {
  readonly user: {
    readonly id: string;
    readonly email: string | null;
  };
  readonly household: {
    readonly id: string;
    readonly name: string;
    readonly plan: PlanTier;
  };
  readonly role: HouseholdRole;
}

const ROUTE = '/api/me';

export async function GET(): Promise<NextResponse> {
  return withSpan(
    'GET /api/me',
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
        log.info({ status: 401, code: 'AUTH_REQUIRED' }, 'Pedido sem sessão válida');
        return apiError(
          'AUTH_REQUIRED',
          'Sessão inválida ou expirada. Por favor inicie sessão novamente.',
          401,
        );
      }

      // Anotar span com user.id hashed assim que temos identidade autenticada.
      annotateSpan(span, { userId: user.id });

      // Query via PostgREST — RLS-via-JWT activa automaticamente.
      // `households.plan` é denormalizado (ver schema/tenancy.ts) — evita JOIN
      // adicional com `subscriptions` para AC1.
      const { data, error } = await supabase
        .from('household_members')
        .select('role, households (id, name, plan)')
        .eq('user_id', user.id)
        .limit(1)
        .maybeSingle<MembershipRow>();

      if (error) {
        annotateSpan(span, { statusCode: 500 });
        recordSpanError(span, error, 500);
        log.error(
          { status: 500, code: 'HOUSEHOLD_QUERY_FAILED', err: error },
          'Falha a obter household do utilizador',
        );
        captureException(error, {
          userId: user.id,
          route: ROUTE,
          tags: { error_code: 'HOUSEHOLD_QUERY_FAILED' },
        });
        return apiError(
          'HOUSEHOLD_QUERY_FAILED',
          'Não foi possível obter os dados do household. Tenta novamente.',
          500,
        );
      }

      if (!data || !data.households) {
        annotateSpan(span, { statusCode: 404 });
        log.warn(
          {
            status: 404,
            code: 'HOUSEHOLD_NOT_FOUND',
            user_hash: hashForCorrelation(user.id),
          },
          'Household não encontrado para utilizador autenticado',
        );
        return apiError(
          'HOUSEHOLD_NOT_FOUND',
          'Household não encontrado. Por favor complete o registo.',
          404,
        );
      }

      // Sucesso: anotar span com household_id e statusCode 200
      annotateSpan(span, { householdId: data.households.id, statusCode: 200 });

      const body: MeResponse = {
        user: {
          id: user.id,
          email: user.email ?? null,
        },
        household: {
          id: data.households.id,
          name: data.households.name,
          plan: data.households.plan,
        },
        role: data.role,
      };

      log.info({ status: 200, household_id: data.households.id }, 'Pedido /api/me OK');
      return NextResponse.json<MeResponse>(body);
    },
  );
}
