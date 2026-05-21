/**
 * Re-export barrel — Zod schemas centralizados Story 3.2.
 *
 * Re-use por Story 3.8 (tools cérebro consomem mesmos schemas).
 */
export * from './pagination';
export * from './tasks';
export * from './tags';
export * from './recurrences';
// Story 4.2 — Módulo Finanças (accounts + cards)
export * from './accounts';
export * from './cards';
// Story 4.3 — Módulo Finanças (transactions + categories)
export * from './transactions';
export * from './categories';
// Story 4.4 — Módulo Finanças (recurrences + installments)
// `finance-recurrences.ts` é distinto de `recurrences.ts` (Tarefas) — DP-4.4.2.
export * from './finance-recurrences';
export * from './installments';
