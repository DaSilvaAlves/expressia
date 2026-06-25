/**
 * GET /api/google/callback — callback OAuth do Google Calendar (Story J-3 AC8).
 *
 * Recebe o código de autorização do Google (`?code=...&state=...`), troca-o por
 * tokens (`exchangeCodeForTokens`), cifra o `refresh_token` com `encryptToken`
 * (AES-256-GCM) e grava/actualiza em `google_oauth_tokens` via `withHousehold`
 * (2.ª rede RLS — role authenticated). Upsert por `(household_id, user_id)`.
 *
 * Auth: sessão Supabase obrigatória. Padrão inline (espelha
 * `/api/conta/preferencias`): `getUser()` → `resolveHouseholdId(user.id)` →
 * `withHousehold({ userId, householdId }, ...)`. Sem sessão → 401.
 *
 * Sucesso → redirect `/visao?google_connected=true`. Erro (troca OAuth ou DB) →
 * log sem stack trace exposto + redirect `/visao?google_error=true`. O
 * `refresh_token` em plaintext nunca é logado nem persistido (só cifrado).
 *
 * `withHousehold` é importado de `@/lib/agent/db-shim` (NÃO `@meu-jarvis/db` —
 * lição REQ-INLINE-1, quebra resolução cross-package em tsc/webpack).
 *
 * Trace: Story J-3 AC8, ADR-003 (RLS runtime), SEC-7/SEC-8.1.
 */
import { sql } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';

import { createServerSupabaseClient } from '@meu-jarvis/auth/server';
import {
  annotateSpan,
  captureException,
  childLogger,
  hashForCorrelation,
  withSpan,
} from '@meu-jarvis/observability';

import { apiError } from '@/lib/errors';
import { withHousehold } from '@/lib/agent/db-shim';
import { encryptToken } from '@/lib/crypto/token-cipher';
import { exchangeCodeForTokens } from '@/lib/google/oauth';

const ROUTE = '/api/google/callback';

/**
 * Resolve o `household_id` activo do user (primeiro household do membership).
 * Mesma lógica de `/api/conta/preferencias`.
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

export async function GET(request: NextRequest): Promise<NextResponse> {
  return withSpan(
    'GET /api/google/callback',
    { method: 'GET', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'GET' });

      // Auth obrigatória — só um utilizador autenticado completa o fluxo OAuth.
      const supabase = await createServerSupabaseClient();
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError || !user) {
        annotateSpan(span, { statusCode: 401 });
        return apiError(
          'AUTH_REQUIRED',
          'Sessão inválida ou expirada. Inicia sessão e repete o fluxo de ligação ao Google.',
          401,
        );
      }

      annotateSpan(span, { userId: user.id });

      const params = request.nextUrl.searchParams;
      const code = params.get('code');
      const oauthError = params.get('error');

      // O Google devolve `?error=access_denied` se o utilizador recusar consentir.
      if (oauthError || !code) {
        annotateSpan(span, { statusCode: 302 });
        log.warn(
          { user_hash: hashForCorrelation(user.id), oauth_error: oauthError ?? 'missing_code' },
          'Callback OAuth Google sem código (recusa ou pedido inválido)',
        );
        return NextResponse.redirect(new URL('/visao?google_error=true', request.url));
      }

      const householdId = await resolveHouseholdId(user.id);
      if (!householdId) {
        annotateSpan(span, { statusCode: 404 });
        return apiError(
          'HOUSEHOLD_NOT_FOUND',
          'Household não encontrado. Completa o registo antes de ligar o Google.',
          404,
        );
      }

      annotateSpan(span, { householdId });

      try {
        // 1. Troca o código por tokens (fetch nativo ao token endpoint Google).
        const tokens = await exchangeCodeForTokens(code);

        // 2. Cifra o refresh_token (AES-256-GCM) — plaintext nunca persistido.
        const { ciphertext, iv, authTag } = encryptToken(tokens.refreshToken);
        // Últimos 6 chars do access_token (debug) — nunca o token completo.
        const accessTokenHint = tokens.accessToken.slice(-6);

        // 3. Upsert em google_oauth_tokens via withHousehold (2.ª rede RLS).
        await withHousehold({ userId: user.id, householdId }, (tx) =>
          tx.execute(sql`
            insert into public.google_oauth_tokens (
              household_id, user_id, encrypted_refresh_token, token_iv,
              token_auth_tag, access_token_hint, token_expiry, google_email
            )
            values (
              ${householdId}::uuid, ${user.id}::uuid, ${ciphertext}, ${iv},
              ${authTag}, ${accessTokenHint}, ${tokens.expiry.toISOString()}::timestamptz,
              ${tokens.email || null}
            )
            on conflict (household_id, user_id) do update set
              encrypted_refresh_token = excluded.encrypted_refresh_token,
              token_iv                = excluded.token_iv,
              token_auth_tag          = excluded.token_auth_tag,
              access_token_hint       = excluded.access_token_hint,
              token_expiry            = excluded.token_expiry,
              google_email            = excluded.google_email,
              updated_at              = now()
          `),
        );

        annotateSpan(span, { statusCode: 302 });
        log.info(
          { user_hash: hashForCorrelation(user.id) },
          'Google Calendar ligado — refresh_token cifrado gravado',
        );

        return NextResponse.redirect(new URL('/visao?google_connected=true', request.url));
      } catch (err) {
        // Log sem expor stack trace nem o refresh_token. Mensagem clara no redirect.
        annotateSpan(span, { statusCode: 302 });
        log.error(
          { user_hash: hashForCorrelation(user.id) },
          'Callback OAuth Google falhou (troca ou gravação)',
        );
        captureException(err instanceof Error ? err : new Error(String(err)), {
          route: ROUTE,
          userId: user.id,
        });
        return NextResponse.redirect(new URL('/visao?google_error=true', request.url));
      }
    },
  );
}
