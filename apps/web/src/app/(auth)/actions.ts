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
 * Trace: Story 1.5 Task 5.4, Architecture §5.1, §7.1, AC2.
 */
import { redirect } from 'next/navigation';

import { createServerSupabaseClient } from '@meu-jarvis/auth/server';

export interface AuthFormState {
  readonly error?: string;
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
    // Não expor detalhes internos — risco de enumeration.
    return { error: 'Email ou palavra-passe incorrectos.' };
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
 * D8 (decidido): email confirmation OFF para MVP — o utilizador entra
 * directamente após signup. Documentado em runbook supabase-auth-setup.md
 * como follow-up quando Resend integrar.
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

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.signUp({ email, password });

  if (error) {
    return { error: 'Não foi possível concluir o registo. Tenta novamente.' };
  }

  // D8: sem email confirmation, o utilizador entra directamente após signUp.
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
