'use client';

import Link from 'next/link';
import { useActionState } from 'react';

import { signInAction, type AuthFormState } from '@/app/(auth)/actions';
import {
  ERROR_CLASS,
  INPUT_CLASS,
  LABEL_CLASS,
  LINK_CLASS,
  PRIMARY_BUTTON_CLASS,
} from '@/app/(auth)/_lib/styles';

const initialState: AuthFormState = {};

/**
 * Página de login (PT-PT). Branding via tokens `@meu-jarvis/ui` (Story 6.1 AC1).
 * Trace: Story 1.5 Task 5.1, Story 6.1 AC1, AC2.
 */
export default function EntrarPage() {
  const [state, formAction, isPending] = useActionState(signInAction, initialState);

  return (
    <>
      <h1 className="mb-1 text-xl font-semibold text-foreground">Entrar</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Acede à tua conta Expressia.
      </p>

      <form action={formAction} className="space-y-4">
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
            autoComplete="current-password"
            required
            className={INPUT_CLASS}
          />
        </div>

        {state.error ? (
          <p role="alert" className={ERROR_CLASS}>
            {state.error}
          </p>
        ) : null}

        <button type="submit" disabled={isPending} className={PRIMARY_BUTTON_CLASS}>
          {isPending ? 'A entrar…' : 'Entrar'}
        </button>
      </form>

      <div className="mt-6 space-y-2 text-center text-sm">
        <p>
          <Link href="/recuperar" className="text-muted-foreground underline hover:no-underline">
            Esqueci-me da palavra-passe
          </Link>
        </p>
        <p className="text-muted-foreground">
          Sem conta?{' '}
          <Link href="/registar" className={LINK_CLASS}>
            Regista-te
          </Link>
        </p>
      </div>
    </>
  );
}
