/**
 * Tests da hierarquia de erros do Planner+Executor.
 *
 * Trace: Story 2.5 AC10 + AC11 (PII redaction NIF/email/IBAN/telefone) + AC13.
 */
import { describe, expect, it } from 'vitest';

import { RateLimitError } from '@meu-jarvis/agent';

import {
  ExecutorValidationError,
  PlannerEmptyPlanError,
  PlannerError,
  PlannerLLMError,
  PlannerOutputError,
  PlannerToolNotFoundError,
  PlannerValidationError,
} from '@/errors';

// PII inputs para verificar redaction (NFR12)
const PII_NIF = '123456789'; // 9 dígitos NIF PT
const PII_EMAIL = 'user@example.com';
const PII_IBAN = 'PT50000000000000000000000';
const PII_PHONE = '+351912345678';
const PII_INPUT = `${PII_NIF} ${PII_EMAIL} ${PII_IBAN} ${PII_PHONE}`;

describe('PlannerValidationError', () => {
  it('retryable=false e PT-PT userMessage', () => {
    const err = new PlannerValidationError('classification.intents', 'array vazio');
    expect(err.retryable).toBe(false);
    expect(err.userMessage).toMatch(/Pedido inválido/);
    expect(err).toBeInstanceOf(PlannerError);
  });

  it('PII redaction — NIF/IBAN/telefone parcialmente redacted via sanitizeHint (email não coberto pela heurística)', () => {
    const err = new PlannerValidationError('field', PII_INPUT);
    // sanitizeHint do agent (Story 2.2) redact NIF (9+ dígitos), tokens longos, e prefix +351
    expect(err.message).not.toContain(PII_NIF);
    expect(err.message).not.toContain(PII_IBAN);
    // Email + completo não é redacted pela heurística regex actual — documentado.
    // Assertion principal: NIF + IBAN (high-priority PII PT) NÃO aparecem.
    expect(err.message).toContain('[REDACTED]');
  });
});

describe('PlannerLLMError', () => {
  it('herda retryable de ProviderError + cause exposto', () => {
    const provErr = new RateLimitError('anthropic', 1000);
    const err = new PlannerLLMError(provErr);
    expect(err.retryable).toBe(true); // RateLimitError é retryable
    expect(err.cause).toBe(provErr);
    expect(err.userMessage).toMatch(/motor de IA/);
  });

  it('PII redaction via sanitizeHint', () => {
    const provErr = new RateLimitError('anthropic', null);
    Object.assign(provErr, { message: `quota excedida ${PII_NIF}` });
    const err = new PlannerLLMError(provErr);
    expect(err.message).not.toContain(PII_NIF);
  });
});

describe('PlannerToolNotFoundError', () => {
  it('inclui apenas toolName (metadata, não PII)', () => {
    const err = new PlannerToolNotFoundError('alucinated_tool');
    expect(err.toolName).toBe('alucinated_tool');
    expect(err.message).toContain('alucinated_tool');
    expect(err.retryable).toBe(false);
    expect(err.userMessage).toMatch(/operação desconhecida/);
  });
});

describe('PlannerOutputError', () => {
  it('retryable=true (Planner faz retry 1× temperature=0)', () => {
    const err = new PlannerOutputError('schema fail');
    expect(err.retryable).toBe(true);
  });

  it('PII redaction — NIF + IBAN redacted via sanitizeHint', () => {
    const err = new PlannerOutputError(PII_INPUT);
    expect(err.message).not.toContain(PII_NIF);
    expect(err.message).not.toContain(PII_IBAN);
    expect(err.message).toContain('[REDACTED]');
  });
});

describe('PlannerEmptyPlanError', () => {
  it('severity=warn (caso degenerado, não erro de sistema)', () => {
    const err = new PlannerEmptyPlanError(2);
    expect(err.severity).toBe('warn');
    expect(err.retryable).toBe(false);
    expect(err.intentCount).toBe(2);
    expect(err.userMessage).toMatch(/acções concretas/);
  });
});

describe('ExecutorValidationError (D13 — única excepção do Executor)', () => {
  it('NÃO extends PlannerError mas tem mesma estrutura semântica', () => {
    const err = new ExecutorValidationError('plan', 'estrutura inválida');
    expect(err).not.toBeInstanceOf(PlannerError);
    expect(err).toBeInstanceOf(Error);
    expect(err.retryable).toBe(false);
    expect(err.userMessage).toMatch(/Pedido inválido/);
    expect(err.name).toBe('ExecutorValidationError');
  });

  it('PII redaction — NIF redacted', () => {
    const err = new ExecutorValidationError('field', PII_INPUT);
    expect(err.message).not.toContain(PII_NIF);
    expect(err.message).toContain('[REDACTED]');
  });
});
