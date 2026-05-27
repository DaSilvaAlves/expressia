'use client';

import Link from 'next/link';
import { useActionState } from 'react';

import { signUpAction, type AuthFormState } from '@/app/(auth)/actions';

const initialState: AuthFormState = {};

/**
 * Página de registo (PT-PT).
 *
 * Após signUp Supabase, o trigger SQL on_auth_user_created cria
 * automaticamente o household + membership owner + subscription
 * trial 14d (Story 1.5 AC4 — migration 0003).
 *
 * Trace: Story 1.5 Task 5.2, AC2.
 */
export default function RegistarPage() {
  const [state, formAction, isPending] = useActionState(signUpAction, initialState);

  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">Criar conta</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        14 dias grátis com plano Família. Sem cartão.
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
            autoComplete="new-password"
            required
            minLength={8}
            className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-white/15 dark:bg-neutral-800"
          />
          <p className="mt-1 text-xs text-muted-foreground">Mínimo 8 caracteres.</p>
        </div>

        <div>
          <label htmlFor="password_confirm" className="mb-1 block text-sm font-medium">
            Confirmar palavra-passe
          </label>
          <input
            id="password_confirm"
            name="password_confirm"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-white/15 dark:bg-neutral-800"
          />
        </div>

        {state.error ? (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {state.error}
          </p>
        ) : null}

        {state.info ? (
          <p role="status" className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
            {state.info}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={isPending}
          className="w-full rounded-md bg-black px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-neutral-200"
        >
          {isPending ? 'A registar…' : 'Registar'}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Já tens conta?{' '}
        <Link href="/entrar" className="font-medium text-foreground underline hover:no-underline">
          Entra
        </Link>
      </p>
    </>
  );
}
