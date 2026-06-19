'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';

import type { SupabaseClient } from '@supabase/supabase-js';

import { createBrowserSupabaseClient } from '@meu-jarvis/auth/browser';

import { validateNewPassword } from '@/app/(auth)/recuperar/nova-palavra-passe/_lib/validate';
import {
  ERROR_CLASS,
  HINT_CLASS,
  INPUT_CLASS,
  LABEL_CLASS,
  LINK_CLASS,
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
} from '@/app/(auth)/_lib/styles';

/**
 * Página de definição de nova palavra-passe (Soft-launch A2 — PT-PT).
 *
 * Fecha o fluxo de recuperação iniciado em `/recuperar`:
 *
 *   recuperar (envia email)
 *     → email com link `{origin}/callback?token_hash=…&type=recovery&next=…`
 *     → /callback faz `verifyOtp({ type: 'recovery' })` → cria sessão de recovery
 *       (cookies SSR) → redirecciona para AQUI
 *     → o utilizador define a nova palavra-passe → `updateUser({ password })`
 *       autenticado por essa sessão de recovery → /entrar.
 *
 * Client Component: usa o `createBrowserSupabaseClient` (lê os cookies de sessão
 * de recovery do `document.cookie`) para chamar `updateUser`. Não há Server
 * Action porque a sessão de recovery vive no browser e o `updateUser` opera sobre
 * ela directamente — é o caminho mais simples e coerente com o `@supabase/ssr`.
 *
 * Estados:
 *   - form     — pede nova palavra-passe + confirmação;
 *   - success  — palavra-passe alterada, CTA para /entrar;
 *   - error    — link expirado/inválido ou falha do `updateUser`, com mensagem
 *     PT-PT e link para reiniciar o fluxo em /recuperar.
 *
 * Validação local espelha o registo (mín. 8 caracteres + confirmação) via
 * `validateNewPassword` (função pura testável). O Supabase reforça as suas
 * próprias regras (`weak_password`) — tratamos esse erro com mensagem PT-PT.
 *
 * A11y: labels associados, `role="alert"`/`role="status"` para mensagens, foco
 * gerido pelo browser no submit. PT-PT europeu.
 *
 * Branding via tokens `@meu-jarvis/ui` (styles partilhados de auth).
 *
 * Trace: Soft-launch A2; (auth)/actions.ts (resetPasswordAction);
 *        (auth)/callback/route.ts (next + verifyOtp recovery).
 */

/**
 * Rota interativa de recuperação de palavra-passe — semanticamente nunca deve ser
 * conteúdo estático. Esta directiva declara a intenção (render dinâmico) e é inócua;
 * note-se que num Client Component puro o Next pode ainda gerar o shell estático.
 * O que GARANTE que o build não parte é a criação lazy do cliente (abaixo): o
 * `createBrowserSupabaseClient()` deixou de correr durante o render/prerender.
 */
export const dynamic = 'force-dynamic';

export default function NovaPalavraPassePage() {
  // Criação LAZY do cliente Supabase: só é instanciado na primeira utilização real
  // (no `handleSubmit`, sempre no browser). NUNCA durante o render/prerender — é o
  // que evita que `createBrowserSupabaseClient()` (que lê `NEXT_PUBLIC_*`, vazias no
  // job Build da CI) corra no servidor de build e lance. O `ref` persiste entre
  // renders sem recriar o cliente (substitui o antigo `useMemo`, que corria no render).
  const supabaseRef = useRef<SupabaseClient | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);

    const formData = new FormData(event.currentTarget);
    const password = String(formData.get('password') ?? '');
    const passwordConfirm = String(formData.get('password_confirm') ?? '');

    const validationError = validateNewPassword(password, passwordConfirm);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);
    const supabase = (supabaseRef.current ??= createBrowserSupabaseClient());
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSubmitting(false);

    if (updateError) {
      // Sem sessão de recovery válida (link expirado/já usado) o Supabase devolve
      // erro de autenticação; `weak_password` se a regra do servidor falhar.
      const code = (updateError as { code?: string }).code;
      if (code === 'weak_password') {
        setError('A palavra-passe é demasiado fraca. Escolhe uma mais forte.');
      } else if (code === 'same_password') {
        setError('A nova palavra-passe tem de ser diferente da anterior.');
      } else {
        setError(
          'O link de recuperação expirou ou já foi utilizado. Pede um novo abaixo.',
        );
      }
      return;
    }

    setDone(true);
  }

  if (done) {
    return (
      <div role="status">
        <h1 className="mb-1 text-xl font-semibold text-foreground">Palavra-passe alterada</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          A tua palavra-passe foi actualizada. Já podes entrar com a nova.
        </p>
        <Link href="/entrar" className={PRIMARY_BUTTON_CLASS}>
          Entrar
        </Link>
      </div>
    );
  }

  return (
    <>
      <h1 className="mb-1 text-xl font-semibold text-foreground">Definir nova palavra-passe</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Escolhe uma nova palavra-passe para a tua conta.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="password" className={LABEL_CLASS}>
            Nova palavra-passe
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            className={INPUT_CLASS}
          />
          <p className={HINT_CLASS}>Mínimo 8 caracteres.</p>
        </div>

        <div>
          <label htmlFor="password_confirm" className={LABEL_CLASS}>
            Confirmar nova palavra-passe
          </label>
          <input
            id="password_confirm"
            name="password_confirm"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            className={INPUT_CLASS}
          />
        </div>

        {error ? (
          <p role="alert" className={ERROR_CLASS}>
            {error}
          </p>
        ) : null}

        <button type="submit" disabled={submitting} className={PRIMARY_BUTTON_CLASS}>
          {submitting ? 'A guardar…' : 'Guardar palavra-passe'}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Link expirado?{' '}
        <Link href="/recuperar" className={LINK_CLASS}>
          Pedir um novo
        </Link>
      </p>

      <div className="mt-2">
        <Link href="/entrar" className={SECONDARY_BUTTON_CLASS}>
          Voltar a entrar
        </Link>
      </div>
    </>
  );
}
