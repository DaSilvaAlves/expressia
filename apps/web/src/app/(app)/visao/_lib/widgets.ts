/**
 * Constantes locais dos widgets da Visão (Story 5.6 — PO-FIX-2, AC3.a).
 *
 * **Porquê redeclarar `DEFAULT_WIDGETS_ENABLED` aqui (PO-FIX-2):**
 * `packages/db/src/index.ts` faz `export * from './client'`, e importar o
 * cliente DB em apps/web parte a resolução de `@/schema` no tsc (é a razão de
 * existir `@/lib/agent/db-shim`). Em apps/web só são seguros **imports de tipo**
 * de `@meu-jarvis/db` — nunca imports de valor (precedente `preferences.ts:18`).
 * Logo, em vez de `import { DEFAULT_WIDGETS_ENABLED } from '@meu-jarvis/db'`
 * (valor — quebraria o build), redeclaramos a const localmente.
 *
 * Para evitar drift silencioso, um **parity guard** (igual ao precedente
 * `preferences.ts:56-63`) garante em compile-time que o tipo da const local é
 * exactamente `WidgetsEnabled` (single source of truth: schema da DB).
 *
 * Trace: Story 5.6 AC3.a; PO-FIX-2; `packages/db/src/schema/prefs.ts:69`
 * (5 ON / 2 OFF — match byte-a-byte).
 */
import type { WidgetId, WidgetsEnabled } from '@meu-jarvis/db';

/**
 * Default JSONB de `user_prefs.widgets_enabled` — espelho local de
 * `prefs.ts:69` (PO-FIX-2). Usado como fallback quando a row de prefs do
 * utilizador não existe ou o JSONB é inválido.
 *
 * 5 default ON  : briefing, tasks_today, finance_month, recurrences_next, tasks_overdue
 * 2 default OFF : accounts_balance, calendar_week
 */
export const DEFAULT_WIDGETS_ENABLED: WidgetsEnabled = {
  briefing: true,
  tasks_today: true,
  finance_month: true,
  recurrences_next: true,
  tasks_overdue: true,
  accounts_balance: false,
  calendar_week: false,
};

/**
 * Parity guard (compile-time) — falha o `typecheck` se a const local divergir
 * do tipo `WidgetsEnabled` (chaves a mais/a menos, tipos errados). Precedente:
 * `apps/web/src/lib/api-schemas/preferences.ts:56-63`.
 */
type _DefaultWidgetsParity = typeof DEFAULT_WIDGETS_ENABLED extends WidgetsEnabled
  ? WidgetsEnabled extends typeof DEFAULT_WIDGETS_ENABLED
    ? true
    : false
  : false;
const _defaultWidgetsParity: _DefaultWidgetsParity = true;
void _defaultWidgetsParity;

/**
 * Ordem canónica de render dos widgets (AC3.a) — front-end-spec §5.4 wireframe
 * l.499-523. O `<WidgetGrid>` renderiza apenas os que estão `true` em
 * `widgets_enabled`, preservando esta ordem.
 */
export const WIDGET_ORDER: readonly WidgetId[] = [
  'briefing',
  'tasks_today',
  'finance_month',
  'recurrences_next',
  'tasks_overdue',
  'accounts_balance',
  'calendar_week',
] as const;
