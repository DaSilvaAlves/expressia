# @meu-jarvis/classifier

**Estágio 1 do pipeline AI multi-intent da Expressia** — classifier PT-PT alimentado por GPT-4o-mini via OpenAI structured outputs (`response_format: json_schema`).

| | |
|---|---|
| **Story** | [2.4 Classifier PT-PT](../../docs/stories/active/2.4.classifier-pt-pt.md) |
| **Posição na pipeline** | `POST /api/agent/prompt` → **Classifier** → Planner (2.5) → Executor (2.5) |
| **Modelo** | `gpt-4o-mini` (Architecture §4.2 — relação custo/precisão para PT-PT) |
| **Bloqueador externo** | EB2 (`OPENAI_API_KEY` com DPA UE) — afecta integração real em Story 2.10. **Esta story é 100% mockable** — `pnpm test` corre sem `OPENAI_API_KEY`. |
| **Dependências internas** | `@meu-jarvis/agent` (Story 2.2 — `OpenAIClientLike`, `ProviderError`, `mapOpenAIError`, `sanitizeHint`), `@meu-jarvis/observability` (Story 1.7 — `withSpan`, `annotateSpan`, `hashForCorrelation`, `logger`). |

## O que faz

1. **Validação de input** — `text` não-vazio, `length ≤ maxInputLength` (default 1000).
2. **Language gate PT-PT** — regex Unicode-aware sobre lista conservadora de palavras inequivocamente PT-BR/EN/ES; rejeita SEM chamar LLM (poupa tokens).
3. **Chamada OpenAI** — `chat.completions.create` com:
   - `model: 'gpt-4o-mini'`
   - `temperature: 0`
   - `max_tokens: 256`
   - `response_format: { type: 'json_schema', json_schema: { strict: true, schema: <ClassificationSchema> } }`
4. **Validação Zod** — `ClassificationSchema.parse()` — qualquer deriva → `ClassifierOutputError` + retry 1× com mesmo prompt (Architecture §4.2).
5. **Derivação de flags** — `needs_confirmation = any(confidence < 0.70)` (FR4); `overall_confidence = min(confidences)`.
6. **OTel tracing** — span `agent.classifier.classify` com whitelist de 12 atributos (zero PII; `userId` hashed via `hashForCorrelation`).

## Exports públicos

```ts
import {
  // Class principal
  Classifier,
  type ClassifierInput,
  type ClassifierOpts,

  // Schemas Zod + tipos
  IntentSchema,
  INTENT_VALUES,
  ClassifiedIntentSchema,
  ClassificationSchema,
  type Intent,
  type ClassifiedIntent,
  type ClassificationResult,

  // Constantes
  CLASSIFIER_MODEL,
  CLASSIFIER_CONFIDENCE_THRESHOLD,
  CLASSIFIER_SYSTEM_PROMPT_VERSION,
  DEFAULT_MAX_INPUT_LENGTH,
  DEFAULT_TIMEOUT_MS,

  // Erros
  ClassifierError,
  ClassifierValidationError,
  ClassifierLanguageError,
  ClassifierLLMError,
  ClassifierOutputError,
  type ClassifierErrorSeverity,

  // Language gate
  detectNonPtPt,
  type LanguageGateResult,

  // OTel whitelist (para dashboards Story 2.11)
  CLASSIFIER_SPAN_ATTRIBUTE_KEYS,
} from '@meu-jarvis/classifier';
```

**NÃO exportados** (privados ao package):
- `CLASSIFIER_SYSTEM_PROMPT` — texto bruto. Apenas a versão (`CLASSIFIER_SYSTEM_PROMPT_VERSION`) é pública.
- `withClassifierSpan`, `annotateClassifierMetrics`, `CLASSIFIER_SPAN_NAME` — internos.
- `__fixtures__/mock-openai-client` — APENAS para testes do package.

## Os 8 intents canónicos

Alinhados literalmente com o enum Postgres `agent_intent` em `packages/db/src/schema/agent.ts:46-55` (Story 2.1). Article IV (No Invention) preservado por sanity-check em `__tests__/schemas.test.ts` que lê o ficheiro `agent.ts` em runtime e compara com `INTENT_VALUES`.

