# Story SEC-3: RLS enforced em runtime — Fase 2 domínio Finanças (12 route handlers)

> **ID:** `SEC-3` (segurança transversal — Fase 2 do ADR-003, continuação de SEC-2).
> Não pertence a nenhum epic numerado — é uma story de segurança cross-epic.
> **Depende de:** SEC-2 (Done, commit `98c8176`), wrapper `withHousehold` em produção.

## Status

Done v1.1-ARCH-APPROVED (PASS 9,6/10, confiança ALTA — @architect Aria. Gate adversarial: 8/8 focos de segurança limpos por varredura independente; 9/9 ACs MET; 3/3 [DEV-DECISION] ratificadas; PO-FIX-2 honrado 8/8 handlers de mutação; PO-OBS implementada e provada (leak de globais fechado). 6/6 gates re-corridos: lint exit 0, typecheck exit 0, web 1068 pass + 1 flaky calendário pré-existente (não-finanças, não-regressão), db-test 181 pass com rls-application 15/15, build exit 0, check:rls exit 0. Sem migration nova. Gate file: `docs/qa/gates/SEC-3-architect-gate.md`. Pronto para `@devops *push`.)

Ready for Review v1.0-DEV (12 handlers migrados para `withHousehold`; 12 mocks de teste actualizados; PO-OBS implementada — gate estendido a `accounts` + `categories` globais; 6/6 gates GREEN. — @dev Dex)

Ready v0.2-PO (GO 9,0/10 — @po Pax. As 4 divergências do @sm re-verificadas byte-a-byte e confirmadas. PO-FIX-2: `insertAuditLog` permanece best-effort FORA do `withHousehold` (AC7 [AUTO-DECISION] original era incoerente com o código — geraria regressão de semântica + 12 decisões inconsistentes). 1 PO-OBS não-bloqueante sobre cobertura do gate (`accounts`/`categories`). Ver Change Log + tabela de Divergências.)

## Executor Assignment

```
executor: "@dev"
quality_gate: "@architect"
quality_gate_tools: ["lint", "typecheck", "test", "build", "check:rls"]
```

## Story

**As a** engenheiro/product owner da Expressia,
**I want** que os 12 route handlers `/api/financas/*` utilizem `withHousehold(auth, fn)` em vez de `getDb()` directo,
**so that** a 2.ª rede de segurança (RLS activa em runtime via role `authenticated`) proteja o domínio financeiro — o mais sensível do produto (IBAN, saldos, histórico de transacções) — com a mesma defense-in-depth que o piloto de tarefas já estabeleceu na SEC-2.

## Contexto e âmbito (ler antes das ACs — OBRIGATÓRIO)

### Ponto de partida — o que já existe

A SEC-2 (commit `98c8176`) entregou em produção:
- `withHousehold<T>(auth, fn)` exportado em `packages/db/src/client.ts`, roteado por `apps/web/src/lib/agent/db-shim.ts:79-88` (re-export lazy que evita o break tsc cross-package, ver `db-shim.ts:5-18`).
- Gate de aplicação real: `packages/db-test/src/tests/rls-application.test.ts` (9 testes) — já cobre `tasks` e `transactions` (AC-C1/C2/E3 da SEC-2). **Este teste NÃO precisa ser modificado para esta story.**
- Piloto GET `/api/tasks` migrado — é o **template canónico** a replicar (`apps/web/src/app/api/tasks/route.ts:89-99`).
- App-enforced (filtro `household_id` SEC-1) intacto e **NUNCA removido** — `withHousehold` é a 2.ª rede, não substitui a 1.ª.

### O que esta story faz (Fase 2 do ADR-003, domínio Finanças)

Migrar os 12 route handlers `/api/financas/*` de `getDb()` → `withHousehold(auth, fn)`:

| # | Ficheiro | Métodos |
|---|----------|---------|
| 1 | `apps/web/src/app/api/financas/contas/route.ts` | GET, POST |
| 2 | `apps/web/src/app/api/financas/contas/[id]/route.ts` | GET, PATCH, DELETE |
| 3 | `apps/web/src/app/api/financas/cartoes/route.ts` | GET, POST |
| 4 | `apps/web/src/app/api/financas/cartoes/[id]/route.ts` | GET, PATCH, DELETE |
| 5 | `apps/web/src/app/api/financas/transacoes/route.ts` | GET, POST |
| 6 | `apps/web/src/app/api/financas/transacoes/[id]/route.ts` | GET, PATCH, DELETE |
| 7 | `apps/web/src/app/api/financas/categorias/route.ts` | GET, POST |
| 8 | `apps/web/src/app/api/financas/categorias/[id]/route.ts` | GET, PATCH, DELETE |
| 9 | `apps/web/src/app/api/financas/prestacoes/route.ts` | GET, POST |
| 10 | `apps/web/src/app/api/financas/prestacoes/[id]/route.ts` | GET, DELETE |
| 11 | `apps/web/src/app/api/financas/recorrencias/route.ts` | GET, POST |
| 12 | `apps/web/src/app/api/financas/recorrencias/[id]/route.ts` | GET, PATCH, DELETE |

**Todos os 12 ficheiros importam `{ getDb }` de `@/lib/agent/db-shim` e todos os handlers têm `auth = await requireAuth(span)` (verificado byte-a-byte — ver Divergências ao fundo).**

### Fora de âmbito (stories futuras — só referenciadas, NÃO implementadas aqui)

- SSR pages `(app)/financas/*` (RSC que possam chamar `getDb()`)
- Helpers em `lib/finance/*` (se existirem funções puras que recebem `getDb()` externamente)
- Rotas `/api/visao/financas-*` (domínio separado — SEC-4+)
- Jobs Inngest de finanças (usam `getServiceDb()` / `service_role` — por design, intocáveis)
- `getDb()` no POST `/api/tasks` (fora do âmbito de SEC-3)

---

## Acceptance Criteria

### AC1 — Migração dos 12 handlers para `withHousehold`

Cada um dos 12 ficheiros acima passa a envolver as suas queries `getDb()` em `withHousehold(auth, (tx) => ...)`, passando `tx` em vez de `getDb()` às queries/helpers.

O padrão canónico (conforme `apps/web/src/app/api/tasks/route.ts:89-99`) é:
```typescript
const result = await withHousehold(
  { userId: auth.userId, householdId: auth.householdId },
  (tx) => minhaQuery({ ...params, db: tx }),
);
```

