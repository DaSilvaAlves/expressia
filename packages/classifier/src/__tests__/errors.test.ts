/**
 * Testes da taxonomia de erros + PII redaction.
 *
 * Trace: Story 2.4 AC8 + AC10 + AC11 (errors.test.ts mínimo 5 casos).
 *
 * Estratégia AC10 (PII redaction):
 *   - NIF PT (9 dígitos), email, telefone PT (+351...) NÃO podem aparecer em
 *     `.message` de NENHUMA subclasse.
 *   - `userMessage` em PT-PT, neutro de implementação.
 *   - `severity` correcto (warn para Language, error para outros).
 */
import { describe, expect, it } from 'vitest';

import { RateLimitError, ServerError } from '@meu-jarvis/agent';

import {
  ClassifierError,
  ClassifierLanguageError,
  ClassifierLLMError,
  ClassifierOutputError,
  ClassifierValidationError,
} from '@/errors';

const PII_SAMPLES = [
  '123456789', // NIF PT (9 dígitos)
  'user@example.pt', // email
  '+351912345678', // telefone PT
  'PT50000201234567890154', // IBAN PT
];

describe('ClassifierValidationError', () => {
  it('reason "empty" — NÃO inclui input.text no message', () => {
    const err = new ClassifierValidationError('empty', 0, 1000);
    expect(err.message).not.toContain('NIF');
    for (const pii of PII_SAMPLES) {
      expect(err.message).not.toContain(pii);
    }
    expect(err.userMessage).toBe('O texto está vazio. Escreve um pedido para o agente processar.');
    expect(err.retryable).toBe(false);
    expect(err.severity).toBe('error');
  });

  it('reason "too_long" — mostra LENGTH mas NÃO o conteúdo', () => {
    const err = new ClassifierValidationError('too_long', 1500, 1000);
    expect(err.message).toContain('1500');
    expect(err.message).toContain('1000');
    for (const pii of PII_SAMPLES) {
      expect(err.message).not.toContain(pii);
    }
    expect(err.userMessage).toContain('1000 caracteres');
    expect(err.retryable).toBe(false);
  });
});

describe('ClassifierLanguageError', () => {
  it('inclui detected patterns mas NÃO o input', () => {
    const err = new ClassifierLanguageError(['pt-br:voce', 'en:the']);
    expect(err.message).toContain('pt-br:voce');
    expect(err.message).toContain('en:the');
    for (const pii of PII_SAMPLES) {
      expect(err.message).not.toContain(pii);
    }
    expect(err.userMessage).toContain('português europeu');
    expect(err.retryable).toBe(false);
    expect(err.severity).toBe('warn');
  });
});

describe('ClassifierLLMError', () => {
  it('envolve ProviderError e expõe `cause` + retryable correcto', () => {
    const provider = new RateLimitError('openai', 5);
    const err = new ClassifierLLMError(provider);
    expect(err.providerCause).toBe(provider);
    expect(err.retryable).toBe(provider.retryable);
    expect(err.severity).toBe('error');
    expect((err as Error & { cause?: unknown }).cause).toBe(provider);
  });

  it('sanitiza hint do provider — NIF/IBAN/tokens longos NÃO aparecem em message', () => {
    // ProviderError com hint contendo PII — sanitizeHint deve apagar.
    const provider = new ServerError('openai', 500);
    // Mutar message simulando hint que vazou PII (sanitização é feita
    // no constructor de ClassifierLLMError ao receber providerError.message).
    Object.defineProperty(provider, 'message', {
      value: 'NIF 123456789 token abc123XYZ_DEFGHIJK falhou',
      configurable: true,
    });
    const err = new ClassifierLLMError(provider);
    // sanitizeHint redacta sequências >= 9 dígitos e tokens >= 10 alfanum.
    expect(err.message).not.toContain('123456789');
    expect(err.message).not.toContain('abc123XYZ_DEFGHIJK');
    expect(err.message).toContain('[REDACTED]');
  });

  it('userMessage neutro PT-PT — sem mencionar OpenAI/GPT', () => {
    const provider = new RateLimitError('openai', 5);
    const err = new ClassifierLLMError(provider);
    expect(err.userMessage).not.toContain('OpenAI');
    expect(err.userMessage).not.toContain('GPT');
    expect(err.userMessage).toMatch(/agente|alguns segundos/i);
  });
});

describe('ClassifierOutputError', () => {
  it('expõe Zod issue count, retryable=true, NÃO inclui raw output', () => {
    const err = new ClassifierOutputError(3);
    expect(err.zodIssueCount).toBe(3);
    expect(err.retryable).toBe(true);
    expect(err.severity).toBe('error');
    for (const pii of PII_SAMPLES) {
      expect(err.message).not.toContain(pii);
    }
    expect(err.userMessage).toContain('reformular');
  });
});

describe('ClassifierError hierarchy', () => {
  it('todas as subclasses estendem ClassifierError', () => {
    expect(new ClassifierValidationError('empty', 0, 1000)).toBeInstanceOf(ClassifierError);
    expect(new ClassifierLanguageError(['en:the'])).toBeInstanceOf(ClassifierError);
    expect(new ClassifierLLMError(new RateLimitError('openai', 5))).toBeInstanceOf(ClassifierError);
    expect(new ClassifierOutputError(1)).toBeInstanceOf(ClassifierError);
  });

  it('todas as subclasses estendem Error standard', () => {
    expect(new ClassifierValidationError('empty', 0, 1000)).toBeInstanceOf(Error);
    expect(new ClassifierLanguageError(['en:the'])).toBeInstanceOf(Error);
    expect(new ClassifierLLMError(new RateLimitError('openai', 5))).toBeInstanceOf(Error);
    expect(new ClassifierOutputError(1)).toBeInstanceOf(Error);
  });

  it('todas as subclasses têm name = nome da class', () => {
    expect(new ClassifierValidationError('empty', 0, 1000).name).toBe('ClassifierValidationError');
    expect(new ClassifierLanguageError(['en:the']).name).toBe('ClassifierLanguageError');
    expect(new ClassifierLLMError(new RateLimitError('openai', 5)).name).toBe('ClassifierLLMError');
    expect(new ClassifierOutputError(1).name).toBe('ClassifierOutputError');
  });
});
