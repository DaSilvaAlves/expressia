/**
 * Callback route da verificação de email Supabase (Story 6.1 AC3 / DP1).
 *
 * Suporta DOIS fluxos de confirmação, por ordem de preferência:
 *
 *   1. **`token_hash` + `verifyOtp` (recomendado para SSR — Story 6.1.x fix).**
 *      O email template "Confirm signup" aponta para
 *      `{{ .SiteURL }}/callback?token_hash={{ .TokenHash }}&type=email`. Aqui
 *      chamamos `verifyOtp({ type, token_hash })`, que é **stateless** — não
 *      depende de nenhum cookie. Resolve o `AuthPKCECodeVerifierMissingError`
 *      que afectava o fluxo `?code=` (o `code_verifier` gerado no `signUp` não
 *      sobrevive à navegação cross-site do link de email) e é imune ao prefetch
 *      de scanners de email.
 *
 *   2. **`code` + `exchangeCodeForSession` (retrocompat — OAuth/magic-link).**
 *      Mantido para links antigos e para fluxos PKCE iniciados e terminados no
 *      mesmo contexto de browser (onde o verifier está presente).
 *
 * Em ambos: sucesso → `/confirm?status=ok`; falha → `/confirm?status=error`.
 * Sem token nem code → `/entrar` (acesso directo sem fluxo de confirmação).
 *
 * **`?next=` (Soft-launch A2 — recuperação de palavra-passe).** O fluxo de reset
 * (`resetPasswordAction`) aponta o `redirectTo` do email para
 * `{origin}/callback?next=/recuperar/nova-palavra-passe&type=recovery`. O
 * `verifyOtp({ type: 'recovery', ... })` estabelece aqui (server-side, via
 * cookies SSR) uma **sessão de recuperação** de curta duração; em vez de cair em
 * `/confirm`, encaminhamos para o `next` indicado, onde o utilizador define a
 * nova palavra-passe via `updateUser`. O `next` é validado contra uma allowlist
 * de paths internos (open-redirect guard) — só aceitamos caminhos relativos
 * conhecidos, nunca URLs absolutos fornecidos pelo atacante.
 *
 * É um Route Handler (não Server Component), logo pode escrever cookies — o
 * `createServerSupabaseClient` partilhado trata do setAll (grava a sessão).
 *
 * Trace: Story 6.1 AC3/AC4 + fix EMAIL-CONFIRM (token_hash), Architecture §5.1
 *        (Supabase Auth SSR), stories/completed/1.5 (padrão @supabase/ssr).
 */
import type { EmailOtpType } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';

import { createServerSupabaseClient } from '@meu-jarvis/auth/server';

/** Tipos de OTP de email aceites no link de confirmação. */
const EMAIL_OTP_TYPES: readonly EmailOtpType[] = [
  'email',
  'signup',
  'invite',
  'magiclink',
  'recovery',
  'email_change',
];

function normalizeOtpType(raw: string | null): EmailOtpType {
  return EMAIL_OTP_TYPES.includes(raw as EmailOtpType) ? (raw as EmailOtpType) : 'email';
}

/**
 * Allowlist de destinos `?next=` (open-redirect guard).
 *
 * Só permitimos caminhos relativos internos explicitamente conhecidos. Nunca
 * confiamos no valor cru (que poderia ser `https://evil.com` ou `//evil.com`)
 * para evitar redireccionar a sessão de recuperação para um host externo.
 */
const ALLOWED_NEXT_PATHS: readonly string[] = ['/recuperar/nova-palavra-passe'];

function resolveNext(raw: string | null): string | null {
  return raw && ALLOWED_NEXT_PATHS.includes(raw) ? raw : null;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const params = request.nextUrl.searchParams;
  const tokenHash = params.get('token_hash');
  const code = params.get('code');
  const next = resolveNext(params.get('next'));

  const supabase = await createServerSupabaseClient();

  // Fluxo 1 (preferido): token_hash + verifyOtp — stateless, sem code_verifier.
  if (tokenHash) {
    const { error } = await supabase.auth.verifyOtp({
      type: normalizeOtpType(params.get('type')),
      token_hash: tokenHash,
    });
    // Recuperação de palavra-passe (A2): sessão de recovery criada → segue para
    // a página de definição da nova palavra-passe em vez de /confirm.
    if (!error && next) {
      return NextResponse.redirect(new URL(next, request.url));
    }
    const status = error ? 'error' : 'ok';
    return NextResponse.redirect(new URL(`/confirm?status=${status}`, request.url));
  }

  // Fluxo 2 (retrocompat): code + exchangeCodeForSession (PKCE OAuth/magic-link).
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && next) {
      return NextResponse.redirect(new URL(next, request.url));
    }
    const status = error ? 'error' : 'ok';
    return NextResponse.redirect(new URL(`/confirm?status=${status}`, request.url));
  }

  // Acesso directo sem token nem code (não veio do fluxo de confirmação) → login.
  return NextResponse.redirect(new URL('/entrar', request.url));
}