`auth` em todos os handlers vem de `auth = await requireAuth(span)` — já presente em todos os 12 ficheiros (verificado byte-a-byte — ver Divergências).

### AC2 — Filtros app-enforced (SEC-1) MANTIDOS INALTERADOS

O filtro `household_id` explícito nas queries (defesa aplicacional, 1.ª rede — SEC-1) é **mantido em todas as queries** dentro de cada callback. Nenhum filtro removido. Exemplos verificados:

- `contas/route.ts:71` — `and household_id = ${auth.householdId}::uuid`
- `transacoes/route.ts:143` — `sql\`household_id = ${auth.householdId}::uuid\``
- `categorias/route.ts:90` — `sql\`(household_id = ${auth.householdId}::uuid or household_id is null)\`` (globais — mantida a excepção deliberada AC-E1 de SEC-1)

Qualquer diff que remova um filtro `household_id` é uma violação bloqueante.

### AC3 — `getServiceDb()` / jobs Inngest NÃO tocados

Nenhum dos 12 handlers usa `getServiceDb()` (verificado — todos importam apenas `{ getDb }` e nenhum importa `getServiceDb`). Esta AC confirma que a migração não toca em:
- Jobs Inngest de finanças (`apps/web/src/inngest/functions/financas-*.ts` ou equivalentes — usam `getServiceDb()` por design)
- Migrations e scripts admin

### AC4 — Gate de aplicação real cobre finanças

O teste `packages/db-test/src/tests/rls-application.test.ts` já cobre `transactions` (AC-C2 da SEC-2). Esta story verifica que o gate existente continua VERDE após a migração. **Não é necessário adicionar novos testes de aplicação** — a mecânica é idêntica; o `withHousehold` já estava provado. Contudo, se o @dev detectar que algum handler de finanças introduz uma query que escapa da transação (edge case não coberto), deve adicionar um teste de aplicação específico e documentá-lo como [DEV-DECISION].

> **[PO-OBS — cobertura do gate, verificada byte-a-byte]** Confirmado independentemente: `rls-application.test.ts` cobre **apenas `tasks` e `transactions`** (3 `describe`: tasks, transactions, service_role bypass). NÃO cobre `accounts`, `cards`, `installments`, `recurrences` nem `categories` (esta última com a excepção `OR household_id IS NULL` — a mais sensível a um leak de globais). A story declara o gate como suficiente porque a mecânica `withHousehold` é a mesma para todas as tabelas com `household_id` + 4 policies (verificado por `pnpm check:rls`). **Concordo que NÃO é bloqueante** — a prova de isolamento é da *mecânica*, não tabela-a-tabela. Porém, **RECOMENDO ao @dev (não-mandatório, [DEV-DECISION] se aceite)** adicionar pelo menos asserções de aplicação para `accounts` e `categories` (globais) ao `rls-application.test.ts`, reutilizando `insertAccount`/`seedTwoHouseholds` já no harness. A tabela `categories` com `OR household_id IS NULL` é o único caso onde a policy diverge do template padrão (`categories_select_global_or_member`) — provar que um household não vê categorias *per-household* de outro (só as globais) fecharia o único risco residual desta story. Custo marginal (fixtures existem).

### AC5 — Sub-queries FK (POST/PATCH) protegidas dentro da transação

Os handlers POST/PATCH que fazem sub-queries FK para validar pertença ao household (`account_id`, `card_id`, `category_id`) devem **todos correr dentro da mesma transação** `withHousehold`. Isso garante que as validações FK e a escrita principal são atómicas (isolamento consistente).

Exemplos a cobrir:
- `cartoes/route.ts` POST — verifica `account_id` pertence ao household antes do INSERT `cards` (linha 153-163)
- `transacoes/route.ts` POST — verifica `account_id`/`card_id`/`category_id` (linhas 239-272)
- `prestacoes/route.ts` POST — verifica `card_id` e `category_id` (linhas 141-161)
- `recorrencias/route.ts` POST e `[id]/route.ts` PATCH — verificam `account_id`/`card_id`/`category_id`

Todas estas sub-queries passam a receber `tx` (não `getDb()`), garantindo que correm no mesmo contexto RLS.

### AC6 — Semântica transaccional dos handlers com transacções aninhadas

Dois handlers já usam `db.transaction(async (tx) => {...})` internamente:

**`prestacoes/route.ts` POST (linha 172):** cria atomicamente 1 `installment` + N `transactions` numa transação explícita do Drizzle (`db.transaction()`). A migração envolve o handler inteiro em `withHousehold(auth, (tx) => ...)`. Dentro desse callback, a chamada a `tx.transaction(async (innerTx) => {...})` é uma **transação aninhada** (savepoint em Postgres). O comportamento é correcto — o `innerTx` herda o contexto RLS (role `authenticated` + claims) da transação exterior. Não há perda de atomicidade.

**`prestacoes/[id]/route.ts` DELETE (linha 141):** idem — usa `db.transaction()` para apagar `transactions` antes de `installments` (ordem obrigatória pelo CHECK `transactions_installment_index_coherent`). Migrar para `withHousehold(auth, (tx) => tx.transaction(...))`.

O @dev deve documentar o comportamento de savepoint Postgres em [DEV-DECISION] se necessário.

### AC7 — `insertAuditLog` permanece best-effort FORA do `withHousehold` [PO-FIX-2]

