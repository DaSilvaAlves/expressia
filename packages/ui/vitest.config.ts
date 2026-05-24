/// <reference types="vitest" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * Vitest config — @meu-jarvis/ui (Story 5.2).
 *
 * Componentes React puros — testes em ambiente `jsdom` com helpers de
 * `@testing-library/react`. Setup global em `vitest.setup.ts` regista os
 * matchers de `@testing-library/jest-dom`.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
