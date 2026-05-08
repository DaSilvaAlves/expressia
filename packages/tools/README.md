# `@meu-jarvis/tools`

Tool Registry Foundation do Cérebro AI — contrato `ToolDefinition<I, O>`,
`ToolRegistry` singleton, `executeAtomic` com persistência declarativa de
`ReverseOpPayload` em `agent_reverse_ops` (FR6 — janela de undo de 30s),
taxonomia de erros PT-PT e OTel tracing whitelist (NFR12).

**Source-only** — sem build step. Consumido pelas Stories 2.5 (Planner+Executor)
e 2.6 (endpoint `/api/agent/prompt`).

> **Trace:** Story 2.3 (Foundation) | Architecture §4.3 (Tool Registry) +
> §4.5 (`agent_reverse_ops`) | PRD FR2 (multi-intent atómico) + FR4 (preview)
> + FR6 (undo 30s) | NFR5 (RLS) + NFR11 (lookup O(1)) + NFR12 (PII redaction)

---

## Exports principais

```ts
import {
  // Contratos
  ToolDefinition,
  ToolDomain,
  PlanTier,
  ToolExecutionContext,
  ReverseOpPayload,
  AtomicResult,
  AtomicFailure,
  AtomicToolInput,

  // Serialização
  serializeReverseOp,
  deserializeReverseOp,
  ReverseOpPayloadSchema,
  COMPOSITE_REVERSE_OP_MAX_OPS,

  // Registry
  ToolRegistry,
  toolRegistry,         // singleton — usar em produção
  AnthropicToolDefinition,

  // Execução atómica
  executeAtomic,
  AtomicOutcome,

  // Erros
  ToolError,
  ToolValidationError,
  ToolExecutionError,
  ToolTransactionError,
  ToolNotFoundError,
  DuplicateToolError,
  ToolPlanGateError,

  // Tracing constants (read-only, para Grafana dashboards)
  TOOL_SPAN_ATTRIBUTE_KEYS,
} from '@meu-jarvis/tools';
```

**Não exportados** (intencionalmente privados ao package):
- `withToolSpan`, `withAtomicSpan`, `annotateToolMetrics`, `annotateAtomicMetrics`
  — wrappers de OTel usados internamente por `executeAtomic`.
- `redactToolInputForLog` — helper interno para logs Pino.
- `__fixtures__/mock-tools` — apenas para testes unitários.
- `ToolRegistry.clear()` — exposto na class mas marcado `@internal`.

---

## Conceito

```
┌─────────────────────────────────────────────────────────────────┐
│ ToolRegistry (singleton) — registo central de todas as tools   │
│                                                                 │
│  register(tool: ToolDefinition<I,O>)  ──→ Map<name, definition> │
│  get(name) ─────────────────────────────→ O(1) lookup           │
│  getByDomain('finance') ────────────────→ filtra por domínio    │
│  getAnthropicToolDefinitions() ─────────→ JSON Schema 7 array   │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│ executeAtomic(tools[], ctx) — orquestra N tools sequencialmente │
│                                                                 │
│  ctx.db.transaction(async tx => {                               │
│    for cada (definition, input):                                │
│      1. inputSchema.parse(input)        — Zod validation        │
│      2. definition.execute(input, ctxWithTx)  — efeito          │
│      3. outputSchema.parse(output)                              │
│      4. definition.reverse(output, ctxWithTx) — declarativo     │
│      5. INSERT INTO agent_reverse_ops VALUES (..., now() + 30s) │
│    return results[]                                              │
│  })                                                              │
│                                                                 │
│  Em falha de qualquer tool: throw → rollback automático →       │
│  AtomicFailure { success: false, rolledBack: true }             │
└─────────────────────────────────────────────────────────────────┘
```

---

## Como usar `executeAtomic`

```ts
import { executeAtomic, toolRegistry } from '@meu-jarvis/tools';
import { getDb } from '@meu-jarvis/db';

// 1. As tools concretas (Stories 2.6+) registam-se no startup do módulo:
//    toolRegistry.register(criarTarefa);
//    toolRegistry.register(criarFinancaVariavel);
//    ...

// 2. O Planner+Executor (Story 2.5) constrói a lista a partir do
//    output do Sonnet `tool_calls` e invoca:
const outcome = await executeAtomic(
  [
    { definition: toolRegistry.get('criar_tarefa'), input: { titulo: 'comprar leite' } },
    { definition: toolRegistry.get('criar_financa_variavel'), input: { montanteCents: 870 /* ... */ } },
  ],
  {
    householdId: ctxFromJWT.householdId,
    userId: ctxFromJWT.userId,
    db: getDb(),                  // SEMPRE getDb() — RLS authenticated
    traceId: 'req_abc123',
    runId: agentRunRecord.id,
  },
);

if (outcome.success) {
  // outcome.results: [{ toolName, output, reverseOpId }, ...]
  // Cada reverseOpId é o UUID de uma row em agent_reverse_ops com
  // expires_at = now() + 30s. O FR6 endpoint cancelar_ultima usa estes.
} else {
  // outcome.failedToolName, outcome.error (ToolError), outcome.rolledBack === true
  // Nada persiste — tanto entidades como reverse_ops foram revertidos.
}
```

