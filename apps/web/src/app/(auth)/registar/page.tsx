'use client';

import Link from 'next/link';
import { useActionState } from 'react';

import { signUpAction, type AuthFormState } from '@/app/(auth)/actions';
import {
  ERROR_CLASS,
  HINT_CLASS,
  INFO_CLASS,
  INPUT_CLASS,
  LABEL_CLASS,
  LINK_CLASS,
  PRIMARY_BUTTON_CLASS,
} from '@/app/(auth)/_lib/styles';

const initialState: AuthFormState = {};

/**
 * Página de registo (PT-PT).
 *
 * Após signUp Supabase, o trigger SQL on_auth_user_created cria
 * automaticamente o household + membership owner + subscription
 * trial 14d (Story 1.5 AC4 — migration 0003).
 *
 * Com a verificação de email ligada (Story 6.1 / DP1), `signUpAction`
 * encaminha para `/confirm` quando a sessão fica pendente de confirmação.
 *
 * Branding via tokens `@meu-jarvis/ui` (Story 6.1 AC1).
 *
 * Trace: Story 1.5 Task 5.2, Story 6.1 AC1/AC2, AC2.
 */
export default function RegistarPage() {
  const [state, formAction, isPending] = useActionState(signUpAction, initialState);

  return (
    <>
      <h1 className="mb-1 text-xl font-semibold text-foreground">Criar conta</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        14 dias grátis com plano Premium. Sem cartão.
      </p>

      <form action={formAction} className="space-y-4">
        <div>
          <label htmlFor="name" className={LABEL_CLASS}>
            Nome
          </label>
          <input
            id="name"
            name="name"
            type="text"
            autoComplete="name"
            required
            maxLength={80}
            className={INPUT_CLASS}
          />
          <p className={HINT_CLASS}>É assim que apareces na app.</p>
        </div>

        <div>
          <label htmlFor="email" className={LABEL_CLASS}>
            Endereço de email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            className={INPUT_CLASS}
          />
        </div>

        <div>
          <label htmlFor="password" className={LABEL_CLASS}>
            Palavra-passe
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
            Confirmar palavra-passe
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

        {state.error ? (
          <p role="alert" className={ERROR_CLASS}>
            {state.error}
          </p>
        ) : null}

        {state.info ? (
          <p role="status" className={INFO_CLASS}>
            {state.info}
          </p>
        ) : null}

        <button type="submit" disabled={isPending} className={PRIMARY_BUTTON_CLASS}>
          {isPending ? 'A registar…' : 'Registar'}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Já tens conta?{' '}
        <Link href="/entrar" className={LINK_CLASS}>
          Entra
        </Link>
      </p>
    </>
  );
}
