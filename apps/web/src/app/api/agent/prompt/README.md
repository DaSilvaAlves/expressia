# `POST /api/agent/prompt` — Endpoint Canónico do Pipeline AI

> Story 2.6 — Consumidor canónico do pipeline AI multi-intent (Classifier → Planner → Executor).

## Endpoints

| Método | Path | Função |
|--------|------|--------|
| `POST` | `/api/agent/prompt` | Submete prompt ao pipeline (executed ou preview) |
| `POST` | `/api/agent/prompt/[runId]/confirm` | Confirma run em `pending_preview` (FR4) |
| `POST` | `/api/agent/prompt/[runId]/undo` | Reverte run em `success` dentro de 30s (FR6) |

## Request — POST /api/agent/prompt

**Headers (opcional):**
- `Idempotency-Key: <UUID>` — replay determinístico em janela de 24h (NFR9, D19)

**Body:**
```json
{ "prompt": "criar tarefa pagar luz amanhã 18€" }
```

Validação Zod: `prompt.min(1).max(2000)` (PT-PT).

## Response — Modos

### Mode `executed` (confidence ≥ 0.70)

HTTP 200:
```json
{
  "mode": "executed",
  "run_id": "uuid-...",
  "results": { "success": true, "results": [...] },
  "summary": "Executei 2 operação(ões) com sucesso. Tens 30 segundos para reverter.",
  "undo_url": "/api/agent/prompt/uuid-.../undo",
  "undo_expires_at": "2026-05-09T..."
}
```

### Mode `preview` (FR4 — confidence < 0.70)

HTTP 200:
```json
{
  "mode": "preview",
  "run_id": "uuid-...",
  "plan_summary": ["criar_tarefa (50%)", "criar_financa_variavel (45%)"],
  "confidence": 0.45,
  "confirmation_url": "/api/agent/prompt/uuid-.../confirm",
  "expires_at": "2026-05-09T..."
}
```

TTL para confirmar: 5 minutos (D20).

## Taxonomia de Erros

| HTTP | Code | Causa |
|------|------|-------|
| 400 | `VALIDATION_ERROR` | Body Zod inválido (vazio / >2000 chars / JSON malformado) |
| 400 | `CLASSIFIER_ERROR` | ClassifierError (4 subclasses da Story 2.4) |
| 400 | `PLANNER_ERROR` | PlannerError (5 subclasses da 2.5) |
| 400 | `EXECUTOR_VALIDATION_ERROR` | ExecutorValidationError (2.5) |
| 400 | `TOOL_PLAN_GATE_ERROR` | Plan gate rejeitou (2.3) |
| 401 | `AUTH_REQUIRED` | Sessão Supabase Auth inválida ou ausente |
| 404 | `HOUSEHOLD_NOT_FOUND` | User sem household activo |
| 404 | `RUN_NOT_FOUND` | Confirm/undo: run não existe (ou cross-household bloqueado por RLS) |
| 409 | `IDEMPOTENCY_IN_PROGRESS` | Run não-terminal com mesma key (NFR9) |
| 409 | `CONFIRM_INVALID_STATE` | Confirm: run não está em `pending_preview` |
| 409 | `CONFIRM_EXPIRED` | Confirm: TTL 5min passou |
| 409 | `UNDO_INVALID_STATE` | Undo: run não está em `success` |
| 409 | `UNDO_EXPIRED` | Undo: TTL 30s passou |
| 409 | `UNDO_ALREADY_REVERTED` | Undo: ops já revertidas (run-level ou row-level) |
| 429 | `RATE_LIMIT_EXCEEDED` | 10/min burst per household excedido (D17/D18) — header `Retry-After` |
| 429 | `QUOTA_EXCEEDED` | Quota mensal por plano excedida (NFR20) |
| 500 | `TOOL_EXECUTION_ERROR` | ToolError ou AtomicFailure (rollback aplicado) |
| 500 | `INTERNAL_ERROR` | Erro inesperado |

