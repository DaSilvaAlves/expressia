# `@meu-jarvis/planner-executor`

**Estágio 2+3 do pipeline AI multi-intent** — Planner (Anthropic Sonnet com tool calling) + Executor (thin wrapper sobre `executeAtomic` da Story 2.3).

Trace: Story 2.5 + Architecture §4.1 (pipeline 3 estágios) + §4.3 (Planner+Executor — Sonnet) + §4.5 (`agent_reverse_ops`) + PRD FR2 (atomicidade), FR4 (preview hooks), FR6 (undo 30s).

---

## Posição na pipeline

```
POST /api/agent/prompt (Story 2.6)
  → [Estágio 1] Classifier (Story 2.4 ✓)
       → ClassificationResult { intents[], needs_confirmation, overall_confidence }
  → [preview gate] se needs_confirmation → preview card (FR4, Story 2.7)
  → [Estágio 2] Planner (esta story)
       → PlanResult { toolCalls[], cacheHit, cost }
  → [Estágio 3] Executor (esta story) → executeAtomic (Story 2.3 ✓)
       → AtomicResult { results[].reverseOpId } | AtomicFailure { rolledBack: true }
  → endpoint atualiza agent_runs.status (Story 2.6)
  → [undo handle] reverseOpIds disponíveis para undo_token (Story 2.8)
```

---

## API

### Planner

```ts
import { Planner, type PlannerInput } from '@meu-jarvis/planner-executor';

const planner = new Planner();
// Em produção: getProvider({preferredProvider:'anthropic'}) é resolvido automaticamente

const result = await planner.plan({
  classification,           // de @meu-jarvis/classifier
  householdId, userId, traceId, runId,
});

// result.toolCalls: [{ toolName, input, intent, rawCallId }]
// result.cacheHit: bool — true se Anthropic prompt cache hit (~90% saving)
// result.costEur, tokensInput, tokensOutput, latencyMs
```

**Defaults:**
- `model`: `'claude-sonnet-4-5'` (`CLAUDE_SONNET_DEFAULT` da 2.2)
- `cacheControl`: `'ephemeral'` (D11 — Architecture §4.3 ~90% cost saving)
- `temperature`: `0.2`
- `maxTokens`: `1024`

**Override em testes:**
```ts
import { createMockAnthropicClient } from './__fixtures__/mock-anthropic-client'; // privado

const planner = new Planner({
  client: createMockAnthropicClient(...),  // AnthropicClientLike (re-exposto da 2.2 via D9-anthropic)
  registry: createMockRegistry(),
  cacheControl: null,  // desligar cache para testar payload sem cache_control
});
```

### Executor

```ts
import { Executor } from '@meu-jarvis/planner-executor';
import { getDb } from '@meu-jarvis/db';

const executor = new Executor({
  dbResolver: () => getDb(),  // OBRIGATÓRIO em produção — getDb() retorna cliente RLS-aware
});

const outcome = await executor.execute({
  plan: result,        // PlanResult do Planner
  householdId, userId, traceId, runId,
});

if (outcome.success) {
  // outcome.results: [{ toolName, output, reverseOpId }]
  // reverseOpId: UUID em agent_reverse_ops com expires_at = now() + 30s
} else {
  // outcome.failedToolName, outcome.error: ToolError, outcome.rolledBack: true
}
```

---

## Decisões arquitecturais [AUTO-DECISIONS]

Story 2.5 documenta 9 decisões @sm validadas por @po (GO 9.4/10) e por @architect gate (futuro). Resumo:

| ID | Decisão | Razão |
|----|---------|-------|
| D5 | `toolCalls.max(10)` anti-hallucination guardrail | 5 intents × 2-3 tools = 10-15 razoável; defensa contra LLM deriva |
| D5b | 1 package (Planner+Executor) vs 2 separados | Coesão Architecture §4.3 + padrão 1 package por estágio |
| D6 | `TOOL_TO_INTENT_MAP` declarativo estático | Determinístico, testável, fallback `'unknown'` |
| D8 | Defense-in-depth tool name validation no Executor | Padrão obrigatório código transaccional; fail-rapid antes de tx |
| D9-anthropic | Re-export `AnthropicClientLike` do barrel `@meu-jarvis/agent` | Analogia D9 da 2.4 (zero-risk type expose) |
| D11 | `cacheControl: 'ephemeral'` default | Architecture §4.3 explícito ~90% saving; sweet spot custo/precisão |
| D13 | Executor delega `ToolError` da 2.3 | Single source of truth; única excepção `ExecutorValidationError` |
| D14 | Skip CodeRabbit pre-commit (defere a @architect gate) | Precedente 2.2/2.3/2.4 |
| D15 | Test count target ≥45 | Médio entre 2.3 (57) e 2.4 (78); story L scope similar |

