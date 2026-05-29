import Link from 'next/link';

import {
  LINK_CLASS,
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
} from '@/app/(auth)/_lib/styles';

/**
 * Página de confirmação de email (PT-PT) — Story 6.1 AC4.
 *
 * Comunica três estados, derivados do query param `status`:
 *   - (sem status) pendente — após registo, antes de o utilizador clicar no
 *     link do email ("verifica o teu email");
 *   - `ok` — pós-confirmação bem-sucedida (a callback route trocou code→sessão),
 *     com CTA para continuar para a app;
 *   - `error` — link inválido/expirado, com CTAs para recuperar o fluxo.
 *
 * Server Component: lê `searchParams` (Promise em Next 15). Branding via tokens
 * `@meu-jarvis/ui` herdados do `(auth)/layout.tsx`.
 *
 * Trace: Story 6.1 AC4; callback/route.ts; (auth)/actions.ts (signUpAction).
 */

type ConfirmStatus = 'ok' | 'error' | 'pending';

function normalizeStatus(raw: string | string[] | undefined): ConfirmStatus {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === 'ok') return 'ok';
  if (value === 'error') return 'error';
  return 'pending';
}

export default async function ConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string | string[] }>;
}) {
  const { status: rawStatus } = await searchParams;
  const status = normalizeStatus(rawStatus);

  if (status === 'ok') {
    return (
      <div role="status">
        <h1 className="mb-1 text-xl font-semibold text-foreground">Email confirmado</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          A tua conta Expressia está activa. Bem-vindo!
        </p>
        <Link href="/visao" className={PRIMARY_BUTTON_CLASS}>
          Continuar
        </Link>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div role="alert">
        <h1 className="mb-1 text-xl font-semibold text-foreground">Link inválido ou expirado</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          O link de confirmação já não é válido. Regista-te novamente para
          receber um novo, ou entra se já confirmaste a conta.
        </p>
        <div className="space-y-2">
          <Link href="/registar" className={PRIMARY_BUTTON_CLASS}>
            Voltar a registar
          </Link>
          <Link href="/entrar" className={SECONDARY_BUTTON_CLASS}>
            Entrar
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div role="status">
      <h1 className="mb-1 text-xl font-semibold text-foreground">Confirma o teu email</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Enviámos um link de confirmação para o teu email. Abre-o para activares a
        conta. Se não o encontrares, verifica a pasta de spam.
      </p>
      <p className="text-center text-sm text-muted-foreground">
        Já confirmaste?{' '}
        <Link href="/entrar" className={LINK_CLASS}>
          Entra
        </Link>
      </p>
    </div>
  );
}
