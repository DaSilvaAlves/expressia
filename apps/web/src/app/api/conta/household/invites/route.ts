/**
 * POST / GET /api/conta/household/invites — Story 6.7 (convite de membros).
 *
 * POST: cria um convite por email. Só `owner`/`admin` (403 limpo na app; a RLS
 *   `household_invites_insert_owner_admin` reforça). Gera `token` aleatório
 *   (32 bytes hex) + `expires_at = now()+7d`. Respeita o unique parcial
 *   `household_invites_unique_pending(household_id, email)` → 409 se já há convite
 *   pendente para o email. **Devolve o link `/aceitar-convite/{token}` na resposta**
 *   (MVP sem Resend — link manual; DEV-DECISION D-6.7.3).
 * GET: lista os convites PENDENTES do household (`accepted_at is null and
 *   expires_at > now()`). O `token` NUNCA é exposto na listagem.
 *
 * RLS (SEC-7 — ADR-003 Fase 4 Fatia C): as operações de domínio correm dentro
 * de `withHousehold` (role authenticated + JWT claims — 2.ª rede). O
 * `insertAuditLog` permanece best-effort FORA do `withHousehold` em `getDb()`
 * (padrão SEC-3/SEC-5 — deve gravar mesmo que a tx de domínio reverta). Handler
 * misto: o import expõe `getDb` E `withHousehold`. Nunca `getServiceDb()`.
 * Trace: Story 6.7 AC2/AC3; 0001:117-133 (RLS select/insert); FR27; ADR-003 §11.3.
 */
import { randomBytes } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import {
  annotateSpan,
  captureException,
  childLogger,
  hashForCorrelation,
  withSpan,
} from '@meu-jarvis/observability';

import { getDb, withHousehold } from '@/lib/agent/db-shim';
import {
  InviteCreateSchema,
  type HouseholdInviteDTO,
  type InvitesListResponse,
  type InviteCreatedResponse,
} from '@/lib/api-schemas/households';
import { insertAuditLog } from '@/lib/api-helpers/audit';
import { requireAuth, resolveHouseholdRole } from '@/lib/api-helpers/auth';
import { apiError } from '@/lib/errors';

const ROUTE = '/api/conta/household/invites';

/** Papéis com autorização para gerir convites. */
const ROLES_CAN_MANAGE = ['owner', 'admin'] as const;

interface InviteRow {
  id: string;
  email: string;
  role: HouseholdInviteDTO['role'];
  expires_at: string | Date;
  created_at: string | Date;
}

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function toDTO(row: InviteRow): HouseholdInviteDTO {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    expiresAt: toIso(row.expires_at),
    createdAt: toIso(row.created_at),
  };
}

/** Detecta violação de unique constraint (Postgres 23505). */
function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const code = (err as { code?: string }).code;
  const message = err instanceof Error ? err.message : String(err);
  return code === '23505' || /unique|household_invites_unique_pending/i.test(message);
}

/**
 * GET /api/conta/household/invites
 *
 * Responses: 200 `InvitesListResponse` · 401 · 404 · 500.
 */
export async function GET(): Promise<NextResponse> {
  return withSpan(
    'GET /api/conta/household/invites',
    { method: 'GET', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'GET' });
      const auth = await requireAuth(span);
      if (auth instanceof NextResponse) return auth;

      try {
        // SEC-7 — listagem de domínio dentro de `withHousehold` (2.ª rede RLS).
        const rows = await withHousehold(
          { userId: auth.userId, householdId: auth.householdId },
          (tx) =>
            tx.execute<InviteRow>(sql`
              select id, email, role, expires_at, created_at
              from public.household_invites
              where household_id = ${auth.householdId}::uuid
                and accepted_at is null
                and expires_at > now()
              order by created_at desc
            `),
        );

        annotateSpan(span, { statusCode: 200 });
        const body: InvitesListResponse = { invites: rows.map(toDTO) };
        return NextResponse.json(body);
      } catch (err) {
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'GET /api/conta/household/invites falhou');
        captureException(err instanceof Error ? err : new Error(String(err)), {
          userId: auth.userId,
          route: ROUTE,
        });
        return apiError('INTERNAL_ERROR', 'Erro ao listar convites. Tenta novamente.', 500);
      }
    },
  );
}

