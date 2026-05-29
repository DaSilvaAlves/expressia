'use server';

/**
 * Server Actions de autenticação.
 *
 * Convenção (Architecture §7.1): Server Actions > Route Handlers para mutações
 * iniciadas a partir do browser. Aqui evitamos `/api/auth/*` Route Handlers
 * porque Server Actions integram-se directamente com `<form action={...}>` e
 * permitem progressive enhancement sem JS.
 *
 * Comportamento:
 *   - `signInAction` — email+password → cookies set via @supabase/ssr → redirect /visao.
 *   - `signUpAction`  — registo (Supabase Auth dispara o trigger 0003 em auth.users).
 *   - `resetPasswordAction` — envia email Supabase reset (Resend integration futura).
 *
 * Erros: devolvem objecto `{ error: string }` em PT-PT que a página
 * cliente renderiza. Nunca lançam para o consumidor — UX > stack trace.
 *
 * TASK-1 (Dex 2026-05-26): mensagens específicas via helper
 *   `apps/web/src/app/(auth)/_lib/error-messages.ts` em vez de fallback
 *   genérico — anteriormente escondia codes accionáveis como
 *   `email_address_invalid` ou `over_email_send_rate_limit`, mascarando o
 *   root cause durante dias.
 *
 * Trace: Story 1.5 Task 5.4, Architecture §5.1, §7.1, AC2.
 */
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { createServerSupabaseClient } from '@meu-jarvis/auth/server';

import { mapSignInError, mapSignUpError } from '@/app/(auth)/_lib/error-messages';

/**
 * Deriva o origin absoluto da request actual (ex.: `https://expressia.pt` ou
 * `http://localhost:3000`) para construir o `emailRedirectTo` do Supabase.
 *
 * Story 6.1: preferimos derivar dos headers em vez de introduzir uma env var
 * `SITE_URL` (que exigiria configuração @devops em Vercel — mais um bloqueador).
 * O browser envia `origin` em POSTs same-origin; em fallback reconstruímos a
 * partir de `x-forwarded-proto` + `host` (Vercel/proxy) ou `host` simples.
 *
 * NOTA: o URL resultante (`{origin}/callback`) tem de estar na allowlist de
 * Redirect URLs do Supabase Dashboard → Authentication (bloqueador externo
 * documentado na AC9 / runbook supabase-auth-setup.md).
 */
async function getRequestOrigin(): Promise<string> {
  const h = await headers();
  const origin = h.get('origin');
  if (origin) return origin;
  const host = h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

export interface AuthFormState {
  readonly error?: string;
  /**
   * Mensagem positiva PT-PT (ex: "Verifica o teu email para confirmar a conta").
   * Distinta de `error` para a UI poder distinguir tom (info vs erro).
   */
  readonly info?: string;
}

/**
 * Login com email + palavra-passe.
 *
 * Em sucesso: Supabase grava cookies de sessão (via setAll do nosso server
 * client), e redirecciona para /visao (rota protegida — middleware fará o
 * check final do token refresh).
 */
export async function signInAction(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');

  if (!email || !password) {
    return { error: 'Indica o email e a palavra-passe.' };
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Helper expõe explicitamente `email_not_confirmed` (acionável); restantes
    // colapsam em "Email ou palavra-passe incorrectos" (anti-enumeration).
    return { error: mapSignInError(error) };
  }

  redirect('/visao');
}

/**
 * Registo (email + palavra-passe).
 *
 * Quando o Supabase Auth insere a row em `auth.users`, o trigger SQL
 * `on_auth_user_created` (migration 0003) dispara automaticamente:
 *  - cria household default ('Casa de {username}')
 *  - cria membership owner
 *  - cria subscription com trial 14d família
 *  - escreve audit_log
 *
 * Story 6.1 (DP1): a verificação de email nativa do Supabase é activada. O
 * `signUp` passa `emailRedirectTo` apontando para `/callback`, que troca o
 * `code` por sessão e encaminha para `/confirm`. Quando o Supabase devolve
 * `user` sem `session` (confirmação pendente), encaminhamos para `/confirm`
 * (estado pendente). Pré-condição externa: "Confirm email" ligado no Supabase
 * Dashboard + `{origin}/callback` na allowlist de Redirect URLs (AC9 / runbook).
 *
 * Histórico: D8 mantinha email confirmation OFF para o MVP (utilizador entrava
 * directo). O tratamento defensivo `user && !session` (TASK-1 2026-05-26) é
 * agora o caminho normal, não defensivo.
 */
export async function signUpAction(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const passwordConfirm = String(formData.get('password_confirm') ?? '');

  if (!email || !password) {
    return { error: 'Indica o email e a palavra-passe.' };
  }
  if (password.length < 8) {
    return { error: 'A palavra-passe tem de ter pelo menos 8 caracteres.' };
  }
  if (password !== passwordConfirm) {
    return { error: 'As palavras-passe não coincidem.' };
  }

  const origin = await getRequestOrigin();
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${origin}/callback` },
  });

  if (error) {
    return { error: mapSignUpError(error) };
  }

  // Verificação de email ligada (DP1): signUp devolve user sem sessão →
  // encaminhamos para `/confirm` (estado pendente "verifica o teu email").
  if (data.user && !data.session) {
    redirect('/confirm');
  }

  // Fallback: se "Confirm email" estiver OFF no Dashboard, a sessão fica activa
  // de imediato → entrada da app (onboarding 6.2 substitui /visao no futuro).
  redirect('/visao');
}

/**
 * Pedido de recuperação de palavra-passe.
 *
 * Supabase envia email com magic link de reset. UX completa de "definir nova
 * palavra-passe" depois do clique fica fora desta story (Epic 6 — UX completa).
 */
export async function resetPasswordAction(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = String(formData.get('email') ?? '').trim();

  if (!email) {
    return { error: 'Indica o teu email.' };
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email);

  if (error) {
    // Não expor existência da conta.
    return { error: 'Não foi possível enviar o email. Tenta novamente.' };
  }

  return {
    error: undefined,
    // Mensagem positiva mas neutra para evitar enumeration.
  };
}
