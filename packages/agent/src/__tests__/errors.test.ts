import { describe, expect, it } from 'vitest';

import {
  AuthError,
  BadRequestError,
  CircuitOpenError,
  ContentPolicyError,
  MissingApiKeyError,
  NetworkError,
  ProviderError,
  RateLimitError,
  ServerError,
  TimeoutError,
  mapAnthropicError,
  mapOpenAIError,
} from '@/errors';

describe('ProviderError hierarchy', () => {
  it('todas as 9 classes herdam de ProviderError', () => {
    const errors: ProviderError[] = [
      new RateLimitError('anthropic', 1000),
      new TimeoutError('anthropic', 30000),
      new ServerError('anthropic', 503),
      new NetworkError('anthropic', new Error('econnreset')),
      new AuthError('anthropic', 401),
      new BadRequestError('anthropic', 400, 'invalid'),
      new ContentPolicyError('anthropic', 'reason'),
      new MissingApiKeyError('anthropic'),
      new CircuitOpenError('anthropic', 30000),
    ];
    for (const err of errors) {
      expect(err).toBeInstanceOf(ProviderError);
      expect(err).toBeInstanceOf(Error);
      expect(err.providerId).toBe('anthropic');
      expect(typeof err.userMessage).toBe('string');
      expect(err.userMessage.length).toBeGreaterThan(0);
    }
  });

  it('errors retryable: RateLimit, Timeout, Server, Network', () => {
    expect(new RateLimitError('anthropic').retryable).toBe(true);
    expect(new TimeoutError('anthropic', 1000).retryable).toBe(true);
    expect(new ServerError('anthropic', 503).retryable).toBe(true);
    expect(new NetworkError('anthropic', new Error()).retryable).toBe(true);
  });

  it('errors non-retryable: Auth, BadRequest, ContentPolicy, MissingKey, CircuitOpen', () => {
    expect(new AuthError('anthropic', 401).retryable).toBe(false);
    expect(new BadRequestError('anthropic', 400, 'x').retryable).toBe(false);
    expect(new ContentPolicyError('anthropic', 'x').retryable).toBe(false);
    expect(new MissingApiKeyError('anthropic').retryable).toBe(false);
    expect(new CircuitOpenError('anthropic', 1000).retryable).toBe(false);
  });

  it('userMessage está em PT-PT (vocabulário marcador)', () => {
    expect(new RateLimitError('anthropic').userMessage).toMatch(/serviço/);
    expect(new TimeoutError('openai', 1000).userMessage).toMatch(/serviço/);
    expect(new MissingApiKeyError('anthropic').userMessage).toMatch(/configurado|configurada|suporte/);
  });

  it('serialização não vaza prompt content em message', () => {
    // Simula um erro de uma SDK que pode incluir payload original; o nosso
    // mapping limita-se ao status + hint sanitizado.
    const fakeSdkError = {
      status: 400,
      headers: {},
      message: 'invalid_request_error: prompt contains nif 123456789 token-like-secret-12345',
    };
    const mapped = mapAnthropicError(fakeSdkError);
    expect(mapped).toBeInstanceOf(BadRequestError);
    const serialized = JSON.stringify({ name: mapped.name, message: mapped.message, userMessage: mapped.userMessage });
    expect(serialized).not.toContain('123456789');
    expect(serialized).not.toContain('token-like-secret-12345');
    expect(serialized).toContain('[REDACTED]');
  });

  it('preserva stack trace', () => {
    const err = new ServerError('anthropic', 503);
    expect(err.stack).toBeDefined();
    expect(err.stack).toContain('ServerError');
  });
});

describe('mapAnthropicError', () => {
  it('passes through ProviderError instances', () => {
    const original = new AuthError('anthropic', 401);
    expect(mapAnthropicError(original)).toBe(original);
  });

  it('mapeia 401/403 para AuthError', () => {
    expect(mapAnthropicError({ status: 401 })).toBeInstanceOf(AuthError);
    expect(mapAnthropicError({ status: 403 })).toBeInstanceOf(AuthError);
  });

  it('mapeia 429 para RateLimitError com retry-after parseado', () => {
    const err = mapAnthropicError({ status: 429, headers: { 'retry-after': '5' } });
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).retryAfterMs).toBe(5000);
  });

  it('mapeia 429 sem retry-after para retryAfterMs null', () => {
    const err = mapAnthropicError({ status: 429, headers: {} });
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).retryAfterMs).toBeNull();
  });

  it('mapeia 5xx para ServerError', () => {
    expect(mapAnthropicError({ status: 503 })).toBeInstanceOf(ServerError);
    expect(mapAnthropicError({ status: 500 })).toBeInstanceOf(ServerError);
  });

  it('mapeia 400 com keyword "policy" para ContentPolicyError', () => {
    const err = mapAnthropicError({ status: 400, message: 'safety policy violation' });
    expect(err).toBeInstanceOf(ContentPolicyError);
  });

  it('mapeia 400 normal para BadRequestError', () => {
    const err = mapAnthropicError({ status: 400, message: 'invalid model name' });
    expect(err).toBeInstanceOf(BadRequestError);
  });

  it('mapeia AbortError para TimeoutError', () => {
    const err = mapAnthropicError({ name: 'AbortError', message: 'aborted' });
    expect(err).toBeInstanceOf(TimeoutError);
  });

  it('default → NetworkError', () => {
    const err = mapAnthropicError({ message: 'unknown failure' });
    expect(err).toBeInstanceOf(NetworkError);
  });
});

describe('mapOpenAIError', () => {
  it('mapeia 429 com retry-after', () => {
    const err = mapOpenAIError({ status: 429, headers: { 'retry-after': '3' } });
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).retryAfterMs).toBe(3000);
  });

  it('mapeia content_policy code para ContentPolicyError', () => {
    const err = mapOpenAIError({ status: 400, code: 'content_policy_violation', message: 'flagged' });
    expect(err).toBeInstanceOf(ContentPolicyError);
  });

  it('mapeia request_timeout code para TimeoutError', () => {
    const err = mapOpenAIError({ code: 'request_timeout', message: 'timed out' });
    expect(err).toBeInstanceOf(TimeoutError);
  });

  it('mapeia 500 para ServerError', () => {
    expect(mapOpenAIError({ status: 500 })).toBeInstanceOf(ServerError);
  });
});
