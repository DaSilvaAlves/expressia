'use client';

import Link from 'next/link';
import { useActionState } from 'react';

import { resetPasswordAction, type AuthFormState } from '@/app/(auth)/actions';
import {
  ERROR_CLASS,
  INPUT_CLASS,
  LABEL_CLASS,
  LINK_CLASS,
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
} from '@/app/(auth)/_lib/styles';

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
 * Branding via tokens `@meu-jarvis/ui` (Story 6.1 AC1).
 *
 * Trace: Story 1.5 Task 5.3, Story 6.1 AC1, AC2.
 */
export default function RecuperarPage() {
  const [state, formAction, isPending] = useActionState(actionWrapper, initialState);

  if (state.submitted) {
    return (
      <>
        <h1 className="mb-1 text-xl font-semibold text-foreground">Verifica o teu email</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          Se o endereço estiver associado a uma conta, vais receber um link para
          definir uma nova palavra-passe.
        </p>
        <Link href="/entrar" className={SECONDARY_BUTTON_CLASS}>
          Voltar a entrar
        </Link>
      </>
    );
  }

  return (
    <>
      <h1 className="mb-1 text-xl font-semibold text-foreground">Recuperar palavra-passe</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Indica o email associado à tua conta.
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

        {state.error ? (
          <p role="alert" className={ERROR_CLASS}>
            {state.error}
          </p>
        ) : null}

        <button type="submit" disabled={isPending} className={PRIMARY_BUTTON_CLASS}>
          {isPending ? 'A enviar…' : 'Enviar link'}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        <Link href="/entrar" className={LINK_CLASS}>
          Voltar
        </Link>
      </p>
    </>
  );
}
