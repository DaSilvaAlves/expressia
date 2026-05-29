/**
 * Callback route da verificação de email Supabase (Story 6.1 AC3 / DP1).
 *
 * O link de confirmação enviado por email (`emailRedirectTo` definido em
 * `signUpAction`) aponta para `/callback?code=...`. Aqui trocamos o `code`
 * por uma sessão (`exchangeCodeForSession`) via `@supabase/ssr`, que grava os
 * cookies de sessão, e encaminhamos para `/confirm`:
 *   - sucesso → `/confirm?status=ok` (CTA para continuar)
 *   - falha   → `/confirm?status=error` (link inválido/expirado)
 *   - sem code → `/entrar` (acesso directo sem fluxo de confirmação)
 *
 * É um Route Handler (não Server Component), logo pode escrever cookies — o
 * `createServerSupabaseClient` partilhado trata do setAll.
 *
 * Trace: Story 6.1 AC3/AC4, Architecture §5.1 (Supabase Auth SSR),
 *        stories/completed/1.5 (padrão @supabase/ssr).
 */
import { NextResponse, type NextRequest } from 'next/server';

import { createServerSupabaseClient } from '@meu-jarvis/auth/server';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const code = request.nextUrl.searchParams.get('code');

  // Acesso directo sem code (não veio do fluxo de confirmação) → login.
  if (!code) {
    return NextResponse.redirect(new URL('/entrar', request.url));
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  const status = error ? 'error' : 'ok';
  return NextResponse.redirect(new URL(`/confirm?status=${status}`, request.url));
}
