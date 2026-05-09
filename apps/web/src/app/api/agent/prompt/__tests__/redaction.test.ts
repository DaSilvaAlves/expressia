// @vitest-environment node
/**
 * Testes do helper PII redaction — Story 2.6 AC11 + D25.
 *
 * Cobertura D25 opção (b) — implementação local cobre gap NIT-002-NB
 * do gate Story 2.5 (`sanitizeHint` não cobre email/telefone PT).
 */
import { describe, expect, it } from 'vitest';

import {
  hashPrompt,
  redactPiiText,
  redactEndpointInput,
  redactEndpointOutput,
  sentrySafeContext,
} from '@/lib/agent/redaction';

describe('hashPrompt', () => {
  it('produz hash hex SHA-256 (64 chars)', () => {
    const h = hashPrompt('teste prompt');
    expect(h).toMatch(/^[a-f0-9]{64}$/);
  });

  it('determinístico: mesmo input → mesmo hash', () => {
    const h1 = hashPrompt('prompt');
    const h2 = hashPrompt('prompt');
    expect(h1).toBe(h2);
  });

  it('diferentes inputs → hashes diferentes', () => {
    expect(hashPrompt('a')).not.toBe(hashPrompt('b'));
  });
});

describe('redactPiiText', () => {
  it('redacta email simples', () => {
    expect(redactPiiText('contacta-me em joao@expressia.pt obrigado')).toContain('[EMAIL_REDACTED]');
    expect(redactPiiText('contacta-me em joao@expressia.pt')).not.toContain('joao@expressia.pt');
  });

  it('redacta telefone PT (9 dígitos começando por 9)', () => {
    expect(redactPiiText('liga 912345678')).toContain('[PHONE_REDACTED]');
  });

  it('redacta telefone PT com prefixo +351', () => {
    expect(redactPiiText('liga +351 912345678')).toContain('[PHONE_REDACTED]');
  });

  it('redacta NIF (9 dígitos isolados, não começa por 9)', () => {
    expect(redactPiiText('NIF 123456789 do cliente')).toContain('[NIF_REDACTED]');
  });

  it('redacta IBAN PT', () => {
    const text = 'IBAN PT50 0033 0000 4567 8901 2345 6';
    const out = redactPiiText(text);
    expect(out).toContain('[IBAN_REDACTED]');
    expect(out).not.toContain('PT50 0033');
  });

  it('redacta cartão de crédito (16 dígitos com espaços)', () => {
    expect(redactPiiText('cartão 4111 1111 1111 1111 visa')).toContain('[CARD_REDACTED]');
  });

  it('idempotente: aplicar duas vezes não mudo', () => {
    const once = redactPiiText('email joao@x.pt');
    const twice = redactPiiText(once);
    expect(once).toBe(twice);
  });

  it('preserva texto sem PII', () => {
    expect(redactPiiText('olá mundo, criar tarefa para amanhã')).toBe(
      'olá mundo, criar tarefa para amanhã',
    );
  });

  it('lida com string vazia', () => {
    expect(redactPiiText('')).toBe('');
  });

  it('lida com null/undefined gracefully (passa through)', () => {
    // @ts-expect-error - testar input não-string defensivo
    expect(redactPiiText(null)).toBe(null);
    // @ts-expect-error - testar input não-string defensivo
    expect(redactPiiText(undefined)).toBe(undefined);
  });
});

describe('redactEndpointInput', () => {
  it('retorna apenas hash (nunca texto claro)', () => {
    const result = redactEndpointInput('email joao@expressia.pt');
    expect(result.promptHash).toMatch(/^[a-f0-9]{64}$/);
    // Garantir que `prompt` não é exposto no shape RedactedInput
    const asAny = result as unknown as { prompt?: string };
    expect(asAny.prompt).toBeUndefined();
  });
});

describe('redactEndpointOutput', () => {
  it('redacta strings em objects', () => {
    const input = { summary: 'criei task com email joao@x.pt', count: 1 };
    const out = redactEndpointOutput(input);
    expect(out.summary).toContain('[EMAIL_REDACTED]');
    expect(out.count).toBe(1);
  });

  it('redacta recursivamente em nested objects', () => {
    const input = {
      results: [{ output: { email: 'leak@test.pt' }, name: 'task1' }],
    };
    const out = redactEndpointOutput(input);
    expect(JSON.stringify(out)).toContain('[EMAIL_REDACTED]');
    expect(JSON.stringify(out)).not.toContain('leak@test.pt');
  });

  it('preserva arrays', () => {
    const input = ['plain text', 'email a@b.pt', 42];
    const out = redactEndpointOutput(input);
    expect(out[0]).toBe('plain text');
    expect(out[1]).toContain('[EMAIL_REDACTED]');
    expect(out[2]).toBe(42);
  });

  it('preserva null/undefined/booleans', () => {
    expect(redactEndpointOutput(null)).toBeNull();
    expect(redactEndpointOutput(undefined)).toBeUndefined();
    expect(redactEndpointOutput(true)).toBe(true);
    expect(redactEndpointOutput(false)).toBe(false);
  });

  it('não modifica o input original (deep clone)', () => {
    const input = { x: 'email a@b.pt' };
    const out = redactEndpointOutput(input);
    expect(input.x).toBe('email a@b.pt'); // original intacto
    expect(out.x).toContain('[EMAIL_REDACTED]');
  });
});

describe('sentrySafeContext', () => {
  it('inclui piiRedacted: true sempre', () => {
    const ctx = sentrySafeContext({ route: '/api/agent/prompt' });
    expect(ctx.piiRedacted).toBe(true);
    expect(ctx.route).toBe('/api/agent/prompt');
  });

  it('inclui householdId e runId quando fornecidos', () => {
    const ctx = sentrySafeContext({
      route: '/api/agent/prompt',
      householdId: 'h-1',
      runId: 'r-1',
    });
    expect(ctx.householdId).toBe('h-1');
    expect(ctx.runId).toBe('r-1');
  });

  it('omite campos quando undefined', () => {
    const ctx = sentrySafeContext({ route: '/x' });
    expect(ctx).not.toHaveProperty('householdId');
    expect(ctx).not.toHaveProperty('runId');
  });
});
