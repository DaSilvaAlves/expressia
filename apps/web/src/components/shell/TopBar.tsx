/**
 * `<TopBar>` — barra superior 56px com hamburger (mobile/tablet), breadcrumb
 * minimal, slot de tema e bloco avatar+logout (Story 5.3 AC3).
 *
 * Server Component — recebe `user` injectado pelo `AppShell` (evita
 * `getUser()` duplicado). O `<TopBarHamburger>` é o único sub-componente
 * Client (state do drawer mobile).
 *
 * Layout:
 *   [Hamburger (lg:hidden)] [Breadcrumb h1] [spacer] [slot theme] [Avatar+Sair]
 *
 * O slot vazio renderiza `<div data-slot="theme-toggle">` para que a Story 5.8
 * possa montar o `<ThemeToggle>` sem tocar nesta story.
 *
 * **D-5.3.2:** breadcrumb minimal incluído via sub-componente Client
 * `<BreadcrumbLabel>` (precisa `usePathname()`). KISS — label-pai apenas.
 *
 * Logout: `<form action={logoutAction}>` preservado byte-a-byte da Story 1.5
 * D15 (AC3.e). Sem alteração ao Server Action.
 *
 * Trace: Story 5.3 AC3; Story 1.5 D15 (logoutAction preservado).
 */
import type { User } from '@supabase/supabase-js';

import { logoutAction } from '@/app/(app)/logout-action';
import { BreadcrumbLabel } from '@/components/shell/BreadcrumbLabel';
import { TopBarHamburger } from '@/components/shell/TopBarHamburger';

interface TopBarProps {
  user: User | null;
}

export function TopBar({ user }: TopBarProps) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-black/10 px-3 dark:border-white/10">
      {/* Hamburger — Client sub-componente, visível só <1024px. */}
      <TopBarHamburger />

      {/* Breadcrumb minimal — Client sub-componente (usePathname). */}
      <BreadcrumbLabel />

      {/* Spacer empurra blocos à direita */}
      <div className="flex-1" aria-hidden="true" />

      {/* Slot theme-toggle — Story 5.8 monta `<ThemeToggle>` aqui. */}
      <div
        data-slot="theme-toggle"
        aria-hidden="true"
        className="empty:hidden"
      />

      {/* Avatar + Sair */}
      {user ? (
        <div className="flex items-center gap-2">
          <span
            className="hidden h-8 w-8 items-center justify-center rounded-full bg-neutral-200 text-xs font-semibold text-neutral-700 sm:flex dark:bg-neutral-700 dark:text-neutral-200"
            aria-hidden="true"
            title={user.email ?? ''}
          >
            {initialsFromEmail(user.email ?? '?')}
          </span>
          <form action={logoutAction}>
            <button
              type="submit"
              className="rounded-md border border-black/15 px-3 py-1.5 text-sm hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1F4F6A] dark:border-white/15 dark:hover:bg-neutral-800"
            >
              Sair
            </button>
          </form>
        </div>
      ) : (
        <form action={logoutAction}>
          <button
            type="submit"
            className="rounded-md border border-black/15 px-3 py-1.5 text-sm hover:bg-neutral-50 dark:border-white/15 dark:hover:bg-neutral-800"
          >
            Sair
          </button>
        </form>
      )}
    </header>
  );
}

/**
 * Iniciais a partir de email (até 2 letras).
 * Duplicado deliberadamente entre `Sidebar` e `TopBar` para manter cada
 * ficheiro auto-contido (helpers de 8 linhas não justificam ficheiro próprio).
 */
function initialsFromEmail(email: string): string {
  if (!email) return '?';
  const local = email.split('@')[0] ?? email;
  const parts = local.split(/[.\-_+]/).filter(Boolean);
  if (parts.length === 0) return email.slice(0, 1).toUpperCase();
  if (parts.length === 1) {
    const single = parts[0] ?? '';
    return single.slice(0, 1).toUpperCase();
  }
  const first = parts[0] ?? '';
  const second = parts[1] ?? '';
  return `${first.slice(0, 1)}${second.slice(0, 1)}`.toUpperCase();
}
