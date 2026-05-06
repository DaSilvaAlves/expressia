'use client';

import Link from 'next/link';
import { useActionState } from 'react';

import { signInAction, type AuthFormState } from '@/app/(auth)/actions';

const initialState: AuthFormState = {};

/**
 * Página de login (PT-PT).
 * Trace: Story 1.5 Task 5.1, AC2.
 */
export default function EntrarPage() {
  const [state, formAction, isPending] = useActionState(signInAction, initialState);

  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">Entrar</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Acede à tua conta Expressia.
      </p>

      <form action={formAction} className="space-y-4">
        <div>
          <label htmlFor="email" className="mb-1 block text-sm font-medium">
            Endereço de email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-white/15 dark:bg-neutral-800"
          />
        </div>

        <div>
          <label htmlFor="password" className="mb-1 block text-sm font-medium">
            Palavra-passe
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-white/15 dark:bg-neutral-800"
          />
        </div>

        {state.error ? (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {state.error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={isPending}
          className="w-full rounded-md bg-black px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-neutral-200"
        >
          {isPending ? 'A entrar…' : 'Entrar'}
        </button>
      </form>

      <div className="mt-6 space-y-2 text-center text-sm">
        <p>
          <Link href="/recuperar" className="underline hover:no-underline">
            Esqueci-me da palavra-passe
          </Link>
        </p>
        <p className="text-muted-foreground">
          Sem conta?{' '}
          <Link href="/registar" className="font-medium text-foreground underline hover:no-underline">
            Regista-te
          </Link>
        </p>
      </div>
    </>
  );
}
