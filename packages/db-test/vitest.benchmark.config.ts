/**
 * Vitest config dedicada aos tests do benchmark (Story 2.10) — SEM Testcontainers.
 *
 * Razão: os tests do benchmark (`src/benchmark/__tests__/*.test.ts`) são
 * puramente mockable (não tocam DB real). A config principal `vitest.config.ts`
 * arranca Postgres 16 via `globalSetup` para os tests RLS — overhead
 * desnecessário (e bloqueante quando Docker está offline) para o benchmark.
 *
 * Uso:
 *   pnpm --filter @meu-jarvis/db-test test:benchmark
 *
 * Trace: Story 2.10 T9 (quality gates) + [DEV-DECISION D63] (config split para
 *        permitir CI/gate sem Docker).
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { defineConfig } from 'vitest/config';

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/benchmark/__tests__/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'src/tests/**'],
    // Sem globalSetup — benchmark tests não precisam de Postgres.
    testTimeout: 10_000,
    hookTimeout: 10_000,
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    passWithNoTests: false,
  },
});