> **[PO-FIX-2 — verificação byte-a-byte do padrão real de `insertAuditLog`]**
> O @sm propôs originalmente [AUTO-DECISION] "manter o audit log dentro da transação (`db: tx`)". A verificação do código real (02/06/2026) mostra que essa decisão é **incoerente com o padrão estabelecido nos 12 handlers** e introduziria regressão de comportamento. Factos verificados:
>
> 1. Em **TODOS** os handlers de mutação de finanças, o `insertAuditLog(...)` corre num `try/catch` **best-effort separado e POSTERIOR** ao bloco da operação principal — usando o mesmo `const db = getDb()` do topo do `try` (ex.: `contas/route.ts:133-149` POST; `contas/[id]/route.ts:161-173` PATCH e `234-245` DELETE; `cartoes/[id]/route.ts:248-259` DELETE; `prestacoes/route.ts:224-240` POST; `prestacoes/[id]/route.ts:154-165` DELETE). O catch só faz `log.warn` — **nunca propaga** (a falha de audit não afecta a operação principal).
> 2. Nos dois handlers com transacção (`prestacoes` POST e DELETE), o `insertAuditLog` está **deliberadamente FORA** do `db.transaction()` (`prestacoes/route.ts:225` corre DEPOIS de `result` em `:222`; `prestacoes/[id]/route.ts:155` corre DEPOIS do `transactionsDeleted` em `:152`). Movê-lo para dentro inverteria a semântica imutável de prestações e tornaria o audit log capaz de reverter a operação principal — exactamente o oposto de "best-effort".
> 3. `insertAuditLog(params: AuditLogParams)` aceita `db: DbShim` (`audit.ts:82`) — pode receber `tx` ou `getDb()` indistintamente.
>
> **Decisão PO-FIX-2 (mandatória, não overridable sem nova validação):** O `insertAuditLog` **MANTÉM-SE no bloco `try/catch` best-effort FORA do callback `withHousehold`**, recebendo `db: getDb()`. Rationale:
> - **Preserva a semântica best-effort actual** (1.ª regra do projecto: "Done com mocks ≠ funciona", mas também "menor mudança que satisfaz a AC"). O audit log nunca deve poder reverter uma operação financeira já comprometida.
> - O audit log via `getDb()` está protegido pelo filtro `household_id` app-enforced (SEC-1) no próprio INSERT (`audit.ts:146-157` passa `householdId` bound) — não há risco cross-tenant.
> - Evita 12 decisões inconsistentes do @dev e elimina o risco de um handler reverter a operação principal por falha de audit.
>
> **Consequência mecânica:** o `const db = getDb()` do topo de cada handler de mutação **PERMANECE** (não é removido como T1.4 sugeria para os GET puros) — é necessário para o `insertAuditLog` best-effort. Apenas a operação principal (SELECT/INSERT/UPDATE/DELETE + sub-queries FK) migra para `withHousehold(auth, (tx) => ...)`.

Em todos os handlers, após a migração:
- A **operação principal** (queries de domínio + sub-queries FK + `db.transaction` interno onde existe) corre dentro de `withHousehold(auth, (tx) => ...)` recebendo `tx`.
- O **`insertAuditLog`** permanece no `try/catch` best-effort exterior, recebendo `db: getDb()` (comportamento actual inalterado).

### AC8 — Importação de `withHousehold` via `db-shim.ts`

À semelhança do piloto de tarefas, todos os handlers devem importar `withHousehold` de `@/lib/agent/db-shim` (não directamente de `@meu-jarvis/db/client`), para não reintroduzir o break tsc cross-package documentado em `db-shim.ts:5-18`.

```typescript
import { getDb, withHousehold } from '@/lib/agent/db-shim';
```

### AC9 — Gates de qualidade TODOS VERDES

`pnpm lint` · `pnpm typecheck` · `pnpm test` (web + db-test Docker) · `pnpm build` · `pnpm check:rls` — todos passam sem erros.

Sem migration SQL nova (as 104 policies existem desde `0001_rls_policies.sql` — intactas).

---

## Tasks / Subtasks

- [x] **T1 — Migrar `contas/route.ts`** (GET, POST) (AC1, AC2, AC7, AC8)
  - [x] T1.1 Adicionar `withHousehold` ao import de `@/lib/agent/db-shim`.
  - [x] T1.2 Handler GET: envolvido em `withHousehold`. `const db = getDb()` removido (GET sem audit log).
  - [x] T1.3 Handler POST: INSERT `accounts` em `withHousehold`. `insertAuditLog` permanece FORA com `db: getDb()` (PO-FIX-2). Filtro `household_id` mantido.
  - [x] T1.4 POST: `const db = getDb()` MANTIDO (audit best-effort). GET sem audit: `getDb()` removido.

- [x] **T2 — Migrar `contas/[id]/route.ts`** (GET, PATCH, DELETE) (AC1, AC2, AC5, AC7, AC8)
  - [x] T2.1 GET: SELECT em `withHousehold`.
  - [x] T2.2 PATCH: UPDATE em `withHousehold` (sem sub-queries FK neste handler — `account_type` é enum, não FK).
  - [x] T2.3 DELETE: `resolveHouseholdRole` FORA do `withHousehold` (T2.3a [AUTO-DECISION] aceite) + UPDATE dentro.

- [x] **T3 — Migrar `cartoes/route.ts`** (GET, POST) (AC1, AC2, AC5, AC7, AC8)
  - [x] T3.1 GET: SELECT em `withHousehold`.
  - [x] T3.2 POST: sub-query FK `accounts` + INSERT `cards` no mesmo `tx` (retorno discriminado — D-SEC3.2).

- [x] **T4 — Migrar `cartoes/[id]/route.ts`** (GET, PATCH, DELETE) (AC1, AC2, AC5, AC7, AC8)
  - [x] T4.1 GET: SELECT em `withHousehold`.
  - [x] T4.2 PATCH: UPDATE em `withHousehold` (sem sub-queries FK — `account_id` IMMUTABLE).
  - [x] T4.3 DELETE: `resolveHouseholdRole` FORA (T2.3a) + soft-delete UPDATE dentro.

- [x] **T5 — Migrar `transacoes/route.ts`** (GET, POST) (AC1, AC2, AC5, AC6, AC7, AC8)
  - [x] T5.1 GET: SELECT (keyset cursor + condições) em `withHousehold`.
  - [x] T5.2 POST: sub-queries FK `accounts`/`cards`/`categories` + INSERT no mesmo `tx` (retorno discriminado — D-SEC3.2).

- [x] **T6 — Migrar `transacoes/[id]/route.ts`** (GET, PATCH, DELETE) (AC1, AC2, AC5, AC6, AC7, AC8)
  - [x] T6.1 GET: SELECT em `withHousehold`.
  - [x] T6.2 PATCH: SELECT prévio (scope) + sub-queries FK + UPDATE no mesmo `tx` (retorno discriminado).
  - [x] T6.3 DELETE: SELECT prévio + DELETE no mesmo `tx` (retorno discriminado).

- [x] **T7 — Migrar `categorias/route.ts`** (GET, POST) (AC1, AC2, AC5, AC7, AC8)
  - [x] T7.1 GET: SELECT em `withHousehold`. Filtro `(household_id = X OR household_id IS NULL)` INTACTO.
  - [x] T7.2 POST: sub-query FK `parent_id` + INSERT no mesmo `tx` (retorno discriminado).

