/**
 * GET /api/google/auth-url — devolve o URL de consentimento OAuth (Story J-3 AC8.4).
 *
 * Helper de setup one-shot: permite ao Eurico iniciar o fluxo OAuth manualmente
 * durante a configuração (abrir o URL → consentir → cair no callback). Requer
 * sessão Supabase autenticada (mesmo gate do callback).
 *
 * Devolve `{ url }` com o URL de consentimento (scope `calendar.readonly`,
 * `access_type=offline` + `prompt=consent`). Não persiste nada.
 *
 * Trace: Story J-3 AC8 (Tarefa 4.4), PRD-Jarvis §4.4.
 */
import { NextResponse } from 'next/server';

import { createServerSupabaseClient } from '@meu-jarvis/auth/server';
import { annotateSpan, withSpan } from '@meu-jarvis/observability';

import { apiError } from '@/lib/errors';
import { buildGoogleAuthUrl, GoogleOAuthError } from '@/lib/google/oauth';

const ROUTE = '/api/google/auth-url';

export async function GET(): Promise<NextResponse> {
  return withSpan(
    'GET /api/google/auth-url',
    { method: 'GET', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const supabase = await createServerSupabaseClient();
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError || !user) {
        annotateSpan(span, { statusCode: 401 });
        return apiError(
          'AUTH_REQUIRED',
          'Sessão inválida ou expirada. Inicia sessão para obter o URL de ligação ao Google.',
          401,
        );
      }

      try {
        const url = buildGoogleAuthUrl();
        annotateSpan(span, { statusCode: 200 });
        return NextResponse.json({ url });
      } catch (err) {
        annotateSpan(span, { statusCode: 500 });
        // GoogleOAuthError = credenciais OAuth em falta no ambiente.
        const message =
          err instanceof GoogleOAuthError
            ? 'Configuração OAuth Google em falta no servidor (credenciais).'
            : 'Erro ao gerar o URL de consentimento.';
        return apiError('GOOGLE_OAUTH_NOT_CONFIGURED', message, 500);
      }
    },
  );
}