| Intent | Quando usar |
|--------|-------------|
| `criar_tarefa` | Tarefas, recados, lembretes |
| `criar_financa_variavel` | Despesa/receita pontual variável |
| `criar_financa_recorrente` | Despesa/receita recorrente |
| `criar_cartao` | Registar cartão |
| `criar_parcelada` | Compra parcelada |
| `consultar_dados` | Pedidos de leitura/consulta |
| `cancelar_ultima` | Undo (FR6) |
| `unknown` | Fallback explícito (ambíguo, non-PT-PT) |

## Exemplos de uso

### Em produção (`OpenAIProvider` real)

```ts
import { Classifier } from '@meu-jarvis/classifier';
import { OpenAIProvider } from '@meu-jarvis/agent';

// Note: a Classifier consome um `OpenAIClientLike` directamente —
// para wiring com o `OpenAIProvider` da Story 2.2, expor o cliente:
const provider = new OpenAIProvider();
// O cliente subjacente é passado via `clientOverride` em testes; em produção
// o wiring é feito na Story 2.6 (endpoint /api/agent/prompt) que injecta o
// OpenAI SDK directamente.

// Exemplo simplificado (Story 2.6 fará o wiring real):
import OpenAI from 'openai';
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const classifier = new Classifier(client as never);

const result = await classifier.classify({
  text: 'amanhã reunião às 15h, paguei €78,70 no supermercado',
  householdId: 'uuid-...',
  userId: 'uuid-...',
  traceId: 'trace-...',
});
// → 2 intents: criar_tarefa + criar_financa_variavel
```

### Em testes (mock determinístico)

```ts
import { Classifier } from '@meu-jarvis/classifier';
import {
  buildValidResult,
  createMockOpenAIClient,
} from '@meu-jarvis/classifier/src/__fixtures__/mock-openai-client'; // APENAS testes

const { client } = createMockOpenAIClient({
  type: 'success',
  result: buildValidResult({
    intents: [{ intent: 'criar_tarefa', confidence: 0.95, raw_span: 'comprar pão' }],
  }),
});
const classifier = new Classifier(client);
const out = await classifier.classify({
  text: 'comprar pão amanhã',
  householdId: '...',
  userId: '...',
  traceId: '...',
});
// → result determinístico, ZERO chamadas OpenAI
```

## Bumpar versão do system prompt

O system prompt está em `src/prompts/classifier-system.ts` e protegido por snapshot test (`__tests__/prompts.test.ts`). Para alterar:

1. Editar `CLASSIFIER_SYSTEM_PROMPT` no ficheiro.
2. Bumpar `CLASSIFIER_SYSTEM_PROMPT_VERSION` (`'v1' → 'v2'`).
3. Correr `pnpm test` — o snapshot test sinaliza o novo hash; documentar em commit message.
4. Story de evolução do prompt referencia a versão.

## Configuração

```ts
new Classifier(client, {
  maxInputLength: 1000,  // default — chars
  timeoutMs: 10_000,     // default — 10s, alinhado com NFR1
});
```

## Quality gates

- `pnpm --filter @meu-jarvis/classifier typecheck` — TS strict, zero erros
- `pnpm --filter @meu-jarvis/classifier test` — Vitest, ≥35 cases (78 entregues)
- `pnpm lint` — ESLint workspace
- `pnpm check:rls` — NFR5 RLS gate (classifier não adiciona tabelas)
- `pnpm build` — Next.js build com `transpilePackages: ['@meu-jarvis/classifier']`

## Trace — Constitution compliance

| Artigo | Verificação |
|--------|-------------|
| **I — CLI First** | Backend/library, sem UI. ✅ |
| **II — Agent Authority** | @sm draft, @po validate, @dev impl, @architect gate, @devops push. ✅ |
| **III — Story-Driven** | Esta story (2.4) governa toda a implementação. ✅ |
| **IV — No Invention** | `INTENT_VALUES` ↔ enum DB sanity-checked (D11); `CLASSIFIER_MODEL` ↔ `LlmModel` (compile-time `satisfies`); structured outputs literal de Architecture §4.2. AUTO-DECISION D8 (max 5) explícita em AC3, validável em @architect gate. ✅ |
| **V — Quality First** | 5 gates pre-review verdes. 78 tests. ✅ |
| **VI — Absolute Imports** | `@meu-jarvis/*` + `@/*`. Zero `../../`. ✅ |