> **CRÍTICO (NFR5 RLS):** o `ctx.db` DEVE ser sempre `getDb()` (cliente
> `authenticated` com JWT). NUNCA `getServiceDb()` — esse ignora RLS e
> permitiria cross-household writes. `executeAtomic` não cria clientes
> internamente; usa apenas o que recebe via `ctx`.

---

## Como criar uma tool concreta (referência para Stories 2.6+)

```ts
// packages/tools-tasks/src/criar-tarefa.ts (Story 2.6, exemplo conceptual)
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import type { ToolDefinition } from '@meu-jarvis/tools';

const CriarTarefaInputSchema = z.object({
  titulo: z.string().min(1).max(200),
  prazo: z.string().date().optional(),
  prioridade: z.enum(['baixa', 'media', 'alta']).optional(),
});

const CriarTarefaOutputSchema = z.object({
  id: z.string().uuid(),
  titulo: z.string(),
});

export const criarTarefa: ToolDefinition<
  z.infer<typeof CriarTarefaInputSchema>,
  z.infer<typeof CriarTarefaOutputSchema>
> = {
  name: 'criar_tarefa',
  domain: 'tasks',
  description: 'Cria uma nova tarefa no sistema do utilizador. Usar quando o utilizador pede para criar/adicionar/registar uma tarefa, lembrete ou item to-do.',
  inputSchema: CriarTarefaInputSchema,
  outputSchema: CriarTarefaOutputSchema,
  estimatedTokens: 80,

  preview(input) {
    return `Vou criar a tarefa "${input.titulo}".`;
  },

  async execute(input, ctx) {
    // ctx.db é o cliente da transacção — herda rollback automático
    const result = await ctx.db.execute(sql`
      insert into tasks (household_id, user_id, titulo, prazo, prioridade)
      values (${ctx.householdId}, ${ctx.userId}, ${input.titulo}, ${input.prazo ?? null}, ${input.prioridade ?? 'media'})
      returning id, titulo
    `);
    return result[0] as { id: string; titulo: string };
  },

  async reverse(output) {
    return { kind: 'delete_row', table: 'tasks', id: output.id };
  },
};

// No barrel da tool package, registar no startup:
// toolRegistry.register(criarTarefa);
```

---

## `ReverseOpPayload` — variantes

| Variante | Uso | Schema |
|---|---|---|
| `delete_row` | Tool fez INSERT → undo via DELETE | `{ kind, table: string, id: uuid }` |
| `restore_row` | Tool fez UPDATE → undo restaurando snapshot | `{ kind, table, id, snapshot: Record<string, unknown> }` |
| `composite` | Tool fez múltiplos efeitos → lista aninhada | `{ kind, ops: ReverseOpPayload[] }` (max 10 per-level recursivo) |

**Guard `composite`** — limite aplicado **per-level recursivamente** (não top-level only):

```ts
// OK (10 ops top-level):
{ kind: 'composite', ops: [10 × delete_row] }

// OK (1 nested composite com 10 ops):
{ kind: 'composite', ops: [{ kind: 'composite', ops: [10 × delete_row] }] }

// ERRO ToolValidationError (11 ops):
{ kind: 'composite', ops: [11 × delete_row] }

// ERRO ToolValidationError (nested oversize):
{ kind: 'composite', ops: [{ kind: 'composite', ops: [11 × delete_row] }] }
```

Razão da escolha per-level: top-level only permitiria `10^depth` ops em
aninhamento, ex: 1000 ops em 3 níveis. Per-level mantém o payload bounded
(uso real esperado ≤2 níveis, ex: `criar_parcelada` cria parent + 12 child
installments → ~13 ops num único composite, sem aninhamento adicional).

---

## Taxonomia de erros

| Classe | Retryable | Causa |
|---|---|---|
| `ToolValidationError` | NÃO | Input ou output Zod inválido |
| `ToolExecutionError` | NÃO | `tool.execute()` lançou (causa determinística) |
| `ToolTransactionError` | **SIM** | Falha transitória da transacção (deadlock, connection drop) |
| `ToolNotFoundError` | NÃO | `registry.get(name)` para tool não-registada |
| `DuplicateToolError` | NÃO | `registry.register(tool)` com nome já em uso por outra tool |
| `ToolPlanGateError` | NÃO | Plano do household insuficiente para a tool |

