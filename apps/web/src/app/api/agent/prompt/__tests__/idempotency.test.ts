// @vitest-environment node
/**
 * Testes do helper `lookupIdempotentRun` — Story 2.6 AC8 + D19.
 *
 * Cobertura:
 *   - sem header Idempotency-Key → kind='new' sem query
 *   - run terminal success → kind='replay'
 *   - run terminal failed → kind='replay'
 *   - run terminal reverted → kind='replay'
 *   - run não-terminal classifying → kind='in_progress'
 *   - run não-terminal pending_preview → kind='in_progress'
 *   - run não encontrado (janela 24h) → kind='new'
 */
import { describe, expect, it, vi } from 'vitest';

import {
  lookupIdempotentRun,
  IDEMPOTENCY_WINDOW_HOURS,
} from '@/lib/agent/idempotency';

const HOUSEHOLD = '00000000-0000-0000-0000-0000000000a1';

function makeMockDb(rows: unknown[]) {
  return {
    execute: vi.fn().mockResolvedValue(rows),
  } as unknown as Parameters<typeof lookupIdempotentRun>[2];
}

describe('lookupIdempotentRun', () => {
  it('retorna kind=new quando key undefined (sem header)', async () => {
    const db = makeMockDb([]);
    const result = await lookupIdempotentRun(undefined, HOUSEHOLD, db);
    expect(result.kind).toBe('new');
    // Não deve ter feito query
    expect((db.execute as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it('retorna kind=new quando key empty string', async () => {
    const db = makeMockDb([]);
    const result = await lookupIdempotentRun('', HOUSEHOLD, db);
    expect(result.kind).toBe('new');
    expect((db.execute as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it('retorna kind=new quando run não encontrado', async () => {
    const db = makeMockDb([]);
    const result = await lookupIdempotentRun('idem-1', HOUSEHOLD, db);
    expect(result.kind).toBe('new');
  });

  it('retorna kind=replay para run terminal success', async () => {
    const now = new Date();
    const db = makeMockDb([
      {
        id: 'run-success-1',
        status: 'success',
        response_summary: 'Done',
        tool_calls: [],
        intents_detected: [],
        confidence: '0.85',
        confirm_expires_at: null,
        created_at: now.toISOString(),
        completed_at: now.toISOString(),
        error_code: null,
        error_message: null,
      },
    ]);
    const result = await lookupIdempotentRun('idem-1', HOUSEHOLD, db);
    expect(result.kind).toBe('replay');
    if (result.kind === 'replay') {
      expect(result.run.id).toBe('run-success-1');
      expect(result.run.status).toBe('success');
      expect(result.run.responseSummary).toBe('Done');
    }
  });

  it('retorna kind=replay para run terminal failed', async () => {
    const db = makeMockDb([
      {
        id: 'run-failed-1',
        status: 'failed',
        response_summary: null,
        tool_calls: null,
        intents_detected: [],
        confidence: '0.85',
        confirm_expires_at: null,
        created_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        error_code: 'CLASSIFIER_ERROR',
        error_message: 'falhou',
      },
    ]);
    const result = await lookupIdempotentRun('idem-failed', HOUSEHOLD, db);
    expect(result.kind).toBe('replay');
    if (result.kind === 'replay') {
      expect(result.run.errorCode).toBe('CLASSIFIER_ERROR');
    }
  });

  it('retorna kind=replay para run terminal reverted', async () => {
    const db = makeMockDb([
      {
        id: 'run-reverted-1',
        status: 'reverted',
        response_summary: null,
        tool_calls: [],
        intents_detected: [],
        confidence: '0.9',
        confirm_expires_at: null,
        created_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        error_code: null,
        error_message: null,
      },
    ]);
    const result = await lookupIdempotentRun('idem-rev', HOUSEHOLD, db);
    expect(result.kind).toBe('replay');
  });

  it('retorna kind=in_progress para run não-terminal classifying', async () => {
    const db = makeMockDb([
      {
        id: 'run-classifying',
        status: 'classifying',
        response_summary: null,
        tool_calls: null,
        intents_detected: [],
        confidence: '0',
        confirm_expires_at: null,
        created_at: new Date().toISOString(),
        completed_at: null,
        error_code: null,
        error_message: null,
      },
    ]);
    const result = await lookupIdempotentRun('idem-running', HOUSEHOLD, db);
    expect(result.kind).toBe('in_progress');
  });

  it('retorna kind=in_progress para run pending_preview', async () => {
    const db = makeMockDb([
      {
        id: 'run-preview',
        status: 'pending_preview',
        response_summary: null,
        tool_calls: null,
        intents_detected: [],
        confidence: '0.5',
        confirm_expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        created_at: new Date().toISOString(),
        completed_at: null,
        error_code: null,
        error_message: null,
      },
    ]);
    const result = await lookupIdempotentRun('idem-preview', HOUSEHOLD, db);
    expect(result.kind).toBe('in_progress');
  });

  it('expõe IDEMPOTENCY_WINDOW_HOURS como constante (default 24)', () => {
    expect(IDEMPOTENCY_WINDOW_HOURS).toBe(24);
  });
});
