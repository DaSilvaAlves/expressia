import { describe, expect, it } from 'vitest';

/**
 * Smoke test — verifica apenas que o runner Vitest está configurado correctamente.
 * Stories futuras adicionam testes reais para cada feature.
 */
describe('vitest setup', () => {
  it('runs without configuration errors', () => {
    expect(1 + 1).toBe(2);
  });
});
