/**
 * Entry-point público do package `@meu-jarvis/classifier`.
 *
 * Trace: Story 2.4 AC12.
 *
 * Exports públicos:
 *   - `Classifier` (class) + `ClassifierInput`, `ClassifierOpts` (tipos).
 *   - Schemas Zod (`IntentSchema`, `ClassifiedIntentSchema`, `ClassificationSchema`)
 *     e tipos derivados (`Intent`, `ClassifiedIntent`, `ClassificationResult`).
 *   - Constantes (`CLASSIFIER_MODEL`, `CLASSIFIER_CONFIDENCE_THRESHOLD`,
 *     `CLASSIFIER_SYSTEM_PROMPT_VERSION`, `INTENT_VALUES`,
 *     `DEFAULT_MAX_INPUT_LENGTH`, `DEFAULT_TIMEOUT_MS`).
 *   - Hierarquia de erros (`ClassifierError` + 4 subclasses) +
 *     `ClassifierErrorSeverity`.
 *   - Language gate (`detectNonPtPt`, `LanguageGateResult`) — exposto para
 *     testabilidade e uso futuro pela Story 2.5.
 *   - `CLASSIFIER_SPAN_ATTRIBUTE_KEYS` (read-only — usado por testes e
 *     Story 2.11 dashboards).
 *
 * NÃO exportados (privados ao package):
 *   - `CLASSIFIER_SYSTEM_PROMPT` (texto bruto do prompt — não deve ser
 *     importado por consumidores; só `CLASSIFIER_SYSTEM_PROMPT_VERSION`).
 *   - `withClassifierSpan`, `annotateClassifierMetrics`,
 *     `ClassifierSpanMetrics`, `CLASSIFIER_SPAN_NAME` — helpers internos
 *     usados pela class `Classifier`.
 *   - `__fixtures__/mock-openai-client` — APENAS para testes do package.
 */

// Class principal e tipos.
export { Classifier, DEFAULT_MAX_INPUT_LENGTH, DEFAULT_TIMEOUT_MS } from './classifier';
export type { ClassifierInput, ClassifierOpts } from './classifier';

// Schemas e tipos.
export {
  IntentSchema,
  INTENT_VALUES,
  READ_ONLY_INTENTS,
  isReadOnlyIntent,
  ClassifiedIntentSchema,
  ClassificationSchema,
  CLASSIFIER_CONFIDENCE_THRESHOLD,
  CLASSIFIER_MODEL,
} from './schemas';
export type { Intent, ClassifiedIntent, ClassificationResult } from './schemas';

// Erros.
export {
  ClassifierError,
  ClassifierValidationError,
  ClassifierLanguageError,
  ClassifierLLMError,
  ClassifierOutputError,
} from './errors';
export type { ClassifierErrorSeverity } from './errors';

// Language gate.
export { detectNonPtPt } from './language-gate';
export type { LanguageGateResult } from './language-gate';

// Tracing — APENAS as keys públicas (whitelist). Wrappers são privados.
export { CLASSIFIER_SPAN_ATTRIBUTE_KEYS } from './tracing';

// System prompt — APENAS a versão (string raw NÃO exportado).
export { CLASSIFIER_SYSTEM_PROMPT_VERSION } from './prompts/classifier-system';
