/**
 * Classe `Classifier` — Estágio 1 do pipeline AI multi-intent.
 *
 * Trace: Story 2.4 AC5 + AC7 + AC9 (uso interno de tracing) + Architecture §4.2;
 *        FR3, FR4, NFR1, NFR12.
 *
 * Fluxo de `classify()`:
 *   1. Validar `input.text` não-vazio e ≤ `maxInputLength` →
 *      `ClassifierValidationError`.
 *   2. Language gate `detectNonPtPt(text)` → se non-PT-PT, retorna resultado
 *      determinístico `unknown` SEM chamar LLM (lança `ClassifierLanguageError`
 *      severity `warn` registado em span e retornado ao caller).
 *   3. Construir payload OpenAI com `response_format: { type: 'json_schema',
 *      json_schema: <ClassificationSchema convertida> }`.
 *   4. Invocar `client.chat.completions.create(...)` com `model: CLASSIFIER_MODEL`,
 *      `temperature: 0`, `max_tokens: 256`.
 *   5. Parse + validação Zod → `ClassifierOutputError` se falhar (retry 1×).
 *   6. Derivar `needs_confirmation` (any confidence < 0,70) e `overall_confidence`
 *      (min de confidences).
 *   7. Anotar span com métricas e retornar `ClassificationResult`.
 *
 * `OpenAIClientLike` é importada de `@meu-jarvis/agent` (Story 2.4 D9 export
 * adicionada à 2.2). Sem acoplamento ao SDK OpenAI directamente — testes
 * injectam mocks 100% deterministicos.
 *
 * NFR1 latência: timeout default 10s; classifier sozinho ~< 2s em regime
 * normal (architecture §4.2 — ~150 tokens in / 50 out em GPT-4o-mini).
 */

import type { Span } from '@opentelemetry/api';
import { trace } from '@opentelemetry/api';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

import {
  mapOpenAIError,
  ProviderError,
  type OpenAIClientLike,
} from '@meu-jarvis/agent';
import { logger } from '@meu-jarvis/observability';

import {
  CLASSIFIER_CONFIDENCE_THRESHOLD,
  CLASSIFIER_MODEL,
  ClassificationSchema,
  type ClassificationResult,
  type ClassifiedIntent,
} from '@/schemas';
import {
  ClassifierLanguageError,
  ClassifierLLMError,
  ClassifierOutputError,
  ClassifierValidationError,
} from '@/errors';
import { detectNonPtPt } from '@/language-gate';
import {
  CLASSIFIER_SYSTEM_PROMPT,
  CLASSIFIER_SYSTEM_PROMPT_VERSION,
} from '@/prompts/classifier-system';
import { annotateClassifierMetrics, withClassifierSpan } from '@/tracing';

/**
 * Default máximo de caracteres aceites em `input.text`. Decisão prudencial
 * [AUTO-DECISION D6 do @sm, ACCEPT WITH NOTE pelo @po — sem rastreabilidade
 * FR explícita; @architect pode ajustar no gate].
 */
export const DEFAULT_MAX_INPUT_LENGTH = 1000 as const;

/**
 * Default timeout para a chamada LLM. Alinhado com NFR1 (latência p95 total
 * < 6s; classifier sozinho deve ficar < 2s em regime normal — 10s é o
 * cap defensivo).
 */
export const DEFAULT_TIMEOUT_MS = 10_000 as const;

/**
 * Input do `Classifier.classify()`. `householdId`/`userId` são UUIDs — usados
 * APENAS para tracing (hashed) e nunca para construir o prompt LLM.
 */
export interface ClassifierInput {
  readonly text: string;
  readonly householdId: string;
  readonly userId: string;
  readonly traceId: string;
}

/**
 * Opções construtor `Classifier`. Todos os campos opcionais — defaults
 * razoáveis aplicados.
 */
export interface ClassifierOpts {
  readonly maxInputLength?: number;
  readonly timeoutMs?: number;
}

/**
 * Forma minimal da resposta OpenAI Chat Completions usada por este classifier.
 * Estructural — match contra qualquer SDK OpenAI v4+ ou mock.
 */
interface OpenAIChatCompletionResponse {
  readonly choices?: ReadonlyArray<{
    readonly message?: { readonly content?: string | null };
  }>;
  readonly usage?: {
    readonly prompt_tokens?: number;
    readonly completion_tokens?: number;
  };
}

