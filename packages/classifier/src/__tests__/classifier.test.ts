/**
 * Testes da classe `Classifier` — fluxo end-to-end com mocks.
 *
 * Trace: Story 2.4 AC7 + AC11 (classifier.test.ts mínimo 12 casos).
 *
 * ZERO chamadas reais à API OpenAI. `OPENAI_API_KEY` não é necessária.
 *
 * Cenários cobertos:
 *   1. 1 intent simples confidence > 0.70 → needs_confirmation: false
 *   2. 2 intents simultâneas, ambas > 0.70 → needs_confirmation: false
 *   3. 5 intents simultâneas (limite FR3 / D8 max) → max(5) passa
 *   4. 1 intent confidence < 0.70 → needs_confirmation: true (FR4)
 *   5. input vazio → ClassifierValidationError
 *   6. input > maxLength → ClassifierValidationError
 *   7. input PT-BR → language gate, sem chamar LLM, retorna unknown
 *   8. LLM retorna JSON inválido → ClassifierOutputError (após retry)
 *   9. LLM retorna 429 → ClassifierLLMError (wraps RateLimitError)
 *  10. LLM retorna 6 intents (viola max 5) → ClassifierOutputError
 *  11. consultar_dados intent → classificado correctamente
 *  12. cancelar_ultima intent → classificado correctamente
 *  13. retry recupera output error → segunda call passa
 *  14. content vazio → ClassifierOutputError
 *  15. payload OpenAI tem response_format json_schema (strict: false — DEV-DECISION)
 *  16. schema enviado é inline (type:object) — não {$ref,definitions} [regressão bug 14/05]
 */
import { describe, expect, it } from 'vitest';

import { RateLimitError } from '@meu-jarvis/agent';

import { Classifier } from '@/classifier';
import {
  ClassifierLLMError,
  ClassifierOutputError,
  ClassifierValidationError,
} from '@/errors';
import {
  buildValidResult,
  createMockOpenAIClient,
  createSequencedMockOpenAIClient,
} from '@/__fixtures__/mock-openai-client';

const VALID_INPUT = {
  text: 'comprar pão amanhã',
  householdId: '00000000-0000-4000-a000-000000000001',
  userId: '00000000-0000-4000-a000-000000000002',
  traceId: 'trace-test-001',
};