/**
 * POST /api/conta/household/invites
 *
 * Body: `InviteCreateSchema` (`{ email, role? }`). Só `owner`/`admin`.
 * Responses: 201 `InviteCreatedResponse` · 400 · 401 · 403 · 404 · 409 · 500.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  return withSpan(
    'POST /api/conta/household/invites',
    { method: 'POST', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'POST' });
      const auth = await requireAuth(span);
      if (auth instanceof NextResponse) return auth;

      // Autorização de negócio: só owner/admin convidam (a RLS reforça, mas
      // devolvemos 403 limpo sem depender do erro de RLS).
      const role = await resolveHouseholdRole(auth.userId, auth.householdId);
      if (!role || !ROLES_CAN_MANAGE.includes(role as (typeof ROLES_CAN_MANAGE)[number])) {
        annotateSpan(span, { statusCode: 403 });
        return apiError(
          'FORBIDDEN',
          'Apenas o dono ou um admin podem convidar membros.',
          403,
        );
      }

      let body: z.infer<typeof InviteCreateSchema>;
      try {
        body = InviteCreateSchema.parse(await req.json());
      } catch (err) {
        annotateSpan(span, { statusCode: 400 });
        if (err instanceof z.ZodError) {
          return apiError('VALIDATION_ERROR', 'Dados do convite inválidos.', 400, {
            issues: err.issues.map((i: z.ZodIssue) => ({ path: i.path, message: i.message })),
          });
        }
        return apiError('VALIDATION_ERROR', 'Body inválido — JSON malformado.', 400);
      }

      const token = randomBytes(32).toString('hex');

      try {
        // `getDb()` mantém-se para o `insertAuditLog` best-effort (fora da tx).
        const db = getDb();
        // SEC-7 — INSERT de domínio dentro de `withHousehold` (2.ª rede RLS).
        const rows = await withHousehold(
          { userId: auth.userId, householdId: auth.householdId },
          (tx) =>
            tx.execute<InviteRow>(sql`
              insert into public.household_invites (
                household_id, invited_by_user_id, email, role, token, expires_at
              )
              values (
                ${auth.householdId}::uuid,
                ${auth.userId}::uuid,
                ${body.email},
                ${body.role}::household_role,
                ${token},
                now() + interval '7 days'
              )
              returning id, email, role, expires_at, created_at
            `),
        );

        const created = rows[0];
        if (!created) {
          annotateSpan(span, { statusCode: 500 });
          return apiError('INTERNAL_ERROR', 'Erro ao criar o convite.', 500);
        }

        try {
          await insertAuditLog({
            db,
            householdId: auth.householdId,
            userId: auth.userId,
            action: 'household_invite_sent',
            entityTable: 'household_invites',
            entityId: created.id,
            afterState: { email: created.email, role: created.role },
          });
        } catch (auditErr) {
          log.warn({ err: auditErr }, 'audit_log INSERT falhou (best-effort)');
        }

        annotateSpan(span, { statusCode: 201 });
        log.info(
          {
            user_hash: hashForCorrelation(auth.userId),
            household_id: auth.householdId,
            action: 'household_invite_sent',
          },
          'POST /api/conta/household/invites OK',
        );

        const invite = toDTO(created);
        const responseBody: InviteCreatedResponse = {
          invite,
          acceptPath: `/aceitar-convite/${token}`,
        };
        return NextResponse.json(responseBody, { status: 201 });
      } catch (err) {
        if (isUniqueViolation(err)) {
          annotateSpan(span, { statusCode: 409 });
          return apiError(
            'INVITE_ALREADY_PENDING',
            'Já existe um convite pendente para este email nesta família.',
            409,
          );
        }
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'POST /api/conta/household/invites falhou');
        captureException(err instanceof Error ? err : new Error(String(err)), {
          userId: auth.userId,
          route: ROUTE,
        });
        return apiError('INTERNAL_ERROR', 'Erro ao criar o convite. Tenta novamente.', 500);
      }
    },
  );
}
