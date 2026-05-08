/**
 * Testes unitários do logger Pino + helper `hashForCorrelation`.
 *
 * Foco: garantir que PII redaction está activa e que o hash é determinístico.
 *
 * Trace: Story 1.7 AC6.
 */
import { describe, expect, it } from 'vitest';

import { hashForCorrelation, PII_REDACT_PATHS } from '../logger';

describe('hashForCorrelation', () => {
  it('produz output determinístico para o mesmo input', () => {
    const a = hashForCorrelation('abc123');
    const b = hashForCorrelation('abc123');
    expect(a).toBe(b);
  });

  it('produz outputs distintos para inputs diferentes', () => {
    const a = hashForCorrelation('user-1');
    const b = hashForCorrelation('user-2');
    expect(a).not.toBe(b);
  });

  it('respeita o length pedido (default 16)', () => {
    expect(hashForCorrelation('x')).toHaveLength(16);
    expect(hashForCorrelation('x', 8)).toHaveLength(8);
    expect(hashForCorrelation('x', 32)).toHaveLength(32);
  });

  it('retorna [empty] para string vazia', () => {
    expect(hashForCorrelation('')).toBe('[empty]');
  });

  it('aceita números e converte para string', () => {
    const fromNumber = hashForCorrelation(42);
    const fromString = hashForCorrelation('42');
    expect(fromNumber).toBe(fromString);
  });
});

describe('PII_REDACT_PATHS', () => {
  it('inclui paths obrigatórios da NFR12', () => {
    expect(PII_REDACT_PATHS).toContain('email');
    expect(PII_REDACT_PATHS).toContain('password');
    expect(PII_REDACT_PATHS).toContain('nif');
    expect(PII_REDACT_PATHS).toContain('iban');
    expect(PII_REDACT_PATHS).toContain('prompt_text');
  });

  it('inclui paths header HTTP sensíveis', () => {
    expect(PII_REDACT_PATHS).toContain('req.headers.authorization');
    expect(PII_REDACT_PATHS).toContain('req.headers.cookie');
  });

  it('inclui glob *.email e *.password para profundidades arbitrárias', () => {
    expect(PII_REDACT_PATHS).toContain('*.email');
    expect(PII_REDACT_PATHS).toContain('*.password');
  });
});