- [x] **T8 — Migrar `categorias/[id]/route.ts`** (GET, PATCH, DELETE) (AC1, AC2, AC5, AC7, AC8)
  - [x] T8.1 GET: SELECT em `withHousehold` (filtro `OR NULL` mantido).
  - [x] T8.2 PATCH: self-check `parent_id === id` (puro, fora) + sub-query FK `parent_id` + UPDATE no `tx`.
  - [x] T8.3 DELETE: soft-delete UPDATE em `withHousehold` (filtro estrito — globais read-only).

- [x] **T9 — Migrar `prestacoes/route.ts`** (GET, POST) (AC1, AC2, AC5, AC6, AC7, AC8)
  - [x] T9.1 GET: SELECT em `withHousehold`.
  - [x] T9.2 POST (transação aninhada — AC6): sub-queries FK + `tx.transaction()` (savepoint) dentro de `withHousehold` (D-SEC3.3).

- [x] **T10 — Migrar `prestacoes/[id]/route.ts`** (GET, DELETE) (AC1, AC2, AC6, AC7, AC8)
  - [x] T10.1 GET: SELECT em `withHousehold`.
  - [x] T10.2 DELETE (transação aninhada — AC6): SELECT prévio + `tx.transaction()` (savepoint, ordem de delete preservada) dentro de `withHousehold` (D-SEC3.3).

- [x] **T11 — Migrar `recorrencias/route.ts`** (GET, POST) (AC1, AC2, AC5, AC7, AC8)
  - [x] T11.1 GET: SELECT em `withHousehold`.
  - [x] T11.2 POST: sub-queries FK `accounts`/`cards`/`categories` + INSERT no mesmo `tx` (retorno discriminado).

- [x] **T12 — Migrar `recorrencias/[id]/route.ts`** (GET, PATCH, DELETE) (AC1, AC2, AC5, AC7, AC8)
  - [x] T12.1 GET: SELECT em `withHousehold`.
  - [x] T12.2 PATCH: SELECT existência + sub-queries FK + UPDATE no mesmo `tx` (retorno discriminado, ordem 404/400 preservada).
  - [x] T12.3 DELETE: soft-delete UPDATE (`active=false`) em `withHousehold`.

- [x] **T13 — Adaptar mocks dos testes existentes** (AC9)
  - [x] T13.1 Os 12 ficheiros de teste actualizados: 10 simples receberam `withHousehold: (_auth, fn) => fn({ execute: dbExecuteMock })`; os 2 de `prestacoes` recebem `fn(dbStub)` (que expõe `execute` + `transaction` para a tx aninhada).
  - [x] T13.2 Confirmado: web 1068 pass (1 flaky pré-existente em `tarefas/calendario/page.test.tsx`, sem relação com finanças); db-test 181 pass (era 175 — +6 da PO-OBS). Finanças: 107/107 verde isolados.

- [x] **T14 — Quality gates** (AC9)
  - [x] T14.1 `pnpm lint` — exit 0 (No ESLint warnings or errors).
  - [x] T14.2 `pnpm typecheck` — exit 0 (todos os packages).
  - [x] T14.3 `pnpm --filter @meu-jarvis/web test` — 1068 pass / 1 flaky pré-existente (não-finanças). Finanças 107/107.
  - [x] T14.4 `pnpm --filter @meu-jarvis/db-test test` (Docker UP) — `rls-application.test.ts` 15/15 verde (era 9; +6 PO-OBS); 181 total.
  - [x] T14.5 `pnpm build` — exit 0 (10/10 tasks).
  - [x] T14.6 `pnpm check:rls` — exit 0 (104 policies intactas; 6 tabelas finanças cobertas).

---

## Dev Notes

### Referências-chave (leitura obrigatória antes de implementar)

| Recurso | Localização | Porquê relevante |
|---------|-------------|-----------------|
| Template canónico | `apps/web/src/app/api/tasks/route.ts:89-99` | Padrão EXACTO a replicar em todos os handlers |
| `db-shim.ts` | `apps/web/src/lib/agent/db-shim.ts:79-88` | Re-export `withHousehold` — usar SEMPRE via este módulo |
| ADR-003 §3 | `docs/adr/ADR-003-rls-enforced-runtime-hardening.md` | Contrato do wrapper + rationale |
| SEC-2 Dev Notes | `docs/stories/completed/SEC-2.rls-enforced-runtime-fase1-wrapper-gate.story.md` | [DEV-DECISION] D-SEC2.1/2/3 ratificadas — não repetir erros |
| `client.ts` | `packages/db/src/client.ts` | Implementação de `withHousehold` — não modificar |
| `rls-application.test.ts` | `packages/db-test/src/tests/rls-application.test.ts` | Gate de aplicação existente — verificar que fica verde |
| `auth.ts` | `apps/web/src/lib/api-helpers/auth.ts:63-93` | `requireAuth(span)` → `{ userId, householdId }` |

### Padrão de migração por handler

Cada handler segue este padrão mecânico (verificado no template `tasks/route.ts`):

**Antes (getDb):**
```typescript
// dentro do span callback:
const auth = await requireAuth(span);
if (auth instanceof NextResponse) return auth;

try {
  const db = getDb();
  const rows = await db.execute<FooRow>(sql`SELECT ... WHERE household_id = ${auth.householdId}::uuid`);
  return NextResponse.json({ foo: rows });
} catch (err) { ... }
```

**Depois (withHousehold):**
```typescript
// dentro do span callback:
const auth = await requireAuth(span);
if (auth instanceof NextResponse) return auth;

try {
  const rows = await withHousehold(
    { userId: auth.userId, householdId: auth.householdId },
    (tx) => tx.execute<FooRow>(sql`SELECT ... WHERE household_id = ${auth.householdId}::uuid`),
  );
  return NextResponse.json({ foo: rows });
} catch (err) { ... }
```

Pontos críticos:
1. `const db = getDb()` é **removido** (ou mantido apenas se ainda usado fora do `withHousehold` — e.g. `insertAuditLog` se ficar fora).
2. O filtro `household_id` nas queries é **mantido inalterado**.
3. O `withHousehold` é importado de `@/lib/agent/db-shim` (não de `@meu-jarvis/db/client`).
4. O tipo `tx` (`DbShim`) satisfaz a interface que os handlers precisam (`execute`/`transaction`/`insert`).

### Handlers com complexidade acrescida (atenção obrigatória)

**1. `prestacoes/route.ts` POST — transação aninhada (AC6)**

