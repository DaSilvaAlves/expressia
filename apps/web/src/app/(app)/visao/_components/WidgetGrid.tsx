import type * as React from 'react';
import { Suspense } from 'react';

import type { WidgetId, WidgetsEnabled } from '@meu-jarvis/db';

import { WIDGET_ORDER } from '@/app/(app)/visao/_lib/widgets';
import { WidgetSkeleton } from '@/app/(app)/visao/_components/WidgetSkeleton';
import { WidgetSlot } from '@/app/(app)/visao/_components/WidgetSlot';
import { BriefingWidget } from '@/app/(app)/visao/_components/widgets/BriefingWidget';
import { TasksTodayWidget } from '@/app/(app)/visao/_components/widgets/TasksTodayWidget';
import { FinanceMonthWidget } from '@/app/(app)/visao/_components/widgets/FinanceMonthWidget';
import { RecurrencesNextWidget } from '@/app/(app)/visao/_components/widgets/RecurrencesNextWidget';
import { TasksOverdueWidget } from '@/app/(app)/visao/_components/widgets/TasksOverdueWidget';
import { AccountsBalanceWidget } from '@/app/(app)/visao/_components/widgets/AccountsBalanceWidget';
import { CalendarWeekWidget } from '@/app/(app)/visao/_components/widgets/CalendarWeekWidget';

/**
 * `<WidgetGrid>` — grid responsivo dos widgets activos da Visão (Story 5.6 AC3,
 * AC6, AC8).
 *
 * - Renderiza **apenas** os widgets cujo valor em `widgetsEnabled` é `true`,
 *   na ordem canónica `WIDGET_ORDER` (AC3.a).
 * - Grid Tailwind `grid-cols-1 md:grid-cols-2 lg:grid-cols-3` (AC3.b / AC8.a).
 * - Cada widget num `<Suspense>` próprio com `<WidgetSkeleton>` independente —
 *   um widget lento não bloqueia os outros (AC6).
 * - **Mobile "tasks_today primeiro" (AC3.c / DP-5.6.F = CSS `order-*`):** o
 *   item `tasks_today` recebe `order-first md:order-none`, flutuando para o
 *   topo apenas na vista de 1 coluna (mobile); em tablet/desktop volta à ordem
 *   canónica do source. Escolha de CSS `order` (vs reordenação condicional):
 *   mantém uma única fonte de verdade da ordem (`WIDGET_ORDER`), sem ramos no
 *   JSX nem risco de divergência DOM/visual, e é acessível (a ordem de leitura
 *   do DOM permanece canónica; só a ordem visual flexbox muda — aceitável para
 *   um teaser/dashboard, WCAG 1.3.2 mantido porque a ordem de tab segue o DOM).
 *
 * Trace: Story 5.6 AC3, AC6, AC8; DP-5.6.F.
 */
export interface WidgetGridProps {
  readonly widgetsEnabled: WidgetsEnabled;
  /** SEC-1 — household_id app-enforced, propagado a cada widget de conteúdo. */
  readonly householdId: string;
  /**
   * SEC-6 — userId, necessário para `withHousehold` (claims JWT `sub`). Propagado
   * a cada widget de conteúdo a par do `householdId` (a RLS de runtime exige ambos).
   */
  readonly userId: string;
}

/**
 * Props comuns dos widgets de conteúdo. O `briefing` é estático (ignora ambos),
 * mas aceita-os por uniformidade do mapa.
 */
interface WidgetProps {
  readonly householdId: string;
  readonly userId: string;
}

/** Mapa `WidgetId` → componente RSC. */
const WIDGET_COMPONENTS: Record<
  WidgetId,
  (props: WidgetProps) => React.ReactElement | Promise<React.ReactElement | null>
> = {
  briefing: BriefingWidget,
  tasks_today: TasksTodayWidget,
  finance_month: FinanceMonthWidget,
  recurrences_next: RecurrencesNextWidget,
  tasks_overdue: TasksOverdueWidget,
  accounts_balance: AccountsBalanceWidget,
  calendar_week: CalendarWeekWidget,
};

export function WidgetGrid({
  widgetsEnabled,
  householdId,
  userId,
}: WidgetGridProps): React.ReactElement {
  const enabledIds = WIDGET_ORDER.filter((id) => widgetsEnabled[id]);

  return (
    <div
      className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3"
      data-testid="widget-grid"
    >
      {enabledIds.map((id) => {
        const Widget = WIDGET_COMPONENTS[id];
        // DP-5.6.F — `tasks_today` flutua para o topo só em mobile (1 coluna).
        const orderClass = id === 'tasks_today' ? 'order-first md:order-none' : '';
        // Story 5.7 — `<WidgetSlot>` (Client) injecta o `×` (remover) e esconde
        // optimisticamente; mantém `data-widget` + `orderClass` da Story 5.6.
        return (
          <WidgetSlot key={id} widgetId={id} orderClass={orderClass}>
            <Suspense fallback={<WidgetSkeleton />}>
              <Widget householdId={householdId} userId={userId} />
            </Suspense>
          </WidgetSlot>
        );
      })}
    </div>
  );
}
