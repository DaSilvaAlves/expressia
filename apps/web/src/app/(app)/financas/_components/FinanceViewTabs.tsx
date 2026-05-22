import Link from 'next/link';

/**
 * `<FinanceViewTabs>` — navegação entre as 5 vistas do Módulo Finanças
 * (Story 4.6 AC1, D-4.6.8).
 *
 * As páginas `variaveis`/`recorrentes`/`cartoes`/`patrimonio` só existem a
 * partir das Stories 4.7-4.9 — até lá são renderizadas como `<span>`
 * desactivados (linkar para rotas inexistentes daria 404). Cada story futura
 * converte o seu placeholder em `<Link>` ao entregar a página.
 *
 * Trace: Story 4.6 AC1, D-4.6.8, architecture.md:670-675.
 */
export type FinanceView = 'este-mes' | 'variaveis' | 'recorrentes' | 'cartoes' | 'patrimonio';

interface TabDef {
  readonly view: FinanceView;
  readonly label: string;
  /** `null` enquanto a página não existe (Stories 4.7-4.9). */
  readonly href: string | null;
}

const TABS: readonly TabDef[] = [
  { view: 'este-mes', label: 'Este mês', href: '/financas/este-mes' },
  { view: 'variaveis', label: 'Variáveis', href: null },
  { view: 'recorrentes', label: 'Recorrentes', href: null },
  { view: 'cartoes', label: 'Cartões', href: null },
  { view: 'patrimonio', label: 'Património', href: null },
];

const ACTIVE_CLASS =
  'border-b-2 border-blue-600 px-4 py-2 text-sm font-medium text-blue-600';
const INACTIVE_CLASS =
  'px-4 py-2 text-sm text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100';
const DISABLED_CLASS =
  'cursor-not-allowed px-4 py-2 text-sm text-neutral-400 dark:text-neutral-600';

export interface FinanceViewTabsProps {
  readonly current: FinanceView;
}

export function FinanceViewTabs({ current }: FinanceViewTabsProps): React.ReactElement {
  return (
    <nav
      className="flex gap-1 border-b border-black/10 dark:border-white/10"
      aria-label="Vistas de finanças"
    >
      {TABS.map((tab) => {
        if (tab.href === null) {
          return (
            <span
              key={tab.view}
              title="Disponível na próxima versão"
              className={DISABLED_CLASS}
            >
              {tab.label}
            </span>
          );
        }
        const isActive = tab.view === current;
        return (
          <Link
            key={tab.view}
            href={tab.href}
            aria-current={isActive ? 'page' : undefined}
            className={isActive ? ACTIVE_CLASS : INACTIVE_CLASS}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
