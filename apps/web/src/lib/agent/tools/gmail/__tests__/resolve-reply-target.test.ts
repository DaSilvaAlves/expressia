// @vitest-environment node
/**
 * Testes do mecanismo de resolução do email-alvo (Story J-8 AC5 + AC13 + AC14).
 *
 * Cobre: `parseEmailAddress` (Nome <email> e endereço nu); `resolveReplyCandidates`
 * constrói a shortlist a partir de mocks da Gmail API (metadados + threadId +
 * Message-ID + fromEmail parseado); zero-match (inbox vazio) devolve `[]`;
 * candidatos incompletos (sem threadId/messageId/fromEmail) são descartados
 * (nunca se inventa nada).
 *
 * Mocka `@/lib/google/oauth` (refreshAccessToken) e injecta `fetchImpl`.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/google/oauth', () => ({
  refreshAccessToken: vi.fn(async () => ({ accessToken: 'tok', expiry: new Date() })),
}));

import type { ToolExecutionContext } from '@meu-jarvis/tools';

import {
  extractExplicitEmailAddresses,
  parseEmailAddress,
  resolveReplyCandidates,
} from '@/lib/agent/tools/gmail/resolve-reply-target';

const TOKEN_ROW = {
  encrypted_refresh_token: 'enc',
  token_iv: 'iv',
  token_auth_tag: 'tag',
};

function makeCtx(): ToolExecutionContext {
  return {
    householdId: '00000000-0000-0000-0000-0000000000a1',
    userId: '00000000-0000-0000-0000-000000000001',
    db: { execute: vi.fn().mockResolvedValue([TOKEN_ROW]), insert: vi.fn(), transaction: vi.fn() },
    traceId: 'trace-1',
    runId: 'run-1',
  } as unknown as ToolExecutionContext;
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

/** Detalhe de mensagem mockado com threadId + headers. */
function messageDetail(args: {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  messageId: string;
  date?: string;
}): unknown {
  return {
    id: args.id,
    threadId: args.threadId,
    snippet: 'snippet',
    payload: {
      headers: [
        { name: 'Subject', value: args.subject },
        { name: 'From', value: args.from },
        { name: 'Date', value: args.date ?? 'Wed, 02 Jul 2026 10:00:00 +0100' },
        { name: 'Message-ID', value: args.messageId },
      ],
    },
  };
}

describe('parseEmailAddress', () => {
  it('extrai o endereço entre <...>', () => {
    expect(parseEmailAddress('Pedro Silva <pedro@x.pt>')).toBe('pedro@x.pt');
  });

  it('devolve o endereço nu tal-e-qual', () => {
    expect(parseEmailAddress('pedro@x.pt')).toBe('pedro@x.pt');
  });

  it('devolve string vazia quando não há "@" plausível', () => {
    expect(parseEmailAddress('Sem Email')).toBe('');
  });
});

describe('resolveReplyCandidates', () => {
  it('constrói a shortlist (threadId + messageId + fromEmail parseado + subject)', async () => {
    const fetchImpl = vi
      .fn()
      // 1) list inbox
      .mockResolvedValueOnce(jsonResponse({ messages: [{ id: 'm1' }, { id: 'm2' }] }))
      // 2) detail m1
      .mockResolvedValueOnce(
        jsonResponse(
          messageDetail({
            id: 'm1',
            threadId: 'thr-1',
            from: 'Pedro Silva <pedro@x.pt>',
            subject: 'Jantar',
            messageId: '<a@mail>',
          }),
        ),
      )
      // 3) detail m2
      .mockResolvedValueOnce(
        jsonResponse(
          messageDetail({
            id: 'm2',
            threadId: 'thr-2',
            from: 'ana@y.pt',
            subject: 'Reunião',
            messageId: '<b@mail>',
          }),
        ),
      );

    const out = await resolveReplyCandidates(makeCtx(), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      threadId: 'thr-1',
      messageId: '<a@mail>',
      from: 'Pedro Silva <pedro@x.pt>',
      fromEmail: 'pedro@x.pt',
      subject: 'Jantar',
    });
    expect(out[1]).toMatchObject({ threadId: 'thr-2', fromEmail: 'ana@y.pt' });

    // Pediu Message-ID nos metadataHeaders (novo na J-8).
    const detailUrl = String(fetchImpl.mock.calls[1]![0]);
    expect(detailUrl).toContain('metadataHeaders=Message-ID');
    // Query in:inbox SEM is:unread (uma resposta pode ser a um email já lido).
    const listUrl = String(fetchImpl.mock.calls[0]![0]);
    expect(listUrl).toContain('in%3Ainbox');
    expect(listUrl).not.toContain('is%3Aunread');
  });

  it('zero-match: inbox vazio → [] (AC13 — nunca inventa threadId)', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse({ messages: [] }));
    const out = await resolveReplyCandidates(makeCtx(), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(out).toEqual([]);
  });

  it('descarta candidatos sem threadId/messageId/fromEmail (nunca inventa)', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ messages: [{ id: 'm1' }] }))
      // sem Message-ID e sem threadId → candidato incompleto
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'm1',
          snippet: 's',
          payload: { headers: [{ name: 'From', value: 'x@y.pt' }, { name: 'Subject', value: 'S' }] },
        }),
      );

    const out = await resolveReplyCandidates(makeCtx(), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(out).toEqual([]);
  });

  it('lança se a Gmail API recusar listar o inbox (caller degrada)', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(null, 403));
    await expect(
      resolveReplyCandidates(makeCtx(), { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow();
  });
});

describe('extractExplicitEmailAddresses (Story J-8 FIX — guardrail email explícito)', () => {
  it('email nu (só o endereço)', () => {
    expect(extractExplicitEmailAddresses('euricojoseia@gmail.com')).toEqual([
      'euricojoseia@gmail.com',
    ]);
  });

  it('email dentro de uma frase', () => {
    expect(
      extractExplicitEmailAddresses(
        'responde ao euricojoseia@gmail.com que confirmo a presença',
      ),
    ).toEqual(['euricojoseia@gmail.com']);
  });

  it('email com pontuação de fim de frase agarrada (ponto/vírgula)', () => {
    expect(extractExplicitEmailAddresses('responde a euricojoseia@gmail.com.')).toEqual([
      'euricojoseia@gmail.com',
    ]);
    expect(extractExplicitEmailAddresses('responde a a@b.pt, por favor')).toEqual(['a@b.pt']);
  });

  it('email entre <> ou parênteses (bordos limpos)', () => {
    expect(extractExplicitEmailAddresses('responde a <a@x.com>')).toEqual(['a@x.com']);
    expect(extractExplicitEmailAddresses('(pedro@example.com)')).toEqual(['pedro@example.com']);
  });

  it('múltiplos endereços (ordem preservada, duplicados removidos)', () => {
    expect(
      extractExplicitEmailAddresses('manda a a@x.com e a B@X.com e outra vez a@x.com'),
    ).toEqual(['a@x.com', 'b@x.com']);
  });

  it('normaliza para minúsculas (comparação case-insensitive)', () => {
    expect(extractExplicitEmailAddresses('Eurico@Gmail.COM')).toEqual(['eurico@gmail.com']);
  });

  it('sem email explícito (referência por nome) devolve []', () => {
    expect(extractExplicitEmailAddresses('responde ao Pedro a dizer que sim')).toEqual([]);
    expect(extractExplicitEmailAddresses('')).toEqual([]);
    expect(extractExplicitEmailAddresses('sem arroba nem dominio aqui')).toEqual([]);
  });
});
