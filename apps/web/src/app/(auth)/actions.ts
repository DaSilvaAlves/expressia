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
 * Deriva o origin absoluto usado para construir o `emailRedirectTo` /
 * `redirectTo` do Supabase (ex.: `https://expressia.pt` ou
 * `http://localhost:3000`).
 *
 * SEC-9 (endurecimento): em produção lemos a env var de confiança `SITE_URL`
 * como PRIMEIRA instrução. Quando está definida e não-vazia, devolvemos esse
 * valor sem consultar nenhum header HTTP — eliminando por completo o vector de
 * password-reset-poisoning (um atacante que envenene `Host`/`Origin` não
 * consegue desviar o link de reset/confirm para um domínio sob o seu controlo).
 *
 * Esta secção concretiza a Directive registada no commit `f472c22` (A2 — reset
 * de password): «Antes de tráfego real: fixar SITE_URL via env var em produção
 * OU restringir o wildcard *.vercel.app na allowlist». `SITE_URL` não deve ter
 * trailing slash (ex.: `https://expressia.pt`, não `https://expressia.pt/`),
 * porque é concatenada directamente com `/callback`.
 *
 * Story 6.1 (fallback): quando `SITE_URL` NÃO está definida, mantemos a
 * derivação por headers — compatível com desenvolvimento local e deploys de
 * preview Vercel (subdomínios `*.vercel.app` dinâmicos). O browser envia
 * `origin` em POSTs same-origin; em fallback reconstruímos a partir de
 * `x-forwarded-proto` + `host` (Vercel/proxy) ou `host` simples.
 *
 * NOTA: o URL resultante (`{origin}/callback`) tem de estar na allowlist de
 * Redirect URLs do Supabase Dashboard → Authentication (bloqueador externo
 * documentado na AC9 / runbook supabase-auth-setup.md §5).
 */
async function getRequestOrigin(): Promise<string> {
  // SEC-9: env var de confiança tem precedência sobre headers controláveis pelo
  // cliente. Verificação truthy (e não `??`) é intencional — uma string vazia
  // configurada por engano deve cair no fallback, não tornar-se um origin `''`.
  // SEC-001 (robustez de config): normalizamos uma eventual barra final, porque
  // o valor é concatenado directamente com `/callback`. Se um operador colar
  // `https://expressia.pt/` (erro de config provável), `.replace(/\/$/, '')`
  // evita a barra dupla `//callback`. Não afecta o host nem o ramo de fallback.
  const siteUrl = process.env.SITE_URL;
  if (siteUrl) return siteUrl.replace(/\/$/, '');

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
  const name = String(formData.get('name') ?? '').trim();
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const passwordConfirm = String(formData.get('password_confirm') ?? '');

  if (!email || !password) {
    return { error: 'Indica o email e a palavra-passe.' };
  }
  // Story 6.1.x: o nome é obrigatório no registo — alimenta `user_metadata.name`
  // (saudação /visao via resolveDisplayName) e `household_members.display_name`
  // (lista de membros em /conta/household, preenchido pelo trigger 0019).
  if (!name) {
    return { error: 'Indica o teu nome.' };
  }
  if (name.length > 80) {
    return { error: 'O nome é demasiado longo (máx. 80 caracteres).' };
  }
  if (password.length < 8) {
    return { error: 'A palavra-passe tem de ter pelo menos 8 caracteres.' };
  }
  if (password !== passwordConfirm) {
    return { error: 'As palavras-passe não coincidem.' };
  }

  const origin = await getRequestOrigin();
  const supabase = await createServerSupabaseClient();
  // `options.data` é gravado em `auth.users.raw_user_meta_data` → exposto como
  // `user_metadata` na sessão. O trigger 0019 lê-o para preencher o display_name.
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { name }, emailRedirectTo: `${origin}/callback` },
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
 * Path interno da página onde o utilizador define a nova palavra-passe após
 * clicar no link de recuperação. Encaminhado via `/callback?next=...` (o callback
 * estabelece a sessão de recovery e só então redirecciona para cá).
 */
const RESET_REDIRECT_PATH = '/recuperar/nova-palavra-passe';

/**
 * Pedido de recuperação de palavra-passe (Soft-launch A2).
 *
 * Supabase envia email com magic link de reset. O `redirectTo` aponta para o
 * nosso `/callback` (mesmo Route Handler da confirmação de email) com
 * `?next=/recuperar/nova-palavra-passe&type=recovery`:
 *
 *   1. O utilizador clica no link → `/callback?token_hash=…&type=recovery&next=…`.
 *   2. O callback chama `verifyOtp({ type: 'recovery', token_hash })`, que cria
 *      uma sessão de recuperação (cookies SSR), e redirecciona para o `next`.
 *   3. Em `/recuperar/nova-palavra-passe` o cliente chama
 *      `updateUser({ password })`, autenticado por essa sessão de recovery.
 *
 * O `origin` vem de `getRequestOrigin()` (mesma fonte que `signUpAction`): em
 * produção a env var de confiança `SITE_URL` (SEC-9), com fallback por headers
 * em dev/preview. O `{origin}/callback` tem de estar na allowlist de Redirect
 * URLs do Supabase Dashboard.
 *
 * Anti-enumeration: tanto sucesso como falha devolvem o mesmo estado neutro
 * (`{ error: undefined }`) — a página mostra sempre "se o email existir, recebes
 * um link". Não revelamos se a conta existe.
 */
export async function resetPasswordAction(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = String(formData.get('email') ?? '').trim();

  if (!email) {
    return { error: 'Indica o teu email.' };
  }

  const origin = await getRequestOrigin();
  const supabase = await createServerSupabaseClient();
  // `redirectTo` é anexado ao link do email; o `next` instrui o callback a
  // encaminhar para a página de definição de nova palavra-passe após o verifyOtp.
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/callback?next=${encodeURIComponent(RESET_REDIRECT_PATH)}`,
  });

  if (error) {
    // Não expor existência da conta.
    return { error: 'Não foi possível enviar o email. Tenta novamente.' };
  }

  return {
    error: undefined,
    // Mensagem positiva mas neutra para evitar enumeration.
  };
}