Shape padrão: `{ error: { code, message, timestamp, requestId, details? } }` (Architecture §7.3).

## Curl Examples

### Executed flow
```bash
curl -X POST http://localhost:3000/api/agent/prompt \
  -H "Content-Type: application/json" \
  -H "Cookie: sb-access-token=..." \
  -d '{"prompt":"criar tarefa pagar luz amanhã 18€"}'
```

### Preview flow (com confirm)
```bash
# 1. Submit ambíguo → recebe preview
RUN_ID=$(curl -s ... | jq -r '.run_id')

# 2. Confirma
curl -X POST "http://localhost:3000/api/agent/prompt/$RUN_ID/confirm" \
  -H "Cookie: sb-access-token=..."
```

### Undo
```bash
curl -X POST "http://localhost:3000/api/agent/prompt/$RUN_ID/undo" \
  -H "Cookie: sb-access-token=..."
# → { "reverted": true, "run_id": "...", "ops_count": 2 }
```

### Idempotent replay
```bash
# 1ª chamada — executa e guarda
curl ... -H "Idempotency-Key: $(uuidgen)" -d '{"prompt":"..."}'

# 2ª chamada com a mesma key dentro de 24h → retorna cached com X-Idempotent-Replay: true
```

## Integração com pipeline

```
Classifier (GPT-4o-mini, 2.4) → Planner (GPT-4o-mini, 2.5; Anthropic via factory) → Executor (executeAtomic, 2.3)
                                                              ↓
                                                          agent_runs (audit FR3)
                                                          agent_reverse_ops (undo FR6)
```

## Constraints

| Constraint | Valor | Source |
|-----------|-------|--------|
| Max prompt length | 2000 chars | Zod schema |
| Rate limit | 10 req/min/household | Architecture §7.2 |
| Idempotency window | 24h | D19 (Stripe-style) |
| Preview TTL | 5min | D20 + Architecture §4.4 |
| Undo TTL | 30s | FR6 + DEFAULT em `agent_reverse_ops` |
| Quota mensal | Per plan tier | NFR20 |

## Observability

OTel span `POST /api/agent/prompt` com attributes PII-safe (whitelist):
- `agent.prompt.household_id`
- `agent.prompt.intent_class`
- `agent.prompt.confidence_min`
- `agent.prompt.mode` (`'preview'` | `'executed'`)
- `agent.prompt.tool_count`
- `agent.prompt.duration_ms`
- `agent.prompt.classifier_model` + `agent.prompt.executor_model`
- `agent.prompt.cache_hit`

Sentry `captureException` em todos os error paths com `piiRedacted: true` (NFR12).

## Dependências

- `@meu-jarvis/auth` — Supabase Auth SSR
- `@meu-jarvis/classifier` — Story 2.4
- `@meu-jarvis/planner-executor` — Story 2.5
- `@meu-jarvis/tools` — Story 2.3 (executeAtomic + agent_reverse_ops)
- `@meu-jarvis/observability` — Story 1.7 (OTel + Sentry + Pino)
- `@meu-jarvis/db` — getDb() / getServiceDb() (RLS-aware)

## Testes

Suite mockable-only em `__tests__/`:
- `route.test.ts` (19 tests) — auth + validation + golden paths + error taxonomy + rate limit + quota + idempotency + audit + PII
- `confirm.test.ts` (5 tests) — confirm endpoint
- `undo.test.ts` (9 tests) — undo endpoint
- `idempotency.test.ts` (10 tests) — helper isolado
- `redaction.test.ts` (21 tests) — PII redaction layer 4

Total: **64 testes novos** (≥40 target da AC15).

## Trace

- Story 2.6 v1.2 — `docs/stories/active/2.6.endpoint-prompt-canonical-consumer.md`
- Architecture: §4.1 (pipeline 3 estágios), §4.4 (preview), §4.5 (undo), §7.1-7.3 (Routes + errors)
- PRD: FR1-FR6, NFR5, NFR9, NFR12, NFR13, NFR17, NFR19, NFR20