Este handler usa `db.transaction(async (tx) => {...})` (linha 172) para geração atómica de 1 `installment` + N `transactions`. A migração envolve o handler em `withHousehold(auth, (outerTx) => outerTx.transaction(async (innerTx) => {...}))`.

No Postgres, transações aninhadas traduzem-se em savepoints (`SAVEPOINT sp_X` no início do inner, `RELEASE sp_X` no commit, `ROLLBACK TO sp_X` em erro). O contexto RLS (role + claims do `SET LOCAL`) é herdado pelo savepoint — **não há fuga de contexto**. O Drizzle com postgres-js suporta este padrão.

Risco: o `per_installment_cents` é calculado fora da transação (`Math.floor(total / num)`, linhas 166-168) — correcto, é matemática pura sem IO.

**2. `prestacoes/[id]/route.ts` DELETE — ordem de delete obrigatória (AC6)**

O DELETE faz `db.transaction()` para apagar `transactions` (linhas 142-148) ANTES de `installments` (linha 149) — ordem imposta pelo CHECK `transactions_installment_index_coherent`. A migração mantém esta ordem dentro do `innerTx`.

**3. `contas/[id]/route.ts` e `cartoes/[id]/route.ts` DELETE — `resolveHouseholdRole` (T2.3a, T4.3)**

`resolveHouseholdRole(auth.userId, auth.householdId)` (linha 209 de `contas/[id]/route.ts`) query a tabela `household_members` — não é dados de domínio financeiro. Pode correr ANTES do `withHousehold` (fora da transação) sem perda de segurança — o resultado (role do utilizador) é estável durante o request.

**4. `categorias` — filtro `OR household_id IS NULL` (AC2)**

As queries de categorias têm `(household_id = ${auth.householdId}::uuid OR household_id IS NULL)` — esta excepção deliberada (categorias globais visíveis a todos os households, AC-E1 de SEC-1) é mantida inalterada. Dentro do `withHousehold`, a RLS `categories_select_global_or_member` (que permite globais) continua a funcionar correctamente com o role `authenticated` + claims correcto.

**5. `insertAuditLog` — posicionamento (AC7 / PO-FIX-2)**

O `insertAuditLog` recebe um parâmetro `db: DbShim` (`audit.ts:82`). **[PO-FIX-2]** Após a migração, **permanece no bloco `try/catch` best-effort FORA do `withHousehold`, recebendo `db: getDb()`** (comportamento actual inalterado). Razão: o audit é best-effort por design (catch só faz `log.warn`, nunca propaga); colocá-lo dentro da transação permitiria que uma falha de audit revertesse a operação principal — o oposto da intenção. O INSERT de audit já é app-enforced (`householdId` bound em `audit.ts:146-157`). Consequência: o `const db = getDb()` do topo dos handlers de mutação **mantém-se** (necessário para o audit exterior). Ver AC7 acima para detalhe completo e linhas verificadas.

### Sobre os testes existentes dos handlers de finanças

Os testes em `apps/web/src/app/api/financas/*/__tests__/` mockam `@/lib/agent/db-shim`. Após a migração, esses mocks precisam de expor `withHousehold`. O padrão a seguir é idêntico ao `list.test.ts` da SEC-2:

```typescript
vi.mock('@/lib/agent/db-shim', () => ({
  getDb: () => ({ execute: dbExecuteMock }),
  withHousehold: (_auth: unknown, fn: (tx: unknown) => unknown) =>
    fn({ execute: dbExecuteMock }),
}));
```

Onde `dbExecuteMock` é o mock existente de `db.execute`. Para handlers com `db.transaction()`, o mock deve também expor `transaction`:
```typescript
withHousehold: (_auth: unknown, fn: (tx: unknown) => unknown) =>
  fn({ execute: dbExecuteMock, transaction: (cb: (tx: unknown) => unknown) => cb({ execute: dbExecuteMock }) }),
```

### Sobre a performance

Envolver queries numa transação com `SET LOCAL` por request adiciona 1-2 round-trips marginais. Aceitável face a NFR1. pgbouncer transaction-mode foi desenhado para este padrão. O `SET LOCAL` reverte automaticamente no COMMIT — zero fuga de contexto (confirmado empiricamente, SEC-2 §3 foco 3).

### Convenções obrigatórias do projecto

- Imports em `apps/web`: absolutos `@/`.
- Sem `any`. Usar `unknown` + type guards se necessário.
- PT-PT em comentários e mensagens de erro.
- `prepare: false` na pool postgres-js — já em `getDb()`, não alterar.

### Riscos por handler (documentados para @architect no gate)

| Handler | Risco | Mitigação |
|---------|-------|-----------|
| `prestacoes/route.ts` POST | Transação aninhada (savepoint) — comportamento em Postgres real a confirmar | Padrão documentado; testes de integração cobrem prestações (fixtures existem em `rls-harness`) |
| `prestacoes/[id]/route.ts` DELETE | Ordem de delete dentro do savepoint — CHECK constraint `transactions_installment_index_coherent` | A ordem é mantida no `innerTx`; testes de integração cobrem o caso |
| `contas/[id]/route.ts` DELETE | `resolveHouseholdRole` fora da tx — race condition teórica (role muda entre a query e a operação) | Janela sub-ms; consistente com o padrão SEC-1 existente que fazia o mesmo |
| `categorias` GET/POST/PATCH | Filtro `OR household_id IS NULL` — globais podem escapar à RLS se mal configurada | A policy `categories_select_global_or_member` já trata globais; app-enforced mantém o filtro |
| `insertAuditLog` dentro da tx | Rollback da operação principal também reverte o audit log | Comportamento desejável; best-effort catch mantém-se para não propagar |
| Todos os handlers GET com filtros multi-condição | Queries longas (transacoes, recorrencias) dentro de tx — latência marginal | Impacto negligenciável; pgbouncer transaction-mode suporta |

---

## Testing

### Abordagem

| Camada | Ferramenta | Ficheiro(s) |
|--------|-----------|-------------|
| Regressão handlers finanças | Vitest (`apps/web`) | `apps/web/src/app/api/financas/*/__tests__/*.test.ts` (adaptar mocks) |
| Gate de aplicação RLS | Vitest + Testcontainers (`packages/db-test`) | `packages/db-test/src/tests/rls-application.test.ts` (existente — verificar GREEN) |
| Gate estático | `scripts/check-rls-coverage.ts` | `pnpm check:rls` |

