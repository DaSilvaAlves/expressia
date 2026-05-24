/**
 * Entry-point público do pacote `@meu-jarvis/ui` — design system shared.
 *
 * Story 5.2 — DP6 Epic 5 (criar packages/ui na 5.2) + DP-5.2.D
 * (re-export TYPE-only de `Theme`/`WidgetId`/`WidgetsEnabled` de
 * `@meu-jarvis/db` para conveniência import surface).
 *
 * Exporta:
 *   - Design tokens (cores light/dark + spacing + radius + shadows +
 *     transitions + typography) — front-end-spec §3.
 *   - Componentes UI (`<MoneyDisplay>`, `<DateDisplay>`) reutilizáveis
 *     cross-package.
 *   - Re-export de tipos `Theme`/`WidgetId`/`WidgetsEnabled` de
 *     `@meu-jarvis/db` (single source of truth preservada em
 *     `packages/db/src/schema/prefs.ts`).
 */
export * from './tokens';
export * from './components';
// DP-5.2.D — re-export TYPE-only (não runtime values). Cross-confirm dependency
// cyclical: `grep "@meu-jarvis/ui" packages/db/` = ZERO matches (limpo).
export type { Theme, WidgetId, WidgetsEnabled } from '@meu-jarvis/db';
