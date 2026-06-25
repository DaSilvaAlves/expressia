/**
 * Schema barrel — exporta todas as tabelas, enums e tipos.
 *
 * Importar como:
 *   import { tasks, transactions, householdRoleEnum } from '@meu-jarvis/db/schema';
 *
 * Story 2.6 fix: imports relativos `./` em vez de `@/schema/*` para resolver
 * cross-package quando consumido via webpack/Next.js (apps/web). Pattern
 * alinhado com 2.2/2.3/2.4 (D16 directive da 2.5).
 */
export * from './auth';
export * from './tenancy';
export * from './billing';
export * from './agent';
export * from './tasks';
export * from './finance';
export * from './audit';
export * from './prefs';
export * from './telegram';
export * from './briefing';
export * from './google-oauth';