[AUTO-DECISIONS] @dev (durante implementação):

| ID | Decisão | Razão |
|----|---------|-------|
| D9-anthropic-applied | Re-export `AnthropicClientLike` em `packages/agent/src/index.ts:20` | 1 linha zero-risk; analogia D9 da 2.4 |
| D16 | Refactor `@/*` → `./` em `packages/tools/src/*.ts` (4 ficheiros) e `packages/classifier/src/*.ts` (2 ficheiros) | Cross-package paths aliases TS source-only não resolvem `@/*` interno. Sem alteração comportamental, todos os 222+ testes existentes continuam a passar. Pattern consistente com `packages/agent/src/*.ts` (já usa relativos). |

---

## Mockability strategy

100% mockable — zero calls reais a Anthropic (EB1 não bloqueia desenvolvimento). Integração real adiada para Story 2.10 (benchmark E2E 200 prompts PT-PT).

**3 fixtures privados:**
- `__fixtures__/mock-anthropic-client.ts` — `AnthropicClientLike` mock determinístico
- `__fixtures__/mock-tool-registry.ts` — Registry com 3 tools mock (`create_task`, `create_finance_variable`, `query_tasks`)
- `__fixtures__/mock-db-tx.ts` — Mock `DrizzleDbClient` com `transaction`/`insert`/`execute` spies

53 testes Vitest cobrem todos os ACs (target ≥45 — EXCEEDS).

---

## Bloqueador EB1 — gestão

`ANTHROPIC_API_KEY` DPA UE PENDING. Não afecta esta story:
- Drafting `@sm`: independente
- Validation `@po`: independente
- Implementação `@dev`: 100% mockada (`AnthropicClientLike` injectado via `opts.client`)
- Architect gate: independente
- Push `@devops`: independente

Em runtime production (Vercel), o `AnthropicProvider` lança `MissingApiKeyError` no constructor se `ANTHROPIC_API_KEY` ausente — comportamento da 2.2.

---

## Versão do system prompt

**`PLANNER_SYSTEM_PROMPT_VERSION = 'v1'`** — qualquer alteração ao texto do prompt requer:

1. Bumpar a constante (`'v1'` → `'v2'`).
2. Re-gerar snapshot hash em `__tests__/prompts.test.ts`.
3. Documentar mudança no Change Log da story afectada.
4. Validar empiricamente impacto em Story 2.10 benchmark (200 prompts PT-PT).

O texto raw do prompt NÃO é exportado pelo barrel — apenas a versão.

---

## Cobertura de testes

| Ficheiro | Casos | Foco |
|----------|-------|------|
| `schemas.test.ts` | 9 | PlanResultSchema (max 10), Planner/ExecutorInputSchema (UUID), TOOL_TO_INTENT_MAP coverage 8 intents |
| `planner.test.ts` | 13 | Happy paths 1/2/3 tool calls, classification unknown early-return, alucinação, empty plan, provider errors (RateLimit/Timeout/ServerError), retry temperature=0, cache_control ephemeral payload |
| `executor.test.ts` | 12 | Plan vazio, D8 defense-in-depth fail-rapid, happy paths via executeAtomic, rollback tool 2 falha, ctx.db delegation, default dbResolver |
| `errors.test.ts` | 10 | PII redaction NIF/IBAN via sanitizeHint, retryable flags, userMessage PT-PT, hierarchy |
| `tracing.test.ts` | 5 | Whitelist 12+8 keys, zero PII (householdId hashado), failed_tool_name |
| `prompts.test.ts` | 2 | Snapshot hash + versão v1 + 8 intents + 5 examples |
| `contract.test.ts` | 2 | TOOL_TO_INTENT_MAP coverage IntentSchema 8 valores + mock registry sanity |

**Total: 53 testes** (target ≥45 — EXCEEDS).

---

## Quality gates

5/5 obrigatórios pré-merge:

```bash
pnpm typecheck  # 9/9 packages exit 0
pnpm lint       # 9/9 packages 0 warnings
pnpm test       # 53 novos + 222+ existentes
pnpm build      # Next.js inclui via transpilePackages
pnpm check:rls  # 26 tabelas / 104 policies (NFR5 PRESERVADA)
```

**NFR5:** Esta story NÃO adiciona tabelas com `household_id` — invariante 26/104 preservada.
