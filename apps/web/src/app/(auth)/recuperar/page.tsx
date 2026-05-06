'use client';

import Link from 'next/link';
import { useActionState } from 'react';

import { resetPasswordAction, type AuthFormState } from '@/app/(auth)/actions';

interface ResetState extends AuthFormState {
  readonly submitted?: boolean;
}

const initialState: ResetState = {};

async function actionWrapper(prev: ResetState, formData: FormData): Promise<ResetState> {
  const result = await resetPasswordAction(prev, formData);
  return { ...result, submitted: !result.error };
}

/**
 * Página de recuperação de palavra-passe (PT-PT).
 *
 * UX completa de "definir nova palavra-passe" após clique no link do email
 * fica fora desta story (Epic 6). Aqui apenas pedimos o email.
 *
 * Trace: Story 1.5 Task 5.3, AC2.
 */
export default function RecuperarPage() {
  const [state, formAction, isPending] = useActionState(actionWrapper, initialState);

  if (state.submitted) {
    return (
      <>
        <h1 className="mb-1 text-xl font-semibold">Verifica o teu email</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          Se o endereço estiver associado a uma conta, vais receber um link para
          definir uma nova palavra-passe.
        </p>
        <Link
          href="/entrar"
          className="block w-full rounded-md border border-black/15 px-3 py-2 text-center text-sm font-medium hover:bg-neutral-50 dark:border-white/15 dark:hover:bg-neutral-800"
        >
          Voltar a entrar
        </Link>
      </>
    );
  }

  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">Recuperar palavra-passe</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Indica o email associado à tua conta.
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
          {isPending ? 'A enviar…' : 'Enviar link'}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        <Link href="/entrar" className="font-medium text-foreground underline hover:no-underline">
          Voltar
        </Link>
      </p>
    </>
  );
}