/**
 * Classifier PT-PT — instância stateless. Pode ser instanciada uma vez por
 * processo e reutilizada (singleton-friendly, padrão do `OpenAIProvider` 2.2).
 */
export class Classifier {
  private readonly client: OpenAIClientLike;
  private readonly maxInputLength: number;
  private readonly timeoutMs: number;

  constructor(client: OpenAIClientLike, opts: ClassifierOpts = {}) {
    this.client = client;
    this.maxInputLength = opts.maxInputLength ?? DEFAULT_MAX_INPUT_LENGTH;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * Classifica o input numa ou mais intents simultâneas.
   *
   * Lança `ClassifierError` (alguma das 4 subclasses). NUNCA propaga raw
   * `ProviderError` — sempre envolvido em `ClassifierLLMError`.
   */
  async classify(input: ClassifierInput): Promise<ClassificationResult> {
    return withClassifierSpan(CLASSIFIER_MODEL, input.householdId, async (span) => {
      const startedAt = Date.now();
      try {
        // Step 1 — validação de input.
        this.validateInput(input.text);

        // Step 2 — language gate.
        const gate = detectNonPtPt(input.text);
        if (!gate.isPortugueseEuropean) {
          const result: ClassificationResult = {
            intents: [
              {
                intent: 'unknown',
                confidence: 1.0,
                raw_span: input.text,
              },
            ],
            language: 'pt-PT',
            needs_confirmation: false,
            overall_confidence: 1.0,
          };
          // Sinalizar via span sem lançar — o caller recebe um resultado
          // determinístico e regista o gate como warn no log estruturado.
          annotateClassifierMetrics(span, {
            model: CLASSIFIER_MODEL,
            inputLength: input.text.length,
            intentCount: 1,
            overallConfidence: 1.0,
            languageDetected: 'non-pt-pt',
            durationMs: Date.now() - startedAt,
            tokensInput: 0,
            tokensOutput: 0,
            success: true,
            errorClass: null,
            userId: input.userId,
            householdId: input.householdId,
            traceId: input.traceId,
          });
          // Log warn estruturado — informação útil sem PII (length apenas).
          const warn = new ClassifierLanguageError(gate.detectedPatterns);
          logger.warn(
            {
              event: 'classifier.language_gate_rejected',
              detectedPatterns: warn.detectedPatterns,
              inputLength: input.text.length,
              traceId: input.traceId,
            },
            warn.message,
          );
          return result;
        }

        // Step 3-5 — LLM call com retry 1× para ClassifierOutputError.
        const { result, tokensInput, tokensOutput } = await this.callLlmWithRetry(
          input.text,
          span,
        );

        // Step 6 — derivar needs_confirmation e overall_confidence.
        const finalResult = applyConfidenceDerivation(result);

        // Step 7 — anotar métricas finais.
        annotateClassifierMetrics(span, {
          model: CLASSIFIER_MODEL,
          inputLength: input.text.length,
          intentCount: finalResult.intents.length,
          overallConfidence: finalResult.overall_confidence,
          languageDetected: 'pt-PT',
          durationMs: Date.now() - startedAt,
          tokensInput,
          tokensOutput,
          success: true,
          errorClass: null,
          userId: input.userId,
          householdId: input.householdId,
          traceId: input.traceId,
        });
        return finalResult;
      } catch (err) {
        // Anotar métricas de erro (durationMs útil mesmo em falha).
        annotateClassifierMetrics(span, {
          model: CLASSIFIER_MODEL,
          inputLength: input.text.length,
          intentCount: 0,
          overallConfidence: 0,
          languageDetected: 'pt-PT',
          durationMs: Date.now() - startedAt,
          tokensInput: 0,
          tokensOutput: 0,
          success: false,
          errorClass: err instanceof Error ? err.constructor.name : 'UnknownError',
          userId: input.userId,
          householdId: input.householdId,
          traceId: input.traceId,
        });
        throw err;
      }
    });
  }

  /**
   * Validação determinística do `input.text`.
   */
  private validateInput(text: string): void {
    if (typeof text !== 'string' || text.trim() === '') {
      throw new ClassifierValidationError('empty', text?.length ?? 0, this.maxInputLength);
    }
    if (text.length > this.maxInputLength) {
      throw new ClassifierValidationError('too_long', text.length, this.maxInputLength);
    }
  }

  /**
   * Invoca o LLM com retry 1× sobre `ClassifierOutputError` (Architecture §4.2:
   * "qualquer deriva → retry 1× com temperature=0").
   */
  private async callLlmWithRetry(
    text: string,
    _span: Span,
  ): Promise<{ result: ClassificationResult; tokensInput: number; tokensOutput: number }> {
    let attempt = 0;
    const maxAttempts = 2; // 1 inicial + 1 retry.
    let lastOutputError: ClassifierOutputError | null = null;

    while (attempt < maxAttempts) {
      attempt += 1;
      try {
        return await this.callLlmOnce(text);
      } catch (err) {
        if (err instanceof ClassifierOutputError) {
          lastOutputError = err;
          if (attempt < maxAttempts) {
            // Continue retry loop — temperature=0 já é o default de payload.
            continue;
          }
          throw lastOutputError;
        }
        if (err instanceof ProviderError) {
          throw new ClassifierLLMError(err);
        }
        // Erro inesperado — não envolver, propagar tal-qual (mas raro: o
        // ProviderError mapping cobre os casos conhecidos).
        throw err;
      }
    }
    // Inalcançável (o while termina sempre por throw ou return), mas o TS
    // requer fechamento exhaustivo.
    throw lastOutputError ?? new ClassifierOutputError(0);
  }

  /**
   * Uma chamada ao LLM + parse + validação Zod. Lança `ClassifierOutputError`
   * em deriva de schema, `ProviderError` em deriva de provider (envolvido
   * em `ClassifierLLMError` pelo caller).
   */
  private async callLlmOnce(
    text: string,
  ): Promise<{ result: ClassificationResult; tokensInput: number; tokensOutput: number }> {
    const jsonSchema = zodToJsonSchema(ClassificationSchema, {
      name: 'classification',
      $refStrategy: 'none',
    });

    const payload = {
      model: CLASSIFIER_MODEL,
      temperature: 0,
      max_tokens: 256,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'classification',
          strict: true,
          schema: jsonSchema,
        },
      },
      messages: [
        { role: 'system', content: CLASSIFIER_SYSTEM_PROMPT },
        { role: 'user', content: text },
      ],
      // Tagging interno para correlação Sentry/OTel — NÃO contém PII.
      metadata: {
        prompt_version: CLASSIFIER_SYSTEM_PROMPT_VERSION,
      },
    };

