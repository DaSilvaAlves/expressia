// @vitest-environment node
/**
 * Testes de `runAgentForHousehold` — Story J-2 AC4 (pipeline desacoplado da
 * camada HTTP/Auth).
 *
 * Cobertura:
 *   - Happy path `executed` (confidence ≥ 0,70) → outcome status='executed'.
 *   - Happy path `preview` (confidence < 0,70) → outcome status='preview'.
 *   - Propagação de erros do pipeline (ClassifierError, PlannerError).
 *   - `supabase.auth.getUser()` NUNCA é chamado (spy) — a função recebe
 *     `{ userId, householdId }` directamente.
 *
 * Estratégia mockable-only (idêntica a route.test.ts): nenhum call real a
 * OpenAI/Anthropic/DB. Mock via `vi.hoisted()` + `vi.mock(...)`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  classifyMock: vi.fn(),
  plannerPlanMock: vi.fn(),
  executorExecuteMock: vi.fn(),
  dbExecuteMock: vi.fn(),
  resolveReplyCandidatesMock: vi.fn(),
}));

// Story J-8 — mecanismo de resolução do email-alvo (mockado para não tocar na
// Gmail API real). Só é chamado para o intent `responder_email`.
vi.mock('@/lib/agent/tools/gmail/resolve-reply-target', () => ({
  resolveReplyCandidates: mocks.resolveReplyCandidatesMock,
}));

// Auth mock — o spy `getUserMock` NUNCA deve ser chamado por runAgentForHousehold.
vi.mock('@meu-jarvis/auth/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: { getUser: mocks.getUserMock },
    from: vi.fn(),
  })),
}));

vi.mock('@meu-jarvis/classifier', async () => {
  const actual = (await vi.importActual('@meu-jarvis/classifier')) as Record<string, unknown>;
  return {
    ...actual,
    Classifier: vi.fn().mockImplementation(() => ({ classify: mocks.classifyMock })),
  };
});

vi.mock('@meu-jarvis/planner-executor', async () => {
  const actual = (await vi.importActual('@meu-jarvis/planner-executor')) as Record<string, unknown>;
  return {
    ...actual,
    Planner: vi.fn().mockImplementation(() => ({ plan: mocks.plannerPlanMock })),
    Executor: vi.fn().mockImplementation(() => ({ execute: mocks.executorExecuteMock })),
  };
});

vi.mock('@/lib/agent/db-shim', () => ({
  getDb: () => ({ execute: mocks.dbExecuteMock }),
  getServiceDb: () => ({ execute: mocks.dbExecuteMock }),
  withHousehold: <T,>(_auth: unknown, fn: (tx: { execute: typeof mocks.dbExecuteMock }) => Promise<T>) =>
    fn({ execute: mocks.dbExecuteMock }),
}));

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: vi.fn() } },
  })),
}));

vi.mock('@upstash/redis', () => ({
  Redis: vi.fn().mockImplementation(() => ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
  })),
}));

import { runAgentForHousehold } from '@/lib/agent/run-agent';

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const TEST_HOUSEHOLD_ID = '00000000-0000-0000-0000-0000000000a1';

/**
 * DB mock default — sequência (sem Idempotency-Key; lookupIdempotentRun não
 * toca na DB nesse caso):
 *   1. rate limit upsert → [{ count: 1 }]
 *   2. quota check → []
 *   3. INSERT agent_runs → [{ id, created_at }]
 *   4+. UPDATEs / SELECTs subsequentes → []
 */