describe('Classifier — happy path', () => {
  it('1 intent simples, confidence > 0.70 → needs_confirmation: false', async () => {
    const result = buildValidResult({
      intents: [{ intent: 'criar_tarefa', confidence: 0.95, raw_span: 'comprar pão amanhã' }],
    });
    const { client } = createMockOpenAIClient({ type: 'success', result });
    const classifier = new Classifier(client);

    const out = await classifier.classify(VALID_INPUT);
    expect(out.intents).toHaveLength(1);
    expect(out.intents[0]?.intent).toBe('criar_tarefa');
    expect(out.needs_confirmation).toBe(false);
    expect(out.overall_confidence).toBe(0.95);
  });

  it('2 intents simultâneas, ambas > 0.70 → needs_confirmation: false', async () => {
    const result = buildValidResult({
      intents: [
        { intent: 'criar_tarefa', confidence: 0.92, raw_span: 'amanhã reunião 15h' },
        { intent: 'criar_financa_variavel', confidence: 0.95, raw_span: 'paguei €78,70' },
      ],
      overall_confidence: 0.92,
    });
    const { client } = createMockOpenAIClient({ type: 'success', result });
    const classifier = new Classifier(client);

    const out = await classifier.classify(VALID_INPUT);
    expect(out.intents).toHaveLength(2);
    expect(out.needs_confirmation).toBe(false);
    expect(out.overall_confidence).toBe(0.92);
  });

  it('5 intents simultâneas (limite máximo D8) → passa', async () => {
    const result = buildValidResult({
      intents: [
        { intent: 'criar_tarefa', confidence: 0.93, raw_span: 'tarefa X' },
        { intent: 'criar_financa_variavel', confidence: 0.94, raw_span: 'paguei Y' },
        { intent: 'criar_financa_recorrente', confidence: 0.92, raw_span: 'renda Z' },
        { intent: 'criar_cartao', confidence: 0.88, raw_span: 'cartão W' },
        { intent: 'consultar_dados', confidence: 0.91, raw_span: 'consulta V' },
      ],
      overall_confidence: 0.88,
    });
    const { client } = createMockOpenAIClient({ type: 'success', result });
    const classifier = new Classifier(client);

    const out = await classifier.classify(VALID_INPUT);
    expect(out.intents).toHaveLength(5);
    expect(out.needs_confirmation).toBe(false);
  });

  it('confidence < 0.70 → needs_confirmation: true (FR4)', async () => {
    const result = buildValidResult({
      intents: [{ intent: 'criar_tarefa', confidence: 0.55, raw_span: 'algo ambíguo' }],
      overall_confidence: 0.55,
    });
    const { client } = createMockOpenAIClient({ type: 'success', result });
    const classifier = new Classifier(client);

    const out = await classifier.classify(VALID_INPUT);
    expect(out.needs_confirmation).toBe(true);
    expect(out.overall_confidence).toBe(0.55);
  });

  it('mistura confidence — pelo menos uma < 0.70 → needs_confirmation: true', async () => {
    const result = buildValidResult({
      intents: [
        { intent: 'criar_tarefa', confidence: 0.95, raw_span: 'a' },
        { intent: 'criar_financa_variavel', confidence: 0.6, raw_span: 'b' },
      ],
      overall_confidence: 0.95, // mock pode estar incoerente; Classifier recalcula
    });
    const { client } = createMockOpenAIClient({ type: 'success', result });
    const classifier = new Classifier(client);

    const out = await classifier.classify(VALID_INPUT);
    expect(out.needs_confirmation).toBe(true);
    expect(out.overall_confidence).toBe(0.6);
  });
});

describe('Classifier — intents específicos (cobertura dos 8 valores)', () => {
  it('classifica consultar_dados', async () => {
    const result = buildValidResult({
      intents: [{ intent: 'consultar_dados', confidence: 0.88, raw_span: 'quanto gastei' }],
      overall_confidence: 0.88,
    });
    const { client } = createMockOpenAIClient({ type: 'success', result });
    const classifier = new Classifier(client);
    const out = await classifier.classify(VALID_INPUT);
    expect(out.intents[0]?.intent).toBe('consultar_dados');
  });

  it('classifica cancelar_ultima', async () => {
    const result = buildValidResult({
      intents: [{ intent: 'cancelar_ultima', confidence: 0.97, raw_span: 'anula a última' }],
      overall_confidence: 0.97,
    });
    const { client } = createMockOpenAIClient({ type: 'success', result });
    const classifier = new Classifier(client);
    const out = await classifier.classify(VALID_INPUT);
    expect(out.intents[0]?.intent).toBe('cancelar_ultima');
  });
});

describe('Classifier — validação de input', () => {
  it('input vazio → ClassifierValidationError', async () => {
    const { client } = createMockOpenAIClient({
      type: 'success',
      result: buildValidResult(),
    });
    const classifier = new Classifier(client);
    await expect(classifier.classify({ ...VALID_INPUT, text: '' })).rejects.toBeInstanceOf(
      ClassifierValidationError,
    );
  });

  it('input só whitespace → ClassifierValidationError', async () => {
    const { client } = createMockOpenAIClient({
      type: 'success',
      result: buildValidResult(),
    });
    const classifier = new Classifier(client);
    await expect(classifier.classify({ ...VALID_INPUT, text: '   \t\n  ' })).rejects.toBeInstanceOf(
      ClassifierValidationError,
    );
  });

  it('input > maxLength → ClassifierValidationError', async () => {
    const { client } = createMockOpenAIClient({
      type: 'success',
      result: buildValidResult(),
    });
    const classifier = new Classifier(client, { maxInputLength: 10 });
    await expect(
      classifier.classify({ ...VALID_INPUT, text: 'x'.repeat(11) }),
    ).rejects.toBeInstanceOf(ClassifierValidationError);
  });

  it('NUNCA chama o LLM se a validação falhar', async () => {
    const { client, getCallCount } = createMockOpenAIClient({
      type: 'success',
      result: buildValidResult(),
    });
    const classifier = new Classifier(client);
    await expect(classifier.classify({ ...VALID_INPUT, text: '' })).rejects.toBeInstanceOf(
      ClassifierValidationError,
    );
    expect(getCallCount()).toBe(0);
  });
});

