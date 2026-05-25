'use client';

/**
 * `<HamburgerButton>` — botão hamburger do `TopBar` (Story 5.3 AC3.a).
 *
 * Sub-componente Client extraído do `TopBar` (Server) porque precisa de
 * estado/event handlers para controlar:
 *   - O `shellStore.sidebarCollapsed` em tablet (expande/colapsa icon-only)
 *   - O drawer mobile via callback `onMobileToggle` (gerido por estado local
 *     do `TopBar` wrapper Client)
 *
 * Visível apenas em viewports `<1024px` — em desktop (`lg:hidden`) é
 * ocultado por CSS porque a sidebar é fixa 240px e não precisa de toggle.
 *
 * Trace: `architecture.md §8.2 linhas 699-702` (Client onde precisar state) +
 * Story 5.3 AC3.a.
 */
import type { ReactNode } from 'react';

interface HamburgerButtonProps {
  /** Callback invocado ao clicar. Wrapper decide se toggle drawer ou sidebar. */
  onClick: () => void;
  /** Label acessível (default "Abrir menu"). */
  label?: string;
  /** `aria-expanded` para reflectir estado do menu controlado. */
  expanded?: boolean;
  children?: ReactNode;
}

export function HamburgerButton({
  onClick,
  label = 'Abrir menu',
  expanded,
  children,
}: HamburgerButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-expanded={expanded}
      className="flex h-9 w-9 items-center justify-center rounded-md text-neutral-700 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1F4F6A] lg:hidden dark:text-neutral-300 dark:hover:bg-neutral-800"
    >
      {children ?? (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="20"
          height="20"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <line x1="3" y1="6" x2="17" y2="6" />
          <line x1="3" y1="10" x2="17" y2="10" />
          <line x1="3" y1="14" x2="17" y2="14" />
        </svg>
      )}
    </button>
  );
}
