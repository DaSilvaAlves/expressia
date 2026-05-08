/**
 * Mock `OpenAIClientLike` APENAS para testes — nunca exportado pelo barrel
 * `index.ts`.
 *
 * Trace: Story 2.4 AC11 (mockability) + Task 9 — fixture central para todos
 *        os testes de `Classifier`.
 *
 * Padrões suportados:
 *   1. Resposta determinística com `ClassificationResult` válido pré-formatado.
 *   2. Resposta com JSON malformado (testar `ClassifierOutputError`).
 *   3. Resposta com array vazio / array > 5 / intent inválido (testar Zod
 *      validation no Classifier).
 *   4. Throw de `ProviderError` (testar `ClassifierLLMError` wrapping).
 *
 * NÃO faz qualquer chamada real à API OpenAI. `OPENAI_API_KEY` não é
 * necessária para `pnpm test`.
 */

import type { OpenAIClientLike } from '@meu-jarvis/agent';

import type { ClassificationResult } from '@/schemas';

/**
 * Modos de resposta do mock — controla como o mock devolve.
 */
export type MockMode =
  | { type: 'success'; result: ClassificationResult; usage?: { input: number; output: number } }
  | { type: 'malformed_json'; rawContent: string }
  | { type: 'invalid_schema'; rawJson: object } // JSON válido mas falha Zod
  | { type: 'throw'; error: Error }
  | { type: 'empty_content' };

/**
 * Cria um mock `OpenAIClientLike` com um único modo de resposta. Usado para
 * testes que precisam de comportamento determinístico em cada call.
 *
 * Retorna também `getCallCount()` e `getLastPayload()` para asserções
 * sobre como o Classifier construiu a request.
 */
export function createMockOpenAIClient(mode: MockMode): {
  client: OpenAIClientLike;
  getCallCount: () => number;
  getLastPayload: () => Record<string, unknown> | null;
} {
  let callCount = 0;
  let lastPayload: Record<string, unknown> | null = null;

  const client: OpenAIClientLike = {
    chat: {
      completions: {
        create: async (params: Record<string, unknown>) => {
          callCount += 1;
          lastPayload = params;

          switch (mode.type) {
            case 'success': {
              return {
                choices: [{ message: { content: JSON.stringify(mode.result) } }],
                usage: {
                  prompt_tokens: mode.usage?.input ?? 150,
                  completion_tokens: mode.usage?.output ?? 50,
                },
              };
            }
            case 'malformed_json': {
              return {
                choices: [{ message: { content: mode.rawContent } }],
                usage: { prompt_tokens: 100, completion_tokens: 30 },
              };
            }
            case 'invalid_schema': {
              return {
                choices: [{ message: { content: JSON.stringify(mode.rawJson) } }],
                usage: { prompt_tokens: 100, completion_tokens: 30 },
              };
            }
            case 'throw': {
              throw mode.error;
            }
            case 'empty_content': {
              return {
                choices: [{ message: { content: '' } }],
                usage: { prompt_tokens: 100, completion_tokens: 0 },
              };
            }
          }
        },
      },
    },
  };

  return {
    client,
    getCallCount: () => callCount,
    getLastPayload: () => lastPayload,
  };
}

/**
 * Cria um mock que cicla por uma sequência de modos — útil para testar retry
 * (primeira call falha schema, segunda passa).
 */
export function createSequencedMockOpenAIClient(modes: ReadonlyArray<MockMode>): {
  client: OpenAIClientLike;
  getCallCount: () => number;
} {
  let callCount = 0;

  const client: OpenAIClientLike = {
    chat: {
      completions: {
        create: async (_params: Record<string, unknown>) => {
          const mode = modes[callCount] ?? modes[modes.length - 1];
          callCount += 1;
          if (!mode) {
            throw new Error('Mock sequence exhausted');
          }
          switch (mode.type) {
            case 'success':
              return {
                choices: [{ message: { content: JSON.stringify(mode.result) } }],
                usage: {
                  prompt_tokens: mode.usage?.input ?? 150,
                  completion_tokens: mode.usage?.output ?? 50,
                },
              };
            case 'malformed_json':
              return {
                choices: [{ message: { content: mode.rawContent } }],
                usage: { prompt_tokens: 100, completion_tokens: 30 },
              };
            case 'invalid_schema':
              return {
                choices: [{ message: { content: JSON.stringify(mode.rawJson) } }],
                usage: { prompt_tokens: 100, completion_tokens: 30 },
              };
            case 'throw':
              throw mode.error;
            case 'empty_content':
              return {
                choices: [{ message: { content: '' } }],
                usage: { prompt_tokens: 100, completion_tokens: 0 },
              };
          }
        },
      },
    },
  };

  return {
    client,
    getCallCount: () => callCount,
  };
}

/**
 * Helper: constrói um `ClassificationResult` válido com defaults razoáveis.
 * Os testes podem override apenas os campos relevantes para o caso.
 */
export function buildValidResult(
  overrides: Partial<ClassificationResult> = {},
): ClassificationResult {
  return {
    intents: [{ intent: 'criar_tarefa', confidence: 0.95, raw_span: 'comprar leite' }],
    language: 'pt-PT',
    needs_confirmation: false,
    overall_confidence: 0.95,
    ...overrides,
  };
}