Todos os erros têm:
- `message`: técnico, sem PII (logs/Sentry)
- `userMessage`: PT-PT, neutro de implementação (UI Story 2.6)
- `retryable: boolean`: governa retry strategy do Planner

### `ToolPlanGateError` — locus de invocação

Esta classe é **DEFINIDA** neste package mas **INVOCADA pela Story 2.5**
(Planner+Executor) ANTES de chamar `executeAtomic`. O Planner verifica
`tool.requiredPlan` contra o plano do household no contexto e lança esta
excepção se o gate não passa.

Story 2.3 NÃO contém lógica `assertPlanAllowed` — fornece apenas a classe
+ teste de instanciação para que o Planner possa importar e fazer
`instanceof` checks no `error.retryable`/`userMessage`.

---

## OTel tracing — whitelist `TOOL_SPAN_ATTRIBUTE_KEYS`

`executeAtomic` cria 2 tipos de spans:

### `agent.tool.atomic` (1 por chamada de `executeAtomic`)

| Attribute | Tipo | Uso |
|---|---|---|
| `tool.atomic.tool_count` | number | quantas tools no batch |
| `tool.atomic.run_id` | string (uuid) | FK para `agent_runs.id` |
| `tool.atomic.success` | boolean | resultado final |
| `tool.atomic.rolled_back` | boolean | true se houve falha controlada |

### `agent.tool.call` (1 por tool invocada)

| Attribute | Tipo | Uso |
|---|---|---|
| `tool.name` | string | identificador snake_case |
| `tool.domain` | string | tasks/finance/query/system |
| `tool.duration_ms` | number | tempo gasto pelo execute |
| `tool.success` | boolean | resultado da tool individual |
| `tool.household_hash` | string (sha256) | correlação sem PII |
| `tool.trace_id` | string | trace ID OTel |

**Garantia anti-PII (NFR12):** os spans NUNCA incluem `tool.input`, `tool.output`,
`tool.snapshot`, `tool.prompt`, `tool.message`. Validação por testes em
`tracing.test.ts` — qualquer adição de chave nova requer extensão da whitelist.

---

## Limitação cross-package conhecida

O package **NÃO importa** o table object `agentReverseOps` de
`@meu-jarvis/db`. O TypeScript cross-package não consegue resolver os
`paths` aliases internos (`@/*`) do package db (mesma limitação documentada
em `packages/agent/src/contracts.ts`). Em vez disso, `executeAtomic` faz o
INSERT em `agent_reverse_ops` via SQL puro com Drizzle's `sql` template:

```ts
await tx.execute(sql`
  insert into agent_reverse_ops (agent_run_id, household_id, reverse_op, expires_at)
  values (${runId}, ${householdId}, ${serialized}::jsonb, now() + interval '30 seconds')
  returning id
`);
```

A `expires_at` é calculada no servidor Postgres (não em JavaScript) para
evitar drift de clock entre o Node.js e o DB — ver AC6.

---

## Testes

Cobertura: **57 testes** (target ≥30) em 5 ficheiros, todos com mocks
Vitest — sem dependência de Anthropic/OpenAI/Supabase production.

| Ficheiro | Testes | Foco |
|---|---|---|
| `contracts.test.ts` | 16 | Round-trip serialize/deserialize, composite guard, enums |
| `registry.test.ts` | 12 | register/get/list/getByDomain, idempotência por referência, getAnthropicToolDefinitions |
| `atomic.test.ts` | 13 | 1 tool / 3 tools sucesso, rollback (4 cenários), persistência SQL, ctxWithTx invariant, ToolPlanGateError propagação |
| `errors.test.ts` | 8 | 6 subclasses, retryable flags, PT-PT userMessage, PII guard |
| `tracing.test.ts` | 8 | Whitelist 10 keys, zero PII, household_hash, span ERROR |

### Bonus opcional (Story 1.4 disponível)

`__tests__/integration/atomic-rls.test.ts` (não implementado nesta story
para evitar scope creep, mas a estrutura está pronta) com Testcontainers
Postgres efémero validaria:
- `executeAtomic` persiste `agent_reverse_ops` com `household_id` correcto.
- Tentativa cross-household bloqueada por RLS.
- `expires_at` ~30s no futuro (±5s tolerância).

---

## Cleanup de `agent_reverse_ops` expirados

**Out-of-scope para esta story.** O cleanup periódico de rows com
`expires_at < now() - interval '1 hour'` é responsabilidade de um job
Inngest a implementar em story futura (provavelmente integrada com a
Story 2.7 quando `cancelar_ultima` for implementado).

TODO documentado também em `atomic.ts`.
