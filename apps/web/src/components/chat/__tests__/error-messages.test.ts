/**
 * Tests unitários — `errorMessageFor` (mapa de códigos de erro → mensagem UX).
 *
 * Cobre os 12 códigos da tabela §3 de docs/ux/jarvis-error-ux-spec.md + o
 * fallback + a interpolação de `details`. Critérios de aceitação da spec §4:
 *   - Todos os 12 códigos cobertos
 *   - QUOTA_EXCEEDED mostra a janela mensal, não "60 segundos"
 *   - RATE_LIMIT_EXCEEDED mostra `retry_after_seconds` real
 *   - Código desconhecido → fallback genérico (nunca crash, nunca `message` cru)
 *   - Zero jargão técnico no output visível
 */
import { describe, expect, it } from 'vitest';

import { errorMessageFor } from '@/components/chat/error-messages';

describe('errorMessageFor — códigos mapeados (tabela §3)', () => {
  it('HOUSEHOLD_NOT_FOUND → fala de "agregado", nunca "Household"', () => {
    const msg = errorMessageFor('HOUSEHOLD_NOT_FOUND');
    expect(msg).toContain('agregado');
    expect(msg).not.toContain('Household');
  });

  it('VALIDATION_ERROR → pede para reformular, sem jargão "Body"', () => {
    const msg = errorMessageFor('VALIDATION_ERROR');
    expect(msg).toMatch(/não percebi/i);
    expect(msg).not.toContain('Body');
  });

  it('IDEMPOTENCY_IN_PROGRESS → pede para esperar, sem jargão "idempotente"', () => {
    const msg = errorMessageFor('IDEMPOTENCY_IN_PROGRESS');
    expect(msg).toMatch(/a ser processado/i);
    expect(msg.toLowerCase()).not.toContain('idempot');
  });

  it('RATE_LIMIT_EXCEEDED → interpola retry_after_seconds real', () => {
    expect(errorMessageFor('RATE_LIMIT_EXCEEDED', { retry_after_seconds: 42 })).toContain(
      '42 segundos',
    );
  });

  it('RATE_LIMIT_EXCEEDED sem details → fallback 60 segundos', () => {
    expect(errorMessageFor('RATE_LIMIT_EXCEEDED')).toContain('60 segundos');
  });

  it('QUOTA_EXCEEDED → mostra plano + janela mensal (NÃO "60 segundos")', () => {
    const msg = errorMessageFor('QUOTA_EXCEEDED', {
      plan: 'familia',
      period_end: '2026-06-15T12:00:00.000Z',
    });
    expect(msg).toContain('familia');
    expect(msg).toMatch(/\/06\/2026/); // mês/ano da janela — dia tolerante a timezone
    expect(msg).toContain('às');
    expect(msg).not.toContain('60 segundos');
  });

  it('QUOTA_EXCEEDED sem period_end → fallback neutro sem crash', () => {
    const msg = errorMessageFor('QUOTA_EXCEEDED', { plan: 'pessoal' });
    expect(msg).toContain('pessoal');
    expect(msg).toContain('próximo período');
  });

  it('CLASSIFIER_ERROR → mensagem amigável de reformular', () => {
    expect(errorMessageFor('CLASSIFIER_ERROR')).toMatch(/reformular/i);
  });

  it('PLANNER_ERROR → mensagem amigável sobre o plano', () => {
    expect(errorMessageFor('PLANNER_ERROR')).toMatch(/plano/i);
  });

  it('EXECUTOR_VALIDATION_ERROR → mensagem amigável de reformular', () => {
    expect(errorMessageFor('EXECUTOR_VALIDATION_ERROR')).toMatch(/reformular/i);
  });

  it('TOOL_PLAN_GATE_ERROR → ação ainda não disponível', () => {
    expect(errorMessageFor('TOOL_PLAN_GATE_ERROR')).toMatch(/ainda não está disponível/i);
  });

  it('TOOL_EXECUTION_ERROR → garante "nenhuma alteração"', () => {
    expect(errorMessageFor('TOOL_EXECUTION_ERROR')).toMatch(/nenhuma alteração/i);
  });

  it('INTERNAL_ERROR → mensagem genérica do "nosso lado"', () => {
    expect(errorMessageFor('INTERNAL_ERROR')).toMatch(/nosso lado/i);
  });
});

describe('errorMessageFor — fallback seguro', () => {
  it('código desconhecido → fallback genérico', () => {
    expect(errorMessageFor('SOME_NEW_CODE_2027')).toBe('Erro temporário. Tenta de novo.');
  });

  it('code undefined → fallback genérico', () => {
    expect(errorMessageFor(undefined)).toBe('Erro temporário. Tenta de novo.');
  });

  it('AUTH_REQUIRED → fallback (é tratado por redirect antes de chegar aqui)', () => {
    expect(errorMessageFor('AUTH_REQUIRED')).toBe('Erro temporário. Tenta de novo.');
  });
});

describe('errorMessageFor — nenhuma mensagem expõe jargão técnico', () => {
  const ALL_CODES = [
    'HOUSEHOLD_NOT_FOUND',
    'VALIDATION_ERROR',
    'IDEMPOTENCY_IN_PROGRESS',
    'RATE_LIMIT_EXCEEDED',
    'QUOTA_EXCEEDED',
    'CLASSIFIER_ERROR',
    'PLANNER_ERROR',
    'EXECUTOR_VALIDATION_ERROR',
    'TOOL_PLAN_GATE_ERROR',
    'TOOL_EXECUTION_ERROR',
    'INTERNAL_ERROR',
  ] as const;

  it.each(ALL_CODES)('%s → sem "Provider"/"openai"/"schema"/"LLM"/"stack"', (code) => {
    const msg = errorMessageFor(code, {
      retry_after_seconds: 30,
      plan: 'pro',
      period_end: '2026-06-15T12:00:00.000Z',
    });
    expect(msg).not.toMatch(/provider|openai|anthropic|schema|\bLLM\b|stack|exception/i);
  });
});