describe('Classifier — language gate', () => {
  it('input PT-BR → retorna unknown SEM chamar LLM', async () => {
    const { client, getCallCount } = createMockOpenAIClient({
      type: 'success',
      result: buildValidResult(),
    });
    const classifier = new Classifier(client);

    const out = await classifier.classify({ ...VALID_INPUT, text: 'você precisa fazer isso' });
    expect(out.intents).toHaveLength(1);
    expect(out.intents[0]?.intent).toBe('unknown');
    expect(out.intents[0]?.confidence).toBe(1.0);
    expect(out.language).toBe('pt-PT');
    expect(out.needs_confirmation).toBe(false);
    expect(getCallCount()).toBe(0); // gate previne LLM call
  });

  it('input EN → retorna unknown SEM chamar LLM', async () => {
    const { client, getCallCount } = createMockOpenAIClient({
      type: 'success',
      result: buildValidResult(),
    });
    const classifier = new Classifier(client);
    const out = await classifier.classify({ ...VALID_INPUT, text: 'the cat is on the table' });
    expect(out.intents[0]?.intent).toBe('unknown');
    expect(getCallCount()).toBe(0);
  });

  it('input ES → retorna unknown SEM chamar LLM', async () => {
    const { client, getCallCount } = createMockOpenAIClient({
      type: 'success',
      result: buildValidResult(),
    });
    const classifier = new Classifier(client);
    const out = await classifier.classify({ ...VALID_INPUT, text: '¿qué hora es?' });
    expect(out.intents[0]?.intent).toBe('unknown');
    expect(getCallCount()).toBe(0);
  });
});

describe('Classifier — error mapping LLM', () => {
  it('JSON malformado → ClassifierOutputError (após retry)', async () => {
    const { client } = createMockOpenAIClient({
      type: 'malformed_json',
      rawContent: 'not json at all {{{',
    });
    const classifier = new Classifier(client);
    await expect(classifier.classify(VALID_INPUT)).rejects.toBeInstanceOf(ClassifierOutputError);
  });

  it('schema inválido — 6 intents (viola max 5) → ClassifierOutputError', async () => {
    const tooManyIntents = {
      intents: Array.from({ length: 6 }, () => ({
        intent: 'criar_tarefa',
        confidence: 0.9,
        raw_span: 'x',
      })),
      language: 'pt-PT',
      needs_confirmation: false,
      overall_confidence: 0.9,
    };
    const { client } = createMockOpenAIClient({ type: 'invalid_schema', rawJson: tooManyIntents });
    const classifier = new Classifier(client);
    await expect(classifier.classify(VALID_INPUT)).rejects.toBeInstanceOf(ClassifierOutputError);
  });

  it('content vazio → ClassifierOutputError', async () => {
    const { client } = createMockOpenAIClient({ type: 'empty_content' });
    const classifier = new Classifier(client);
    await expect(classifier.classify(VALID_INPUT)).rejects.toBeInstanceOf(ClassifierOutputError);
  });

  it('LLM 429 → ClassifierLLMError (wraps RateLimitError, retryable=true)', async () => {
    const rateLimit = new RateLimitError('openai', 5);
    const { client } = createMockOpenAIClient({ type: 'throw', error: rateLimit });
    const classifier = new Classifier(client);
    try {
      await classifier.classify(VALID_INPUT);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ClassifierLLMError);
      const llmErr = err as ClassifierLLMError;
      expect(llmErr.retryable).toBe(true);
      // O providerCause é re-mapeado por mapOpenAIError, mas mantém-se RateLimitError.
      expect(llmErr.providerCause.constructor.name).toBe('RateLimitError');
    }
  });
});