    let raw: unknown;
    try {
      raw = await this.client.chat.completions.create(payload);
    } catch (err) {
      // Convert SDK errors → ProviderError (caller transforma em ClassifierLLMError).
      throw mapOpenAIError(err, this.timeoutMs);
    }

    const response = raw as OpenAIChatCompletionResponse;
    const content = response.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.trim() === '') {
      throw new ClassifierOutputError(0);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new ClassifierOutputError(1);
    }

    const validation = ClassificationSchema.safeParse(parsed);
    if (!validation.success) {
      throw new ClassifierOutputError(validation.error.issues.length);
    }

    return {
      result: validation.data,
      tokensInput: response.usage?.prompt_tokens ?? 0,
      tokensOutput: response.usage?.completion_tokens ?? 0,
    };
  }
}

/**
 * Deriva `needs_confirmation` e `overall_confidence` a partir do array de
 * intents. Esta função é o "guardião" do contrato AC3 — o LLM pode devolver
 * valores incoerentes (ex: `needs_confirmation: false` mas há intent com
 * confidence < 0,70); o caller (Classifier) recalcula sempre estes campos.
 */
function applyConfidenceDerivation(parsed: ClassificationResult): ClassificationResult {
  const confidences = parsed.intents.map((i: ClassifiedIntent) => i.confidence);
  const minConfidence = confidences.reduce((a, b) => Math.min(a, b), 1);
  return {
    intents: parsed.intents,
    language: parsed.language,
    needs_confirmation: minConfidence < CLASSIFIER_CONFIDENCE_THRESHOLD,
    overall_confidence: minConfidence,
  };
}

// Side-effect: marcar acesso à API OTel para evitar tree-shaking agressivo
// quando o consumidor não anota spans extra (mantém o tracer registado).
void trace;
// Side-effect: marcar uso de zod (já importado para ClassificationSchema acima
// no schemas.ts; aqui é só re-export type-side).
void z;
