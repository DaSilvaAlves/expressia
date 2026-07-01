/**
 * Schemas Zod do classifier — `IntentSchema`, `ClassifiedIntentSchema`,
 * `ClassificationSchema` e a constante `CLASSIFIER_MODEL`.
 *
 * Trace: Story 2.4 AC2 + AC3 + AC5; Architecture §4.2 (literal); enum Postgres
 *        `agent_intent` em `packages/db/src/schema/agent.ts` (Story 2.1) é a
 *        fonte de verdade Article IV — qualquer divergência parte o teste de
 *        sanity-check (`__tests__/schemas.test.ts`).
 *
 * Princípios:
 *   - Os 19 valores de `IntentSchema` batem EXACTAMENTE com o enum DB. Sem
 *     desvios, sem invenção — Article IV (No Invention).
 *   - `intents.min(1)` é literal de Architecture §4.2 (sempre pelo menos
 *     `unknown` em prompts não-PT-PT ou ambíguos).
 *   - `intents.max(5)` é guardrail anti-hallucination [AUTO-DECISION D8 do
 *     PO validation, ver story v1.1 AC3]. Sem fonte FR explícita; protege
 *     contra deriva LLM gerar arrays excessivos. Validável em @architect gate.
 *   - `CLASSIFIER_MODEL` é validado em compilação via `satisfies LlmModel`.
 *     Qualquer mudança requer alteração intencional desta constante (Article IV).
 */

import { z } from 'zod';
import type { LlmModel } from '@meu-jarvis/agent';

/**
 * Os 19 intents canónicos do classifier — alinhados com enum Postgres
 * `agent_intent` (Story 2.1, migration 0005; Story 3.8 migration 0012;
 * Story 2.14 migration 0026; Story J-5 migration 0030; Story J-6 migration
 * 0031; Story J-7 migration 0032). NÃO modificar sem actualizar simultaneamente
 * o enum DB e correr `db:migrate`.
 *
 * Sanity-check em runtime (test): `__tests__/schemas.test.ts` LÊ o ficheiro
 * `packages/db/src/schema/agent.ts` via `fs.readFile` + regex sobre
 * `pgEnum('agent_intent', [...])` (Story 2.4 D11 — TypeScript não resolve
 * `@/*` aliases internos do `@meu-jarvis/db` cross-package no nosso setup).
 * O test FAILS deterministicamente se alguém alterar o enum DB sem
 * actualizar `INTENT_VALUES`.
 */
export const INTENT_VALUES = [
  'criar_tarefa',
  'criar_financa_variavel',
  'criar_financa_recorrente',
  'criar_cartao',
  'criar_parcelada',
  'consultar_dados',
  'cancelar_ultima',
  'unknown',
  // Story 3.8 — tools cérebro do domínio Tarefas. Sync com migration 0012 +
  // `packages/db/src/schema/agent.ts:55-60`.
  'completar_tarefa',
  'listar_tarefas',
  'listar_atrasadas',
  // Story 2.14 — tools UPDATE/DELETE Tarefas e Finanças. Sync com migration
  // 0026 + `packages/db/src/schema/agent.ts` enum agent_intent. Article IV:
  // INTENT_VALUES bate EXACTAMENTE com o enum DB (sanity-check em
  // `__tests__/schemas.test.ts`).
  'atualizar_tarefa',
  'eliminar_tarefa',
  'update_finance_variable',
  'delete_finance_variable',
  // Story J-5 — tools Calendar escrita. Sync com migration 0030 +
  // `packages/db/src/schema/agent.ts` agentIntentEnum. Article IV:
  // INTENT_VALUES bate EXACTAMENTE com o enum DB (sanity-check em
  // `__tests__/schemas.test.ts`).
  'criar_evento_calendario',
  'reagendar_evento_calendario',
  // Story J-6 — tool Gmail readonly. Sync com migration 0031 +
  // `packages/db/src/schema/agent.ts` agentIntentEnum. Article IV:
  // INTENT_VALUES bate EXACTAMENTE com o enum DB (sanity-check em
  // `__tests__/schemas.test.ts`).
  'consultar_emails',
  // Story J-7 — tool Gmail send (escrita externa irreversível). Sync com
  // migration 0032 + `packages/db/src/schema/agent.ts` agentIntentEnum.
  // Article IV: INTENT_VALUES bate EXACTAMENTE com o enum DB (sanity-check em
  // `__tests__/schemas.test.ts`).
  'enviar_email',
] as const;