describe('Classifier — retry behavior', () => {
  it('retry recupera ClassifierOutputError — segunda call passa', async () => {
    const validResult = buildValidResult();
    const { client, getCallCount } = createSequencedMockOpenAIClient([
      { type: 'malformed_json', rawContent: 'not json' }, // 1ª call falha
      { type: 'success', result: validResult }, // 2ª call passa
    ]);
    const classifier = new Classifier(client);

    const out = await classifier.classify(VALID_INPUT);
    expect(out.intents).toHaveLength(1);
    expect(getCallCount()).toBe(2);
  });

  it('NÃO retry para ProviderError (mapeado directamente)', async () => {
    const rateLimit = new RateLimitError('openai', 5);
    const { client, getCallCount } = createSequencedMockOpenAIClient([
      { type: 'throw', error: rateLimit },
      { type: 'success', result: buildValidResult() }, // este NÃO deve ser chamado
    ]);
    const classifier = new Classifier(client);
    await expect(classifier.classify(VALID_INPUT)).rejects.toBeInstanceOf(ClassifierLLMError);
    expect(getCallCount()).toBe(1); // só 1 call, sem retry
  });
});

describe('Classifier — payload OpenAI', () => {
  it('inclui response_format.json_schema + system prompt no início', async () => {
    const { client, getLastPayload } = createMockOpenAIClient({
      type: 'success',
      result: buildValidResult(),
    });
    const classifier = new Classifier(client);
    await classifier.classify(VALID_INPUT);

    const payload = getLastPayload();
    expect(payload).not.toBeNull();
    expect(payload?.['model']).toBe('gpt-4o-mini');
    expect(payload?.['temperature']).toBe(0);
    expect(payload?.['max_tokens']).toBe(256);

    const responseFormat = payload?.['response_format'] as Record<string, unknown> | undefined;
    expect(responseFormat?.['type']).toBe('json_schema');
    const jsonSchema = responseFormat?.['json_schema'] as Record<string, unknown> | undefined;
    // `strict: false` — ver [DEV-DECISION 14/05/2026] em classifier.ts: o strict
    // mode da OpenAI rejeita keywords que o ClassificationSchema gera (`const`,
    // `minItems`/`maxItems`, `minimum`/`maximum`). Validação rigorosa do output
    // fica garantida por ClassificationSchema.safeParse + retry 1×.
    expect(jsonSchema?.['strict']).toBe(false);
    expect(jsonSchema?.['name']).toBe('classification');

    const messages = payload?.['messages'] as Array<{ role: string; content: string }> | undefined;
    expect(messages?.[0]?.role).toBe('system');
    expect(messages?.[1]?.role).toBe('user');
    expect(messages?.[1]?.content).toBe(VALID_INPUT.text);
  });

  it('schema é inline com type:"object" no topo — NÃO {$ref,definitions} [regressão bug 14/05/2026]', async () => {
    // Bug de produção 14/05/2026: passar `name` ao `zodToJsonSchema` envolvia o
    // schema em `{ $ref: '#/definitions/classification', definitions: {...} }`
    // — o objecto de topo ficava sem `type` e a OpenAI real rejeitava com 400
    // ("schema must be a JSON Schema of 'type: object', got 'type: None'").
    // O mock não validava o schema, por isso o bug só aparecia em produção.
    // Este teste fecha esse gap — assert directo sobre o shape do payload.
    const { client, getLastPayload } = createMockOpenAIClient({
      type: 'success',
      result: buildValidResult(),
    });
    const classifier = new Classifier(client);
    await classifier.classify(VALID_INPUT);

    const payload = getLastPayload();
    const responseFormat = payload?.['response_format'] as Record<string, unknown> | undefined;
    const jsonSchema = responseFormat?.['json_schema'] as Record<string, unknown> | undefined;
    const schema = jsonSchema?.['schema'] as Record<string, unknown> | undefined;

    expect(schema).toBeDefined();
    expect(schema?.['type']).toBe('object');
    expect(schema?.['$ref']).toBeUndefined();
    expect(schema?.['definitions']).toBeUndefined();
    expect(schema?.['properties']).toBeDefined();
  });
});
