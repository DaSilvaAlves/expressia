'use client';

/**
 * `<BreadcrumbLabel>` — label da secção raiz do `TopBar` (Story 5.3 AC3.b).
 *
 * Sub-componente Client isolado dentro do `TopBar` (Server) — apenas precisa
 * de Client por causa de `usePathname()`. Mantém o resto do `TopBar` em SSR.
 *
 * D-5.3.2 (KISS): apenas label-pai. Sub-rotas (ex: `/tarefas/kanban`) mostram
 * "Tarefas" — sem "Tarefas › Kanban". Quando o `<ChatPanel>` real chegar
 * em Story 5.4 podem refinar (ou Story 5.10 sweep responsive).
 *
 * Trace: Story 5.3 AC3.b.
 */
import { usePathname } from 'next/navigation';

export function labelFromPathname(pathname: string): string {
  if (pathname === '/visao' || pathname.startsWith('/visao/')) return 'Visão';
  if (pathname === '/jarvis' || pathname.startsWith('/jarvis/')) return 'Chat';
  if (pathname === '/tarefas' || pathname.startsWith('/tarefas/')) return 'Tarefas';
  if (pathname === '/financas' || pathname.startsWith('/financas/')) return 'Finanças';
  if (pathname === '/conta' || pathname.startsWith('/conta/')) return 'Conta';
  return 'Expressia';
}

export function BreadcrumbLabel() {
  const pathname = usePathname();
  const label = labelFromPathname(pathname ?? '');
  return (
    <h1 className="truncate text-base font-medium text-neutral-900 dark:text-neutral-100">
      {label}
    </h1>
  );
}
