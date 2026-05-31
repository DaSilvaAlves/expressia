import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { createServerSupabaseClient } from '@meu-jarvis/auth/server';

import type { HouseholdResponse } from '@/lib/api-schemas/households';

import { HouseholdEditor } from './_components/household-editor';

export const metadata: Metadata = {
  title: 'Família — Expressia',
};

/**
 * Página `/conta/household` — gestão do household + membros (Story 6.x).
 *
 * Server Component: faz fetch SSR ao endpoint próprio `/api/conta/household`
 * (mesma estratégia de `conta/preferencias/page.tsx` — `headers()` reencaminha
 * cookies para garantir auth via sessão). O estado interactivo (renomear) vive
 * no Client Component `<HouseholdEditor>`.
 *
 * Trace: Story 6.x AC1-AC4; Architecture §4.4.
 */
export default async function HouseholdPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/entrar');
  }

  const hdrs = await headers();
  const protocol = hdrs.get('x-forwarded-proto') ?? 'http';
  const host = hdrs.get('host') ?? 'localhost:3000';
  const cookie = hdrs.get('cookie') ?? '';

  let data: HouseholdResponse | null = null;
  try {
    const res = await fetch(`${protocol}://${host}/api/conta/household`, {
      headers: { cookie },
      cache: 'no-store',
    });
    if (res.ok) {
      data = (await res.json()) as HouseholdResponse;
    }
  } catch {
    // Falha não-fatal — renderizamos estado de erro abaixo.
  }

  return (
    <div className="space-y-6">
      <div>
        <nav className="text-xs text-muted-foreground" aria-label="Breadcrumb">
          Conta › Família
        </nav>
        <h1 className="mt-1 text-2xl font-bold">Família</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Gere o nome da tua família e vê quem faz parte dela.
        </p>
      </div>

      {data ? (
        <HouseholdEditor initial={data} />
      ) : (
        <p className="text-sm text-destructive">
          Não foi possível carregar os dados da família. Recarrega a página.
        </p>
      )}
    </div>
  );
}
