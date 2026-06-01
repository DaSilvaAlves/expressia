/**
 * POST /api/conta/household/aceitar-convite — Story 6.7 (aceitar convite).
 *
 * Chamado pela página `/aceitar-convite/{token}` (utilizador autenticado). Invoca
 * a função SQL `accept_invite(token)` (SECURITY DEFINER) via `getDb()` — valida
 * estado/expiração/email/limite-de-plano e cria o membership atomicamente.
 *
 * Os erros tipados da função (`raise exception '<CODE>'`) são mapeados para
 * mensagens PT-PT + status HTTP por `mapAcceptInviteError` (exportada p/ testes).
 *
 * Colocado em `/aceitar-convite/` (não em `/invites/`) para não colidir com a
 * rota dinâmica `/invites/[id]` (DEV-DECISION D-6.7.5: aceitação via endpoint +
 * página client, consistente e testável, em vez de Server Action).
 *
 * RLS: `getDb()` (role authenticated). Trace: Story 6.7 AC6; FR27.
 */
import { sql } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { createServerSupabaseClient } from '@meu-jarvis/auth/server';
import {
  annotateSpan,
  captureException,
  childLogger,
  withSpan,
} from '@meu-jarvis/observability';

import { getDb } from '@/lib/agent/db-shim';
import { apiError } from '@/lib/errors';

const ROUTE = '/api/conta/household/aceitar-convite';

const AcceptSchema = z.object({ token: z.string().trim().min(1).max(128) }).strict();

interface MappedError {
  readonly code: string;
  readonly message: string;
  readonly status: number;
}

/**
 * Mapeia o erro tipado de `accept_invite()` (`raise exception '<CODE>'`) para um
 * código/mensagem PT-PT + status HTTP. Exportada para testes unitários.
 */
export function mapAcceptInviteError(err: unknown): MappedError {
  const message = err instanceof Error ? err.message : String(err);

  if (/INVITE_NOT_FOUND/.test(message)) {
    return { code: 'INVITE_NOT_FOUND', message: 'Convite inválido ou inexistente.', status: 404 };
  }
  if (/INVITE_EXPIRED/.test(message)) {
    return { code: 'INVITE_EXPIRED', message: 'Este convite expirou. Pede um novo à tua família.', status: 410 };
  }
  if (/INVITE_ALREADY_ACCEPTED/.test(message)) {
    return { code: 'INVITE_ALREADY_ACCEPTED', message: 'Este convite já foi aceite.', status: 409 };
  }
  if (/INVITE_EMAIL_MISMATCH/.test(message)) {
    return { code: 'INVITE_EMAIL_MISMATCH', message: 'Este convite foi enviado para outro email. Entra com a conta certa.', status: 403 };
  }
  if (/ALREADY_MEMBER/.test(message)) {
    return { code: 'ALREADY_MEMBER', message: 'Já fazes parte desta família.', status: 409 };
  }
  if (/MEMBER_LIMIT_REACHED/.test(message)) {
    return { code: 'MEMBER_LIMIT_REACHED', message: 'Esta família já atingiu o limite de membros do plano.', status: 409 };
  }
  if (/AUTH_REQUIRED/.test(message)) {
    return { code: 'AUTH_REQUIRED', message: 'Sessão inválida. Inicia sessão novamente.', status: 401 };
  }
  return { code: 'INTERNAL_ERROR', message: 'Não foi possível aceitar o convite. Tenta novamente.', status: 500 };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return withSpan(
    'POST /api/conta/household/aceitar-convite',
    { method: 'POST', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'POST' });

      // Auth inline (não exige household próprio — o convidado vai entrar noutro).
      const supabase = await createServerSupabaseClient();
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError || !user) {
        annotateSpan(span, { statusCode: 401 });
        return apiError('AUTH_REQUIRED', 'Sessão inválida ou expirada. Inicia sessão novamente.', 401);
      }
      annotateSpan(span, { userId: user.id });

      let body: z.infer<typeof AcceptSchema>;
      try {
        body = AcceptSchema.parse(await req.json());
      } catch {
        annotateSpan(span, { statusCode: 400 });
        return apiError('VALIDATION_ERROR', 'Token de convite em falta ou inválido.', 400);
      }

      try {
        const db = getDb();
        const rows = await db.execute<{ household_id: string }>(sql`
          select public.accept_invite(${body.token}) as household_id
        `);

        const householdId = rows[0]?.household_id;
        if (!householdId) {
          annotateSpan(span, { statusCode: 500 });
          return apiError('INTERNAL_ERROR', 'Não foi possível aceitar o convite. Tenta novamente.', 500);
        }

        annotateSpan(span, { statusCode: 200 });
        return NextResponse.json({ accepted: true, householdId });
      } catch (err) {
        const mapped = mapAcceptInviteError(err);
        annotateSpan(span, { statusCode: mapped.status });
        if (mapped.status >= 500) {
          log.error({ err }, 'POST /aceitar-convite falhou (erro inesperado)');
          captureException(err instanceof Error ? err : new Error(String(err)), {
            userId: user.id,
            route: ROUTE,
          });
        } else {
          log.info({ code: mapped.code }, 'accept_invite rejeitou (esperado)');
        }
        return apiError(mapped.code, mapped.message, mapped.status);
      }
    },
  );
}
