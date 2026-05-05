/**
 * Vitest config — @meu-jarvis/db-test
 *
 * Estratégia de performance (Story 1.4 AC7 — < 60s em CI):
 *   - Um único container Postgres 16 partilhado por toda a suite via `globalSetup`.
 *   - Cada ficheiro de teste recebe a connection string via env var injectada.
 *   - `beforeEach` nos testes faz truncate das tabelas relevantes em ordem topológica
 *     para isolamento sem custo de subir container novo.
 *
 * Trace: Architecture §10.1 (Vitest + Testcontainers), Architecture §10.2 (RLS test pattern).
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
    include: ['src/**/*.{test,spec}.ts', 'src/tests/**/*.rls.test.ts'],
    exclude: ['node_modules', 'dist'],
    /** Container Postgres 16 partilhado por toda a suite. */
    globalSetup: ['./src/setup/global-setup.ts'],
    /**
     * Timeouts amplos: Testcontainers pode demorar até 30s a fazer pull/start
     * na primeira execução. Após cache, < 5s.
     */
    testTimeout: 30_000,
    hookTimeout: 60_000,
    /**
     * Threads: forçar single-thread evita race conditions com o container partilhado.
     * Cada ficheiro corre sequencialmente; dentro do ficheiro os testes correm em ordem.
     */
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    passWithNoTests: false,
  },
});