### Cenários de teste obrigatórios

**Regressão dos handlers de finanças:**
- Para cada handler migrado, os testes existentes continuam a passar com o mock de `withHousehold` adicionado.
- Handlers com `db.transaction()` precisam de mock de `transaction` no shim.

**Gate de aplicação:**
- `rls-application.test.ts` (9 testes) continua verde — confirma que `withHousehold` (já testado) funciona correctamente.
- Os dados de `transactions` já estão semeados — `accounts` e outros domínios podem ser adicionados ao harness se o @dev julgar necessário para cobertura extra (opcional — documentar em [DEV-DECISION]).

**Nota:** os testes de finanças existentes provavelmente mockam `getDb` (não `withHousehold`). Após a migração, o mock de `db-shim` deve ser actualizado para incluir `withHousehold`. Não é necessário criar testes novos — apenas actualizar mocks existentes.

---

## CodeRabbit Integration

> **CodeRabbit Integration**: Disabled
>
> CodeRabbit CLI não está activo neste projecto (sem `coderabbit_integration` em `core-config.yaml`).
> Validação de qualidade via @architect adversarial gate (padrão SEC-1/SEC-2).

---

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (@dev Dex)

### Debug Log References

- 1.º typecheck falhou em `recorrencias/[id]/route.ts` (TS7034/TS7005): o array `sets` é construído no scope exterior mas escapa para o callback de `withHousehold` antes do 1.º `push` narrow o tipo. Resolvido com anotação explícita `const sets: ReturnType<typeof sql>[] = []`. Os restantes PATCH (contas/cartoes/transacoes) fazem o `reduce` no scope exterior, logo não escapam.
- Web test suite: 1 falha pré-existente e flaky (`tarefas/calendario/__tests__/page.test.tsx` — timeout 5000ms numa RSC, sem qualquer relação com finanças/`withHousehold`; já documentada como flaky na entrega SEC-2).

### Completion Notes

**Padrão de migração aplicado (template `tasks/route.ts`):**
- **GET puros** (12 handlers GET): `const db = getDb()` removido; query envolvida em `withHousehold(auth, (tx) => tx.execute(...))`.
- **Mutações** (POST/PATCH/DELETE): `const db = getDb()` MANTIDO (necessário para `insertAuditLog` best-effort exterior — PO-FIX-2). A operação principal (sub-queries FK + INSERT/UPDATE/DELETE + tx aninhada onde existe) migrou para `withHousehold(auth, (tx) => ...)`.

**[DEV-DECISION D-SEC3.2 — retorno discriminado p/ early-returns dentro do callback]:** Vários POST/PATCH/DELETE tinham `return apiError(...)` (404/409/400) entre sub-queries FK. Como esses `return` estão agora dentro do callback de `withHousehold` (que tem de devolver um valor, não um `NextResponse` solto que abortaria a tx de forma ambígua), o callback devolve um **tipo discriminado** (`{ error: ... } | { ...row }`) e o handler converte para `NextResponse`/`apiError` FORA do `withHousehold`. Vantagem: o early-return faz `return` da transação (COMMIT limpo, sem escrita) preservando a semântica exacta de status code/mensagem original. Verificado byte-a-byte que cada mensagem/código (404 conta/cartão/categoria, 409 transacção gerada, 400 multi-nível, 400 sem campos) é idêntica ao original.

**[DEV-DECISION D-SEC3.3 — transação aninhada (savepoint) em `prestacoes`]:** Os 2 handlers de `prestacoes` (POST `:172`, DELETE `:141`) usavam `db.transaction()`. Migrados para `withHousehold(auth, (outerTx) => outerTx.transaction(async (innerTx) => ...))`. No Postgres, o `innerTx` é um SAVEPOINT que HERDA o `SET LOCAL ROLE authenticated` + claims da transação exterior — sem fuga de contexto, atomicidade preservada (ordem de delete `transactions` antes de `installments` mantida; resto da última parcela calculado fora da tx, matemática pura). As sub-queries FK correm no `outerTx`. Confirmado pelos testes db-test (installments.rls + prestacoes route tests verdes).