export const IntentSchema = z.enum(INTENT_VALUES);

export type Intent = z.infer<typeof IntentSchema>;

/**
 * Intents de LEITURA (read-only) — não têm side-effects nem `reverse_op` útil.
 *
 * Um pedido cujos intents sejam TODOS destes é seguro executar sem o fluxo
 * preview→confirm (FR4): não há nada a "confirmar" nem a "reverter" numa
 * consulta. O pipeline usa isto para (a) saltar o preview mesmo com
 * `always_preview=true` e (b) não oferecer undo em leituras (evita o
 * `Feito.`+`Cancelar` sem sentido no chat/Telegram — reverse é no-op → 410).
 *
 * `unknown` NÃO é read-only: é ambíguo e deve continuar a pedir clarificação.
 *
 * Trace: Story J-6 follow-up (leituras saltam preview→confirm).
 */
export const READ_ONLY_INTENTS: ReadonlySet<Intent> = new Set<Intent>([
  'consultar_dados',
  'listar_tarefas',
  'listar_atrasadas',
  'consultar_emails',
]);

/** `true` se `intent` for uma intent de leitura (sem side-effects). */
export function isReadOnlyIntent(intent: string): boolean {
  return READ_ONLY_INTENTS.has(intent as Intent);
}

/**
 * Resultado individual da classificação de uma intent dentro do prompt.
 *
 * - `confidence` ∈ [0, 1] — score calibrado pelo LLM via structured output.
 * - `raw_span` — sub-string do prompt original que originou esta intent.
 *   Pode conter PII (NIF, valores, nomes). NUNCA logado em texto claro
 *   (NFR12 / AC9 OTel whitelist exclui `raw_span`).
 */
export const ClassifiedIntentSchema = z.object({
  intent: IntentSchema,
  confidence: z.number().min(0).max(1),
  raw_span: z.string(),
});

export type ClassifiedIntent = z.infer<typeof ClassifiedIntentSchema>;

/**
 * Resultado completo da classificação multi-intent.
 *
 * - `intents.min(1)` — Architecture §4.2 literal. Mesmo prompts ambíguos
 *   devem retornar pelo menos `[{ intent: 'unknown', ... }]`.
 * - `intents.max(5)` — guardrail anti-hallucination [AUTO-DECISION D8].
 * - `language` literal `'pt-PT'` — CON3 (PT-PT exclusivo); valor fixo da pipeline.
 * - `needs_confirmation: true` quando `Math.min(...confidences) < 0.70` (FR4
 *   preview-then-confirm threshold).
 * - `overall_confidence` é o mínimo das confidences individuais (estratégia
 *   conservadora — uma intent ambígua basta para activar preview).
 */
export const ClassificationSchema = z.object({
  intents: z.array(ClassifiedIntentSchema).min(1).max(5),
  language: z.literal('pt-PT'),
  needs_confirmation: z.boolean(),
  overall_confidence: z.number().min(0).max(1),
});

export type ClassificationResult = z.infer<typeof ClassificationSchema>;

/**
 * Threshold canónico para `needs_confirmation`. FR4 do PRD: "se confiança da
 * classificação multi-intent for inferior a 70%, apresentar preview".
 *
 * Exposto como constante para Story 2.7 (preview UI) reusar mesmo valor.
 */
export const CLASSIFIER_CONFIDENCE_THRESHOLD = 0.7 as const;

/**
 * Modelo OpenAI utilizado pelo classifier — fixado em compilação contra o
 * tipo `LlmModel` de `@meu-jarvis/agent` (Story 2.2). Architecture §4.2 fixa
 * GPT-4o-mini como o classifier do MVP por relação custo/precisão.
 *
 * Mudança requer:
 *   1. Adicionar novo valor a `LLM_MODEL_VALUES` em `@meu-jarvis/agent`.
 *   2. Adicionar a `llm_model` enum em DB (migration nova).
 *   3. Justificar em ADR (Architecture decision record).
 */
export const CLASSIFIER_MODEL = 'gpt-4o-mini' as const satisfies LlmModel;
