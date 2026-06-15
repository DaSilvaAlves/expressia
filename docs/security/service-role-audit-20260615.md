# Auditoria — usos de `getServiceDb()` (service_role / RLS-bypass)

| Campo | Valor |
|-------|-------|
| Autor | @aiox-master (Orion) |
| Data | 15/06/2026 |
| Pedido por | Follow-up [AGENTE] do handoff `mj-handoff-followups-soft-launch-20260615` |
| Âmbito | Todos os call sites reais de `getServiceDb()` no código de produção |
| Veredicto | **LIMPO** — nenhum uso legacy/indevido; todos justificados e scoped |
| Severidade | informativo (baseline de higiene contínua) |

---

## 1. Contexto

`getServiceDb()` (`packages/db/src/client.ts:152`) liga como role `service_role`
e **IGNORA RLS por design**. Por isso só pode ser usado em código onde o
isolamento por household é garantido por outro mecanismo (job sistémico sem JWT,
ou autorização app-enforced antes do bypass). Esta auditoria varre todos os
call sites reais e classifica cada um.

Distinção importante: a maioria das ocorrências de `getServiceDb` no código são
**comentários a proibir o seu uso** (`NUNCA getServiceDb()`) ou **mocks de
teste** — não são invocações. Abaixo só os call sites de execução real.

## 2. Call sites reais (invocações)

| # | Ficheiro | Linha | Classe | Veredicto |
|---|----------|-------|--------|-----------|
| 1 | `apps/web/src/lib/inngest/functions/generate-recurring-tasks.ts` | 97, 242 | Job Inngest | ✅ justificado |
| 2 | `apps/web/src/lib/inngest/functions/generate-finance-recurrences.ts` | 107, 238 | Job Inngest | ✅ justificado |
| 3 | `apps/web/src/lib/inngest/functions/cleanup-expired-reverse-ops.ts` | 55 | Job Inngest | ✅ justificado |
| 4 | `apps/web/src/lib/agent/audit-log.ts` (`incrementQuota`) | 209 | Request path | ✅ justificado + scoped |
| 5 | `apps/web/src/app/api/agent/prompt/[runId]/undo/route.ts` | 183 | Request path | ✅ justificado + scoped |

(`db-shim.ts:52` é o wrapper de re-export; `client.ts:152` é a definição;
`packages/db-test/**` são scripts de diagnóstico, não produção.)

## 3. Análise por classe

### 3.1 Jobs Inngest (#1–#3)

Os três crons sistémicos (`cleanupExpiredReverseOps`, `generateRecurringTasks`,
`generateFinanceRecurrences`) correm **sem JWT de utilizador** e, por desenho,
iteram sobre **todos os households**. Não há contexto de tenant a respeitar — o
service_role é a escolha correta. Confirmado em `docs/runbooks/inngest-*`.

### 3.2 `incrementQuota` (#4)

Usa service_role **obrigatoriamente** porque as policies RLS em
`0001_rls_policies.sql:353-362` bloqueiam INSERT/UPDATE em `agent_quotas` para
`authenticated` (`agent_quotas_insert_blocked` / `agent_quotas_update_blocked`).
Pre-2.9 falhava silenciosamente em prod (hard-stop NFR20 não-funcional). O UPSERT
está scoped a `where h.id = ${householdId}`, com `householdId` derivado
server-side do contexto autenticado. Blast radius mínimo (só incrementa um
contador). Trace: Story 2.9 D50.

### 3.3 Undo de reverse ops (#5)

O caso mais sensível (aplica mutações reais). A ordem de autorização é correta e
**app-enforced ANTES do bypass**:

1. `getUser()` — autentica.
2. `resolveHouseholdId(user.id)` — resolve o household do utilizador.
3. Lookup do run via **`getDb()`** (RLS-aware) filtrado por
   `household_id = ${userHouseholdId}` — cross-household devolve 404 (SEC-1-F3).
4. Só **depois** de confirmar a posse é que `getServiceDb()` aplica os reverse
   ops, todos scoped a `runId` + `run.household_id`.
5. Tabelas-alvo dos reverse ops são whitelisted (`ALLOWED_REVERSE_TABLES`) —
   sem SQL injection via campo `table`.

Sem o filtro do passo 3, um membro do household B reverteria mutações do
household A. O filtro existe e está testado. Trace: SEC-1-F3, NFR9.

## 4. Conclusão

Nenhum uso de `getServiceDb()` fora dos jobs controlados está indevido. Os dois
usos em request path têm autorização household app-enforced antes do bypass RLS,
consistente com a lição central do projeto (ADR-003: a RLS é inerte em runtime;
a 1.ª rede app-enforced é a que protege). Não há ação requerida.

### Recomendação de higiene contínua

Adicionar uma verificação leve ao gate de revisão (não automatizada já): qualquer
novo call site de `getServiceDb()` em `apps/web/src/app/**` (request path) deve
ser acompanhado de um filtro `household_id` app-enforced **antes** da invocação,
e referenciado neste documento. Os jobs Inngest e migrations/scripts continuam
isentos.