**[DEV-DECISION D-SEC3.1 — PO-OBS implementada (gate estendido):** Aceite a recomendação não-mandatória do PO. Adicionei 2 `describe` a `rls-application.test.ts` (+6 testes): `accounts` (3) e sobretudo `categories` (3, incluindo o caso crítico de leak de globais — a única policy divergente `OR household_id IS NULL`). O teste de categorias prova que userA vê a própria per-household + a global, NUNCA a per-household de B. Custo marginal (fixtures `insertAccount`/`insertCategory`/`seedTwoHouseholds` já existiam). Gate passou de 9 → 15 testes.

**Garantias verificadas:**
- AC2: nenhum filtro `household_id` removido — confirmado em todas as queries (incluindo `OR household_id IS NULL` de categorias intacto).
- AC3: nenhum handler toca `getServiceDb()`.
- AC7/PO-FIX-2: `insertAuditLog` permanece best-effort FORA do `withHousehold` em todos os handlers de mutação, recebendo `db: getDb()`.
- Catch blocks que testam CHECK constraints (`cards_credit_needs_limit`, `transactions_account_or_card`, `recurrences_account_or_card`, `categories_unique_global_name`) continuam a funcionar — o erro propaga via rollback do `pgSql.begin()` de `withHousehold` preservando a mensagem original do Postgres.
- Sem migration nova (104 policies intactas).

### File List

| Ficheiro | Acção | Nota |
|---------|-------|------|
| `apps/web/src/app/api/financas/contas/route.ts` | Modificado | GET + POST → `withHousehold` |
| `apps/web/src/app/api/financas/contas/[id]/route.ts` | Modificado | GET + PATCH + DELETE → `withHousehold` |
| `apps/web/src/app/api/financas/cartoes/route.ts` | Modificado | GET + POST → `withHousehold` (FK discriminada) |
| `apps/web/src/app/api/financas/cartoes/[id]/route.ts` | Modificado | GET + PATCH + DELETE → `withHousehold` |
| `apps/web/src/app/api/financas/transacoes/route.ts` | Modificado | GET + POST → `withHousehold` (3 FK discriminadas) |
| `apps/web/src/app/api/financas/transacoes/[id]/route.ts` | Modificado | GET + PATCH + DELETE → `withHousehold` (scope+FK discriminados) |
| `apps/web/src/app/api/financas/categorias/route.ts` | Modificado | GET (`OR NULL` intacto) + POST → `withHousehold` |
| `apps/web/src/app/api/financas/categorias/[id]/route.ts` | Modificado | GET + PATCH + DELETE → `withHousehold` |
| `apps/web/src/app/api/financas/prestacoes/route.ts` | Modificado | GET + POST → `withHousehold` (tx aninhada D-SEC3.3) |
| `apps/web/src/app/api/financas/prestacoes/[id]/route.ts` | Modificado | GET + DELETE → `withHousehold` (tx aninhada D-SEC3.3) |
| `apps/web/src/app/api/financas/recorrencias/route.ts` | Modificado | GET + POST → `withHousehold` (3 FK discriminadas) |
| `apps/web/src/app/api/financas/recorrencias/[id]/route.ts` | Modificado | GET + PATCH + DELETE → `withHousehold` (`sets` tipado) |
| `apps/web/src/app/api/financas/contas/__tests__/route.test.ts` | Modificado | Mock `db-shim` + `withHousehold` |
| `apps/web/src/app/api/financas/contas/[id]/__tests__/route.test.ts` | Modificado | Mock `db-shim` + `withHousehold` |
| `apps/web/src/app/api/financas/cartoes/__tests__/route.test.ts` | Modificado | Mock `db-shim` + `withHousehold` |
| `apps/web/src/app/api/financas/cartoes/[id]/__tests__/route.test.ts` | Modificado | Mock `db-shim` + `withHousehold` |
| `apps/web/src/app/api/financas/transacoes/__tests__/route.test.ts` | Modificado | Mock `db-shim` + `withHousehold` |
| `apps/web/src/app/api/financas/transacoes/[id]/__tests__/route.test.ts` | Modificado | Mock `db-shim` + `withHousehold` |
| `apps/web/src/app/api/financas/categorias/__tests__/route.test.ts` | Modificado | Mock `db-shim` + `withHousehold` |
| `apps/web/src/app/api/financas/categorias/[id]/__tests__/route.test.ts` | Modificado | Mock `db-shim` + `withHousehold` |
| `apps/web/src/app/api/financas/prestacoes/__tests__/route.test.ts` | Modificado | Mock `db-shim` + `withHousehold` (`fn(dbStub)` p/ tx) |
| `apps/web/src/app/api/financas/prestacoes/[id]/__tests__/route.test.ts` | Modificado | Mock `db-shim` + `withHousehold` (`fn(dbStub)` p/ tx) |
| `apps/web/src/app/api/financas/recorrencias/__tests__/route.test.ts` | Modificado | Mock `db-shim` + `withHousehold` |
| `apps/web/src/app/api/financas/recorrencias/[id]/__tests__/route.test.ts` | Modificado | Mock `db-shim` + `withHousehold` |
| `packages/db-test/src/tests/rls-application.test.ts` | Modificado | PO-OBS: +6 testes (accounts 3 + categories globais 3); 9→15 |

---

## QA Results

**Gate adversarial @architect (Aria) — PASS 9,6/10, confiança ALTA — 2026-06-02.**

Gate file completo: `docs/qa/gates/SEC-3-architect-gate.md`.

### Gates re-corridos independentemente (Docker UP)

| Gate | Resultado |
|------|-----------|
| `pnpm lint` | PASS exit 0 (10/10 FULL TURBO) |
| `pnpm typecheck` | PASS exit 0 (web compilou — fix TS7034 válido sem `any`) |
| `pnpm --filter @meu-jarvis/web test` | 1068 pass / 1 flaky pré-existente (`tarefas/calendario` — RSC, não-finanças, não-regressão); 107/107 finanças verde |
| `pnpm --filter @meu-jarvis/db-test test` | 181 pass; `rls-application.test.ts` 15/15 |
| `pnpm build` | PASS exit 0 |
| `pnpm check:rls` | PASS exit 0 (104 policies; 6 tabelas finanças cobertas) |

### Focos de segurança adversariais (todos LIMPOS)

1. App-enforced MANTIDO — grep `household_id`: zero filtros removidos; `OR household_id IS NULL` intacto; filtro estrito nas mutações de categorias (D-SEC1.1). ✓
2. service_role intocado — grep `getServiceDb`: No matches found. ✓
3. PO-FIX-2 — `insertAuditLog` best-effort FORA do `withHousehold` em 8/8 handlers de mutação (linha sempre posterior; catch só `log.warn`). ✓
4. Tx aninhada D-SEC3.3 — savepoint herda contexto RLS; ordem de delete preservada (CHECK `transactions_installment_index_coherent`). ✓
5. Early-returns D-SEC3.2 — retorno discriminado; COMMIT limpo de tx só-leitura; status/mensagem byte-a-byte (incl. 404+409 em `transacoes/[id]` DELETE). ✓
6. Gate de aplicação — `rls-application.test.ts:215-263` prova que userA vê própria per-household + global, NUNCA per-household de B (leak de globais fechado). 15/15. ✓
7. auth.uid() vivo — `asUser()` replica a mecânica de `withHousehold`; policies `is_household_member`-based passam só com claims correctos. ✓
8. Atomicidade financeira — nenhuma op dependia de auto-commit múltiplo; `resolveHouseholdRole` (authz) antes da escrita. ✓

### [DEV-DECISION] ratificadas (3/3)

- **D-SEC3.1** (gate estendido accounts + categories globais): RATIFICADA — fecha o único risco residual da story.
- **D-SEC3.2** (retorno discriminado p/ early-returns): RATIFICADA — type-safe, COMMIT limpo, mensagens preservadas.
- **D-SEC3.3** (tx aninhada savepoint em prestacoes): RATIFICADA — herda contexto RLS, atomicidade intacta.

### OBS (não-bloqueantes, LOW)

- OBS-1: cards/installments/recurrences ainda sem asserções tabela-a-tabela no gate de aplicação (mecânica idêntica, sem policy divergente — risco nulo; hardening futuro).
- OBS-2: flaky `tarefas/calendario/page.test.tsx` recorrente (story dedicada futura).

**Veredicto: PASS — Done v1.1-ARCH-APPROVED. Pronto para `@devops *push`. Billing continua CONGELADO.**

---

## Follow-ups (fora de âmbito — stories SEC-4+)

| Item | Prioridade | Descrição |
|------|-----------|-----------|
| SSR pages `(app)/financas/*` | MEDIUM | RSC/Server Components que possam usar `getDb()` directamente |
| Helpers `lib/finance/*` | MEDIUM | Funções auxiliares do domínio financeiro (se existirem) |
| Rotas `/api/visao/financas-*` | MEDIUM | Endpoints de visão geral (domínio separado) |
| Domínio Household (`/api/conta/*`) | MEDIUM | Próximo domínio a migrar após finanças |
| Cérebro AI (`/api/agent/*`) | HIGH | Sub-rotas confirm/undo — dados cruzados com finanças/tarefas |
| Actualizar `architecture.md` §3.2 | LOW | Documentar caminho `withHousehold` como padrão canónico (Fase 3 ADR-003) |

---

## Change Log

| Data | Versão | Descrição | Autor |
|------|--------|-----------|-------|
| 2026-06-02 | 0.1 | Draft inicial — ADR-003 Fase 2 domínio Finanças | River (@sm) |
| 2026-06-02 | 1.0-DEV | Implementação @dev (Dex). 12 handlers `/api/financas/*` migrados de `getDb()` → `withHousehold(auth, fn)` (T1-T12). 12 ficheiros de teste actualizados (T13). PO-OBS implementada (D-SEC3.1): `rls-application.test.ts` 9→15 testes (+accounts +categories globais — fecha risco de leak da policy divergente `OR household_id IS NULL`). 3 [DEV-DECISION]: D-SEC3.1 (gate estendido), D-SEC3.2 (retorno discriminado p/ early-returns dentro do callback), D-SEC3.3 (savepoint herda contexto RLS em prestacoes). Filtros `household_id` SEC-1 INALTERADOS; `insertAuditLog` best-effort FORA do `withHousehold` (PO-FIX-2 respeitado); `getServiceDb()` intocado; sem migration nova. 6/6 gates GREEN (lint, typecheck, web test 1068 pass +1 flaky pré-existente não-finanças, db-test 181 pass com Docker UP, build, check:rls). Status → Ready for Review. | Dex (@dev) |
| 2026-06-02 | 1.1-ARCH-APPROVED | Gate adversarial @architect (Aria) — **PASS 9,6/10, confiança ALTA**. Varredura de segurança INDEPENDENTE (não a tabela do @dev): 8/8 focos limpos (app-enforced mantido por grep; zero `getServiceDb`; PO-FIX-2 honrado 8/8 mutações; tx aninhada savepoint correcta; early-returns discriminados com COMMIT limpo e mensagens byte-a-byte; leak de globais de categorias PROVADO fechado em `rls-application.test.ts:215-263`; auth.uid() vivo transitivo; atomicidade intacta). 9/9 ACs MET; 3/3 [DEV-DECISION] RATIFICADAS (D-SEC3.1/2/3). 6/6 gates re-corridos (lint/typecheck/build exit 0; web 1068 pass +1 flaky calendário pré-existente não-finanças; db-test 181 pass com rls-application 15/15; check:rls exit 0). Sem migration nova. 2 OBS LOW não-bloqueantes (cards/installments/recurrences tabela-a-tabela + flaky calendário). Gate file `docs/qa/gates/SEC-3-architect-gate.md`. Status → Done. Pronto para `@devops *push`. | Aria (@architect) |
| 2026-06-02 | 0.2-PO | Validação @po (GO 9,0/10). **4 divergências do @sm re-verificadas byte-a-byte e CONFIRMADAS independentemente:** (1) tx aninhadas `prestacoes/route.ts:172` + `[id]/route.ts:141`; (2) `resolveHouseholdRole` em `contas/[id]:209` + `cartoes/[id]:223`; (3) `insertAuditLog` sempre em `try/catch` best-effort separado recebendo `db`; (4) `rls-application.test.ts` cobre só `tasks`+`transactions`. **PO-FIX-2 (mandatório):** AC7 [AUTO-DECISION] original ("audit dentro da tx, db:tx") era incoerente com o código real — `insertAuditLog` é best-effort (catch só `log.warn`, nunca propaga) e nos handlers com tx está deliberadamente FORA do `db.transaction()`. Movê-lo para dentro inverteria a semântica e permitiria audit reverter a operação principal. AC7 reescrita: audit permanece FORA do `withHousehold` com `db: getDb()`; `const db = getDb()` mantém-se nos handlers de mutação. T1.3/T1.4 + Dev Notes §5 corrigidas. **PO-OBS (não-bloqueante):** gate só cobre 2 tabelas; recomendado (não-mandatório) estender a `accounts`+`categories` (globais — único caso de policy divergente). Confirmado: 12 handlers importam só `{ getDb }`, nenhum `getServiceDb`; 12 ficheiros `__tests__/route.test.ts` existem e mockam `db-shim` (T13 accionável); filtros `household_id` confirmados (`contas:71`, `transacoes:143`, `categorias:90` com `OR NULL`); sub-queries FK confirmadas (`transacoes` account:240/card:251/cat:261; `prestacoes` card:141/cat:151). | Pax (@po) |

---

## Divergências verificadas vs prompt de spawn

| Premissa do prompt | Estado real (verificado byte-a-byte) |
|-------------------|--------------------------------------|
| "Confirma que cada handler já tem `requireAuth(span)`" | CONFIRMADO. Todos os 12 handlers têm `auth = await requireAuth(span)` antes de qualquer query. |
| "Confirma que nenhum dos 12 handlers usa `getServiceDb`" | CONFIRMADO. Todos importam apenas `{ getDb }` de `@/lib/agent/db-shim`. Nenhum importa `getServiceDb`. |
| "Verifica se `rls-application.test.ts` já cobre finanças ou se precisa estender" | PARCIALMENTE CONFIRMADO. O teste cobre `transactions` (tabela financeira, AC-C2 da SEC-2). NÃO cobre `accounts`, `cards`, `installments`, `recurrences` ou `categories`. A story declara que o gate existente é SUFICIENTE (a mecânica `withHousehold` está provada) mas o @dev pode adicionar cobertura extra como [DEV-DECISION]. |
| "Alguns handlers POST fazem múltiplas escritas — confirmar que envolver numa tx não quebra atomicidade" | CONFIRMADO E DETALHADO. `prestacoes/route.ts` POST (linha 172) e `prestacoes/[id]/route.ts` DELETE (linha 141) já usam `db.transaction()` interno. A migração cria transação aninhada (savepoint Postgres) — correcto e documentado em AC6 + Dev Notes. |
