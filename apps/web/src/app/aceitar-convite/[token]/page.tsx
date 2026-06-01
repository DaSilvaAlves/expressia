import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { createServerSupabaseClient } from '@meu-jarvis/auth/server';

import { AceitarConvite } from './_components/aceitar-convite';

export const metadata: Metadata = {
  title: 'Aceitar convite — Expressia',
};

/**
 * Página `/aceitar-convite/{token}` — Story 6.7 AC6.
 *
 * Server Component: exige sessão. Sem sessão → `/entrar?next=...` (preserva o
 * retorno ao link). Com sessão → renderiza o Client Component que confirma a
 * aceitação (POST a `/api/conta/household/aceitar-convite`). A aceitação é uma
 * mutação, por isso fica num clique explícito (não em GET de render).
 *
 * Esta rota vive fora de `(app)`/`(auth)` — herda o RootLayout (tema) mas não o
 * shell; usa um container centrado próprio. Trace: Story 6.7 AC6.
 */
export default async function AceitarConvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<React.JSX.Element> {
  const { token } = await params;

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/entrar?next=${encodeURIComponent(`/aceitar-convite/${token}`)}`);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12 text-foreground">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-sm">
        <h1 className="text-xl font-bold">Convite para uma família</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Aceita o convite para te juntares a esta família na Expressia e
          partilhar tarefas e finanças.
        </p>
        <div className="mt-6">
          <AceitarConvite token={token} />
        </div>
      </div>
    </main>
  );
}