function setupDbDefault(): void {
  let callIndex = 0;
  mocks.dbExecuteMock.mockImplementation(async () => {
    callIndex++;
    switch (callIndex) {
      case 1:
        return [{ count: 1 }]; // rate limit
      case 2:
        return []; // quota
      case 3:
        return [{ id: 'run-uuid-test', created_at: new Date().toISOString() }]; // INSERT
      default:
        return [];
    }
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setupDbDefault();
});

describe('runAgentForHousehold — happy paths', () => {
  it('AC4 — executed path (confidence ≥ 0,70) devolve status=executed kind=pipeline', async () => {
    mocks.classifyMock.mockResolvedValue({
      intents: [{ intent: 'criar_tarefa', confidence: 0.85, raw_span: 'criar tarefa' }],
      language: 'pt-PT',
      needs_confirmation: false,
      overall_confidence: 0.85,
    });
    mocks.plannerPlanMock.mockResolvedValue({
      toolCalls: [{ toolName: 'create_task', input: { title: 'X' }, intent: 'criar_tarefa' }],
      planReasoning: null,
      latencyMs: 100,
      tokensInput: 50,
      tokensOutput: 20,
      costEur: 0.0001,
      cacheHit: false,
    });
    mocks.executorExecuteMock.mockResolvedValue({
      success: true,
      results: [{ toolName: 'create_task', output: { id: 'task-1' }, reverseOpId: 'rop-1' }],
    });

    const outcome = await runAgentForHousehold({
      userId: TEST_USER_ID,
      householdId: TEST_HOUSEHOLD_ID,
      prompt: 'criar tarefa amanhã',
    });

    expect(outcome.status).toBe('executed');
    if (outcome.status === 'executed' && outcome.kind === 'pipeline') {
      expect(outcome.runId).toBe('run-uuid-test');
      expect(outcome.undoExpiresAt).toBeTruthy();
      expect(outcome.summary).toContain('1 operação');
    } else {
      throw new Error('esperado executed/pipeline');
    }
    // AC4 — auth NUNCA chamado.
    expect(mocks.getUserMock).not.toHaveBeenCalled();
  });

  it('AC4 — preview path (confidence < 0,70) devolve status=preview sem chamar Planner/Executor', async () => {
    mocks.classifyMock.mockResolvedValue({
      intents: [{ intent: 'criar_tarefa', confidence: 0.5, raw_span: 'oi' }],
      language: 'pt-PT',
      needs_confirmation: true,
      overall_confidence: 0.5,
    });

    const outcome = await runAgentForHousehold({
      userId: TEST_USER_ID,
      householdId: TEST_HOUSEHOLD_ID,
      prompt: 'fazer alguma coisa',
    });

    expect(outcome.status).toBe('preview');
    if (outcome.status === 'preview') {
      expect(outcome.confidence).toBe(0.5);
      expect(outcome.expiresAt).toBeTruthy();
      expect(Array.isArray(outcome.planSummary)).toBe(true);
    }
    expect(mocks.plannerPlanMock).not.toHaveBeenCalled();
    expect(mocks.executorExecuteMock).not.toHaveBeenCalled();
    expect(mocks.getUserMock).not.toHaveBeenCalled();
  });
});

describe('runAgentForHousehold — propagação de erros', () => {
  it('AC4 — ClassifierError é propagado (throw) com runId anexado', async () => {
    const { ClassifierValidationError } = await import('@meu-jarvis/classifier');
    mocks.classifyMock.mockRejectedValue(new ClassifierValidationError('empty', 0, 1000));

    await expect(
      runAgentForHousehold({
        userId: TEST_USER_ID,
        householdId: TEST_HOUSEHOLD_ID,
        prompt: 'qq',
      }),
    ).rejects.toMatchObject({ runId: 'run-uuid-test' });

    expect(mocks.getUserMock).not.toHaveBeenCalled();
  });

  it('AC4 — PlannerError é propagado (throw)', async () => {
    mocks.classifyMock.mockResolvedValue({
      intents: [{ intent: 'criar_tarefa', confidence: 0.85, raw_span: '' }],
      language: 'pt-PT',
      needs_confirmation: false,
      overall_confidence: 0.85,
    });
    const { PlannerValidationError } = await import('@meu-jarvis/planner-executor');
    mocks.plannerPlanMock.mockRejectedValue(
      new PlannerValidationError('input_invalid', 'shape errado'),
    );

    await expect(
      runAgentForHousehold({
        userId: TEST_USER_ID,
        householdId: TEST_HOUSEHOLD_ID,
        prompt: 'criar tarefa',
      }),
    ).rejects.toBeInstanceOf(PlannerValidationError);

    expect(mocks.getUserMock).not.toHaveBeenCalled();
  });
});

describe('runAgentForHousehold — guard multi-intent escrita externa (Story J-5 AC14 + J-7 AC9)', () => {
  it('AC14 — intents mistos (calendar + tarefa) → preview sem executar tools', async () => {
    mocks.classifyMock.mockResolvedValue({
      intents: [
        { intent: 'criar_evento_calendario', confidence: 0.9, raw_span: 'marca reunião sexta' },
        { intent: 'criar_tarefa', confidence: 0.9, raw_span: 'e regista a renda' },
      ],
      language: 'pt-PT',
      needs_confirmation: false,
      overall_confidence: 0.9,
    });

    const outcome = await runAgentForHousehold({
      userId: TEST_USER_ID,
      householdId: TEST_HOUSEHOLD_ID,
      prompt: 'marca reunião E regista a renda',
    });

    expect(outcome.status).toBe('preview');
    if (outcome.status === 'preview') {
      // Story J-7 AC9: a mensagem deixou de ser calendar-specific.
      expect(outcome.planSummary.join(' ')).toMatch(/um de cada vez/i);
      expect(outcome.planSummary.join(' ')).not.toMatch(/calend[áa]rio/i);
    }
    // Nenhuma tool executada — Planner/Executor nem chegam a correr.
    expect(mocks.plannerPlanMock).not.toHaveBeenCalled();
    expect(mocks.executorExecuteMock).not.toHaveBeenCalled();
  });

  it('AC9 (J-7) — intents mistos (enviar_email + tarefa) → preview/separação, nunca envio atómico', async () => {
    mocks.classifyMock.mockResolvedValue({
      intents: [
        { intent: 'enviar_email', confidence: 0.9, raw_span: 'manda um email à Ana' },
        { intent: 'criar_tarefa', confidence: 0.9, raw_span: 'e cria uma tarefa' },
      ],
      language: 'pt-PT',
      // Mesmo com needs_confirmation true, o guard corre ANTES do branch de
      // preview normal — devolve a mensagem de separação e não executa nada.
      needs_confirmation: true,
      overall_confidence: 0.9,
    });

    const outcome = await runAgentForHousehold({
      userId: TEST_USER_ID,
      householdId: TEST_HOUSEHOLD_ID,
      prompt: 'manda um email à Ana E cria uma tarefa',
    });

    expect(outcome.status).toBe('preview');
    if (outcome.status === 'preview') {
      expect(outcome.planSummary.join(' ')).toMatch(/um de cada vez/i);
    }
    // CRÍTICO: nenhuma tool executada — nenhum email enviado (Planner/Executor
    // nem chegam a correr).
    expect(mocks.plannerPlanMock).not.toHaveBeenCalled();
    expect(mocks.executorExecuteMock).not.toHaveBeenCalled();
  });

  it('SEND-PREVIEW-1 (J-7) — plano enviar_email mostra o RASCUNHO real (Para/Assunto/Corpo) na confirmação, não o label genérico', async () => {
    mocks.classifyMock.mockResolvedValue({
      intents: [
        { intent: 'enviar_email', confidence: 0.92, raw_span: 'manda um email ao euricojsalves@gmail.com' },
      ],
      language: 'pt-PT',
      // enviar_email força needs_confirmation (prompt v6, regra 5) → cai no branch
      // de preview ANTES do Executor. O preview deve mostrar o rascunho real.
      needs_confirmation: true,
      overall_confidence: 0.92,
    });
    // O Planner corre AGORA (no preview) para extrair o rascunho estruturado.
    mocks.plannerPlanMock.mockResolvedValue({
      toolCalls: [
        {
          toolName: 'enviar_email',
          input: {
            to: 'euricojsalves@gmail.com',
            subject: 'Reunião',
            body: 'Olá, isto é um teste do Jarvis.',
          },
          intent: 'enviar_email',
        },
      ],
      planReasoning: null,
      latencyMs: 0,
      tokensInput: 0,
      tokensOutput: 0,
      costEur: 0,
      cacheHit: false,
    });

    const outcome = await runAgentForHousehold({
      userId: TEST_USER_ID,
      householdId: TEST_HOUSEHOLD_ID,
      prompt: 'manda um email ao euricojsalves@gmail.com sobre a reunião a dizer olá',
    });

    expect(outcome.status).toBe('preview');
    if (outcome.status === 'preview') {
      const text = outcome.planSummary.join('\n');
      // Rascunho real renderizado por tool.preview() — Para/Assunto/Corpo + "Confirmas?".
      expect(text).toContain('Para: euricojsalves@gmail.com');
      expect(text).toContain('Assunto: Reunião');
      expect(text).toContain('Olá, isto é um teste do Jarvis.');
      expect(text).toContain('Confirmas?');
      // NÃO o label genérico "enviar_email (92%)".
      expect(text).not.toMatch(/enviar_email \(\d+%\)/);
      // Flag que instrui o webhook a mostrar o rascunho directamente.
      expect(outcome.awaitingExternalWriteConfirmation).toBe(true);
    }
    // O Planner correu (extrair rascunho); o Executor NÃO — nenhum email enviado.
    expect(mocks.plannerPlanMock).toHaveBeenCalledTimes(1);
    expect(mocks.executorExecuteMock).not.toHaveBeenCalled();
  });

  it('SEND-PREVIEW-1 (J-7) — fallback: se o Planner falhar no preview, usa label genérico (não quebra)', async () => {
    mocks.classifyMock.mockResolvedValue({
      intents: [{ intent: 'enviar_email', confidence: 0.9, raw_span: 'manda email' }],
      language: 'pt-PT',
      needs_confirmation: true,
      overall_confidence: 0.9,
    });
    mocks.plannerPlanMock.mockRejectedValue(new Error('planner indisponível'));

    const outcome = await runAgentForHousehold({
      userId: TEST_USER_ID,
      householdId: TEST_HOUSEHOLD_ID,
      prompt: 'manda um email',
    });

    expect(outcome.status).toBe('preview');
    if (outcome.status === 'preview') {
      // Degrada para o label genérico — sem crash.
      expect(outcome.planSummary.join(' ')).toMatch(/enviar_email/);
      expect(outcome.awaitingExternalWriteConfirmation).toBeFalsy();
    }
    // Executor nunca corre.
    expect(mocks.executorExecuteMock).not.toHaveBeenCalled();
  });

  it('SEND-PREVIEW-1 (J-7) — regressão: preview de tarefa (confiança baixa) mantém o label genérico e NÃO corre o Planner', async () => {
    mocks.classifyMock.mockResolvedValue({
      intents: [{ intent: 'criar_tarefa', confidence: 0.4, raw_span: 'qq' }],
      language: 'pt-PT',
      needs_confirmation: true,
      overall_confidence: 0.4,
    });

    const outcome = await runAgentForHousehold({
      userId: TEST_USER_ID,
      householdId: TEST_HOUSEHOLD_ID,
      prompt: 'faz qualquer coisa',
    });

    expect(outcome.status).toBe('preview');
    if (outcome.status === 'preview') {
      expect(outcome.planSummary.join(' ')).toMatch(/criar_tarefa \(\d+%\)/);
      expect(outcome.awaitingExternalWriteConfirmation).toBeFalsy();
    }
    // Regressão zero: intents sem preview de rascunho NÃO correm o Planner no preview.
    expect(mocks.plannerPlanMock).not.toHaveBeenCalled();
    expect(mocks.executorExecuteMock).not.toHaveBeenCalled();
  });

  it('AC14 — apenas calendar puro (sem mix) → prossegue para o Planner', async () => {
    mocks.classifyMock.mockResolvedValue({
      intents: [
        { intent: 'criar_evento_calendario', confidence: 0.9, raw_span: 'marca reunião sexta' },
      ],
      language: 'pt-PT',
      needs_confirmation: false,
      overall_confidence: 0.9,
    });
    mocks.plannerPlanMock.mockResolvedValue({
      toolCalls: [
        { toolName: 'criar_evento_calendario', input: {}, intent: 'criar_evento_calendario' },
      ],
      planReasoning: null,
      latencyMs: 0,
      tokensInput: 0,
      tokensOutput: 0,
      costEur: 0,
      cacheHit: false,
    });
    mocks.executorExecuteMock.mockResolvedValue({
      success: true,
      results: [{ toolName: 'criar_evento_calendario', output: { eventId: 'evt' }, reverseOpId: 'rop' }],
    });

    const outcome = await runAgentForHousehold({
      userId: TEST_USER_ID,
      householdId: TEST_HOUSEHOLD_ID,
      prompt: 'marca reunião sexta às 15h',
    });

    expect(outcome.status).toBe('executed');
    // O guard NÃO bloqueia pedidos de calendar puros.
    expect(mocks.plannerPlanMock).toHaveBeenCalled();
  });

  it('AC9 (J-8) — intents mistos (responder_email + tarefa) → separação, nunca envio', async () => {
    mocks.classifyMock.mockResolvedValue({
      intents: [
        { intent: 'responder_email', confidence: 0.9, raw_span: 'responde ao Pedro' },
        { intent: 'criar_tarefa', confidence: 0.9, raw_span: 'e cria uma tarefa' },
      ],
      language: 'pt-PT',
      needs_confirmation: true,
      overall_confidence: 0.9,
    });

    const outcome = await runAgentForHousehold({
      userId: TEST_USER_ID,
      householdId: TEST_HOUSEHOLD_ID,
      prompt: 'responde ao Pedro E cria uma tarefa',
    });

    expect(outcome.status).toBe('preview');
    if (outcome.status === 'preview') {
      expect(outcome.planSummary.join(' ')).toMatch(/um de cada vez/i);
    }
    // CRÍTICO: nenhum email enviado; a resolução nem sequer corre (guard antes).
    expect(mocks.resolveReplyCandidatesMock).not.toHaveBeenCalled();
    expect(mocks.plannerPlanMock).not.toHaveBeenCalled();
    expect(mocks.executorExecuteMock).not.toHaveBeenCalled();
  });
});

describe('runAgentForHousehold — responder_email (Story J-8)', () => {
  it('AC10 — resolve a shortlist e mostra o RASCUNHO real da resposta (Re:) na confirmação', async () => {
    mocks.classifyMock.mockResolvedValue({
      intents: [{ intent: 'responder_email', confidence: 0.92, raw_span: 'responde ao Pedro' }],
      language: 'pt-PT',
      needs_confirmation: true,
      overall_confidence: 0.92,
    });
    // Shortlist resolvida ANTES do Planner (AC5).
    mocks.resolveReplyCandidatesMock.mockResolvedValue([
      {
        threadId: 'thr-1',
        messageId: '<a@mail>',
        from: 'Pedro <pedro@example.com>',
        fromEmail: 'pedro@example.com',
        subject: 'Jantar',
        receivedAt: 'Wed, 02 Jul 2026 10:00:00 +0100',
      },
    ]);
    // O Planner escolhe o candidato e devolve input concreto da tool.
    mocks.plannerPlanMock.mockResolvedValue({
      toolCalls: [
        {
          toolName: 'responder_email',
          input: {
            threadId: 'thr-1',
            messageId: '<a@mail>',
            to: 'pedro@example.com',
            subject: 'Jantar',
            body: 'Confirmo que vou.',
          },
          intent: 'responder_email',
        },
      ],
      planReasoning: null,
      latencyMs: 0,
      tokensInput: 0,
      tokensOutput: 0,
      costEur: 0,
      cacheHit: false,
    });

    const outcome = await runAgentForHousehold({
      userId: TEST_USER_ID,
      householdId: TEST_HOUSEHOLD_ID,
      prompt: 'responde ao Pedro a dizer que vou',
    });

    expect(outcome.status).toBe('preview');
    if (outcome.status === 'preview') {
      const text = outcome.planSummary.join('\n');
      expect(text).toContain('Para: pedro@example.com');
      expect(text).toContain('Assunto: Re: Jantar');
      expect(text).toContain('Confirmo que vou.');
      expect(text).toContain('Confirmas?');
      expect(outcome.awaitingExternalWriteConfirmation).toBe(true);
    }
    // A resolução correu; o Planner correu (rascunho); o Executor NÃO — nada enviado.
    expect(mocks.resolveReplyCandidatesMock).toHaveBeenCalledTimes(1);
    expect(mocks.plannerPlanMock).toHaveBeenCalledTimes(1);
    // A shortlist foi injectada no Planner (emailReplyContext).
    const planArg = mocks.plannerPlanMock.mock.calls[0]![0] as { emailReplyContext?: unknown[] };
    expect(Array.isArray(planArg.emailReplyContext)).toBe(true);
    expect(planArg.emailReplyContext).toHaveLength(1);
    expect(mocks.executorExecuteMock).not.toHaveBeenCalled();
  });

  it('AC13 — zero-match honesto (shortlist vazia) → mensagem "não encontrei", sem Planner, sem envio', async () => {
    mocks.classifyMock.mockResolvedValue({
      intents: [{ intent: 'responder_email', confidence: 0.92, raw_span: 'responde ao Zé' }],
      language: 'pt-PT',
      needs_confirmation: true,
      overall_confidence: 0.92,
    });
    mocks.resolveReplyCandidatesMock.mockResolvedValue([]); // inbox sem candidatos

    const outcome = await runAgentForHousehold({
      userId: TEST_USER_ID,
      householdId: TEST_HOUSEHOLD_ID,
      prompt: 'responde ao Zé que não existe',
    });

    // Resposta informativa (sem preview, sem botões de confirmação).
    expect(outcome.status).toBe('executed');
    if (outcome.status === 'executed' && outcome.kind === 'direct_query') {
      expect(outcome.summary).toMatch(/não encontrei/i);
    } else {
      throw new Error('esperado executed/direct_query (zero-match honesto)');
    }
    // CRÍTICO: Planner e Executor NÃO correm — nunca se inventa um threadId.
    expect(mocks.plannerPlanMock).not.toHaveBeenCalled();
    expect(mocks.executorExecuteMock).not.toHaveBeenCalled();
  });
});

describe('runAgentForHousehold — rollback', () => {
  it('AC5 — rollback graceful (executor success:false) lança AtomicExecutionError', async () => {
    mocks.classifyMock.mockResolvedValue({
      intents: [{ intent: 'criar_tarefa', confidence: 0.85, raw_span: '' }],
      language: 'pt-PT',
      needs_confirmation: false,
      overall_confidence: 0.85,
    });
    mocks.plannerPlanMock.mockResolvedValue({
      toolCalls: [{ toolName: 'create_task', input: {}, intent: 'criar_tarefa' }],
      planReasoning: null,
      latencyMs: 0,
      tokensInput: 0,
      tokensOutput: 0,
      costEur: 0,
      cacheHit: false,
    });
    const { ToolExecutionError } = await import('@meu-jarvis/planner-executor');
    mocks.executorExecuteMock.mockResolvedValue({
      success: false,
      failedToolName: 'create_task',
      error: new ToolExecutionError('create_task', 'falhou'),
      rolledBack: true,
    });

    const { AtomicExecutionError } = await import('@/lib/agent/run-agent');
    await expect(
      runAgentForHousehold({
        userId: TEST_USER_ID,
        householdId: TEST_HOUSEHOLD_ID,
        prompt: 'oi',
      }),
    ).rejects.toBeInstanceOf(AtomicExecutionError);
  });
});
