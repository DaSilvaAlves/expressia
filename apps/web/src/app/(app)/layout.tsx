import type { Metadata } from 'next';
import Link from 'next/link';

import { logoutAction } from '@/app/(app)/logout-action';

export const metadata: Metadata = {
  title: 'Expressia',
};

/**
 * Layout do route group `(app)/` — rotas autenticadas.
 *
 * O auth gate é feito no middleware (`apps/web/src/middleware.ts`) — se a
 * sessão for inválida, o utilizador é redireccionado para `/entrar` ANTES
 * de este layout renderizar. Logo, podemos assumir aqui que o user existe.
 *
 * Trace: Story 1.5 Task 7 (D13), Architecture §8.1 (route group app).
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-black/10 dark:border-white/10">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-6">
            <Link href="/visao" className="text-lg font-semibold">
              Expressia
            </Link>
            <nav className="flex items-center gap-4 text-sm">
              <Link href="/visao" className="hover:underline">
                Visão
              </Link>
              <Link href="/jarvis" className="hover:underline">
                Jarvis
              </Link>
              <Link href="/tarefas" className="hover:underline">
                Tarefas
              </Link>
              <Link href="/conta/preferencias" className="hover:underline">
                Conta
              </Link>
            </nav>
          </div>
          <form action={logoutAction}>
            <button
              type="submit"
              className="rounded-md border border-black/15 px-3 py-1.5 text-sm hover:bg-neutral-50 dark:border-white/15 dark:hover:bg-neutral-800"
            >
              Sair
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
