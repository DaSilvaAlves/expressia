/**
 * Entry-point público do pacote `@meu-jarvis/db`.
 *
 * Exporta:
 *   - Cliente Drizzle (`getDb`, `getServiceDb`, `setHouseholdContext`)
 *   - Schema completo (tabelas + enums + relations)
 *   - Tipos partilhados
 */
// Story 2.6 fix: relative imports cross-package compat (D16 directive 2.5)
export * from './client';
export * from './schema';
export * from './types';
