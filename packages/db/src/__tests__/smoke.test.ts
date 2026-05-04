import { describe, expect, it } from 'vitest';

/**
 * Smoke test — verifica apenas que o runner Vitest está configurado correctamente
 * para o package @meu-jarvis/db. Testes reais de schema/RLS chegam em stories futuras.
 */
describe('@meu-jarvis/db vitest setup', () => {
  it('runs without configuration errors', () => {
    expect(true).toBe(true);
  });
});
