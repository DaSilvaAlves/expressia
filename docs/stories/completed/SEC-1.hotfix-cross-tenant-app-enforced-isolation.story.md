# Story SEC-1: Hotfix de segurança — isolamento cross-tenant app-enforced (CRITICAL)

> **ID:** `SEC-1` (segurança transversal — toca Epics 3/4/6). NÃO usar `6.3` (reservado no Epic 6 para "Setup Stripe + webhook", billing congelado). Esta story não pertence ao ramo billing.

## Status

Done v1.4-ARCH-APPROVED

## Executor Assignment

```
executor: "@dev"
quality_gate: "@architect"
quality_gate_tools: ["lint", "typecheck", "test", "check:rls", "build", "isolation-test"]
```

## Story

**As a** utilizador da Expressia (membro de um household),
**I want** que os dados do meu household nunca sejam acessíveis a membros de outros households através de qualquer rota da API,
**so that** os meus dados financeiros, tarefas e informações privadas estão garantidamente isolados, mesmo que o PostgreSQL RLS esteja inerte para o role de runtime.

## Contexto e âmbito (ler antes das ACs — OBRIGATÓRIO)

### Causa raiz (confirmada empiricamente — CRITICAL)

O `getDb()` (`packages/db/src/client.ts`) liga como role `postgres`, que tem `rolbypassrls=TRUE`. O `FORCE ROW LEVEL SECURITY` nas tabelas é anulado por este role — as 104 RLS policies **nunca são avaliadas em runtime**. O isolamento cross-tenant depende **inteiramente** dos filtros `WHERE household_id` explícitos em cada query de domínio.

**Prova empírica:** `diag-getdb-auth.ts` retornou `current_user='postgres', auth.uid()=NULL, request.jwt.claims=NULL`. A connection runtime com `current_household_id()=NULL` vê todos os households cross-tenant.

**Porque os gates passaram até agora:** `db-test` (Testcontainers) liga com role sem `bypassrls` e simula claims JWT — ali a RLS aplica-se normalmente. `check-rls-coverage.ts` valida que as policies *existem* no SQL, não que são *aplicadas* em runtime.

### Decisão de remediação (Eurico, 2026-06-02)

Remediação **app-enforced** como hotfix de segurança bloqueante: adicionar filtro `WHERE household_id = ${auth.householdId}::uuid` explícito a **todas** as queries de domínio vulneráveis (SELECT/UPDATE/DELETE). O `auth.householdId` é resolvido por `resolveHouseholdId()` em `apps/web/src/lib/api-helpers/auth.ts` via Supabase JS client (PostgREST, com JWT) — esta via é segura e já está disponível em todos os handlers.

### Fora de âmbito desta story

- Fix do ACHADO-1 / `accept_invite` / Story 6.7 (fio separado, depois deste hotfix).
- Hardening RLS-enforced (`getDb()` como role `authenticated` com claims JWT injectados por request). Arquitetura de defense-in-depth fica para story posterior, a cargo de `@architect` + `@data-engineer`.
- INSERTs — já injectam `${auth.householdId}` nos values e estão seguros.
- Jobs Inngest com `getServiceDb()` — iteram todos os households por design, legítimos.

### Fonte da verdade

`docs/security/CROSS-TENANT-AUDIT-20260602.md` — auditoria exaustiva (120 queries auditadas). Esta story implementa exactamente as checklists L1–L13 (LEAK) e I1–I13 (IDOR) dessa auditoria, mais o SQL injection em `client.ts:97`.

---

## Acceptance Criteria

### Bloco A — Tarefas, Kanban e Tags (queries de listagem LEAK)

**AC-A1 (L1 — tasks listagem):** `apps/web/src/lib/api-helpers/list-tasks.ts:168` — o SELECT de tasks inclui `WHERE tasks.household_id = ${householdId}::uuid`. Um pedido GET de um household que não possui tasks devolve array vazio (0 rows), nunca tasks de outro household.

**AC-A2 (L2 — tags listagem simples):** `apps/web/src/app/api/tags/route.ts:77` — o SELECT inclui `WHERE household_id = ${auth.householdId}::uuid`. Idem acima.

**AC-A3 (L3 — tags with_counts):** `apps/web/src/app/api/tags/route.ts:61` — a query com contagens inclui `WHERE tags.household_id = ${auth.householdId}::uuid`.

**AC-A4 (L4 — kanban_columns listagem):** `apps/web/src/app/api/kanban-columns/route.ts:80` — o SELECT inclui `WHERE household_id = ${auth.householdId}::uuid`.

### Bloco B — Finanças: contas (LEAK + IDOR)

**AC-B1 (L5 — contas listagem):** `apps/web/src/app/api/financas/contas/route.ts:67-73` — o SELECT inclui `AND household_id = ${auth.householdId}::uuid` (combinado com o filtro `archived_at` existente). Um household sem contas vê array vazio.

**AC-B2 (I7 — contas [id] GET):** `apps/web/src/app/api/financas/contas/[id]/route.ts:75` — o SELECT inclui `AND household_id = ${auth.householdId}::uuid`. Um pedido GET com um `id` de outro household devolve 404.

**AC-B3 (I7 — contas [id] PATCH):** `apps/web/src/app/api/financas/contas/[id]/route.ts:147` — o UPDATE inclui `AND household_id = ${auth.householdId}::uuid`. Tentativa de PATCH em conta de outro household devolve 404.

**AC-B4 (I7 — contas [id] DELETE):** `apps/web/src/app/api/financas/contas/[id]/route.ts:220` — o DELETE/UPDATE inclui `AND household_id = ${auth.householdId}::uuid`. Tentativa de DELETE em conta de outro household devolve 404.

### Bloco C — Finanças: cartões (LEAK + IDOR)

**AC-C1 (L6 — cartões listagem):** `apps/web/src/app/api/financas/cartoes/route.ts:101` — o SELECT inclui `AND household_id = ${auth.householdId}::uuid`.

**AC-C2 (I8 — cartões [id] GET/PATCH/DELETE):** `apps/web/src/app/api/financas/cartoes/[id]/route.ts:76,152,234` — cada operação inclui `AND household_id = ${auth.householdId}::uuid`. Operações cross-household devolvem 404.

### Bloco D — Finanças: transacções (LEAK + IDOR)

**AC-D1 (L7 — transacções listagem):** `apps/web/src/app/api/financas/transacoes/route.ts:175` — o SELECT inclui `AND household_id = ${auth.householdId}::uuid`. Verificar que o filtro de cursor/paginação existente não quebra (o cursor é baseado em `transaction_date + id`, sem dependência de household — o filtro adicional é suficiente).

**AC-D2 (I9 — transacções [id] GET/PATCH/DELETE + sub-queries):** `apps/web/src/app/api/financas/transacoes/[id]/route.ts:90,149,169-192,219,288,309` — todas as operações principais e sub-queries de validação (`account_id`, `card_id`, `category_id`) incluem `AND household_id = ${auth.householdId}::uuid`. Operações cross-household devolvem 404. **Nota:** para a validação de `category_id`, manter `OR household_id IS NULL` (categorias globais — ver AC-E1).

### Bloco E — Finanças: categorias (LEAK + IDOR — caso especial globais)

**AC-E1 (L8 — categorias listagem — caso especial):** `apps/web/src/app/api/financas/categorias/route.ts:96` — o SELECT inclui `AND (household_id = ${auth.householdId}::uuid OR household_id IS NULL)`. **As categorias globais (`household_id IS NULL`) DEVEM permanecer visíveis a todos os households** — esta é a excepção deliberada da auditoria.

**AC-E2 (I10 — categorias [id] GET/PATCH/DELETE):** `apps/web/src/app/api/financas/categorias/[id]/route.ts:76,144,182,250` — operações incluem `AND household_id = ${auth.householdId}::uuid`. **Excepção:** categorias globais (`household_id IS NULL`) não pertencem a nenhum household — o @dev deve decidir se as rotas `[id]` de categorias globais devem ser read-only (403 no PATCH/DELETE) ou acessíveis (documentar decisão como [DEV-DECISION]).

### Bloco F — Finanças: recorrências e prestações (LEAK + IDOR)

**AC-F1 (L9 — recorrências listagem):** `apps/web/src/app/api/financas/recorrencias/route.ts:126` — o SELECT inclui `AND household_id = ${auth.householdId}::uuid`.

**AC-F2 (I11 — recorrências [id] GET/PATCH/DELETE + sub-queries):** `apps/web/src/app/api/financas/recorrencias/[id]/route.ts:87,145,155-179,221,293` — todas as operações incluem `AND household_id = ${auth.householdId}::uuid`.

**AC-F3 (L10 — prestações listagem):** `apps/web/src/app/api/financas/prestacoes/route.ts:88` — o SELECT inclui `AND household_id = ${auth.householdId}::uuid`.

**AC-F4 (I12 — prestações [id] GET/PATCH/DELETE):** `apps/web/src/app/api/financas/prestacoes/[id]/route.ts:81,126,138,142` — todas as operações incluem `AND household_id = ${auth.householdId}::uuid`.

### Bloco G — Tarefas recorrentes (LEAK + IDOR)

**AC-G1 (L11 — task_recurrences listagem):** `apps/web/src/app/api/recurrences/route.ts:76` — o SELECT inclui `AND household_id = ${auth.householdId}::uuid`.

**AC-G2 (I13 — task_recurrences [id] GET/PATCH/DELETE):** `apps/web/src/app/api/recurrences/[id]/route.ts:56,115,174,232` — todas as operações incluem `AND household_id = ${auth.householdId}::uuid`.

### Bloco H — Visão e Agent (LEAK multi-tabela)

**AC-H1 (L12 — visao/queries.ts — 7 queries):** `apps/web/src/lib/visao/queries.ts:138,168,176,207,249,281,306` — as 7 queries de visão (tarefas hoje, tarefas atrasadas, finanças mês, recorrências próximas, saldo contas, calendário semana, briefing) recebem `householdId` como parâmetro e filtram com `WHERE ... household_id = ${householdId}::uuid`. **Verificar que a assinatura das funções já aceita `householdId` param — se não, adicionar e propagar aos 7 handlers `/api/visao/*`.**

**AC-H2 (L13 — agent/prompt — contas e cartões):** `apps/web/src/app/api/agent/prompt/route.ts:134,140` — as sub-queries que listam contas e cartões no contexto do agente incluem `WHERE household_id = ${householdId}::uuid AND archived_at IS NULL`.

### Bloco I — Tarefas, Kanban e Tags: IDOR handlers [id]

**AC-I1 (I1 — tasks [id] GET/PATCH/DELETE):** `apps/web/src/app/api/tasks/[id]/route.ts:52,141,202` — cada operação inclui `AND household_id = ${auth.householdId}::uuid`.

**AC-I2 (I2 — tasks [id]/move):** `apps/web/src/app/api/tasks/[id]/move/route.ts:79,92,109,119,162` — operações sobre tasks e kanban_columns incluem `AND household_id = ${auth.householdId}::uuid`.

**AC-I3 (I3 — tasks [id]/tags):** `apps/web/src/app/api/tasks/[id]/tags/route.ts:65` — validação da task inclui `AND household_id = ${auth.householdId}::uuid`.

**AC-I4 (I4 — tasks [id]/tags/[tagId]):** `apps/web/src/app/api/tasks/[id]/tags/[tagId]/route.ts:46` — validação inclui `AND household_id = ${auth.householdId}::uuid`.

**AC-I5 (I5 — tags [id] GET/PATCH/DELETE):** `apps/web/src/app/api/tags/[id]/route.ts:75,148` — cada operação inclui `AND household_id = ${auth.householdId}::uuid`.

**AC-I6 (I6 — kanban_columns [id]):** `apps/web/src/app/api/kanban-columns/[id]/route.ts:91,142,191,266,276,308,321,327` — todas as operações sobre kanban_columns e tasks afectadas incluem `AND household_id = ${auth.householdId}::uuid`.

### Bloco J — SQL Injection (client.ts)

**AC-J1 (SQL injection em setHouseholdContext):** `packages/db/src/client.ts:97` — a interpolação de string `'${householdId}'` é substituída por query parametrizada usando o tagged template literal do driver: `` sql`select set_config('app.current_household_id', ${householdId}, true)` ``. A função `setHouseholdContext` não é chamada em rotas de produção actualmente, mas está exportada — o fix é preventivo e obrigatório.

### Bloco K — Teste de isolamento (novo — gate NFR5 hardening)

**AC-K1 (Teste de isolamento como role runtime):** Adicionado ao package `@meu-jarvis/db-test` um teste que:
1. Liga à DB como o **mesmo role de runtime** (postgres/bypassrls — replicar a connection string `DATABASE_URL` usada pelo `getDb()`).
2. Insere dados num household A.
3. Tenta ler dados do household A enquanto está "autenticado" como household B (i.e., sem filtro household_id, como faria uma query vulnerável ANTES do fix).
4. **Assert:** 0 rows retornadas (ou seja, o filtro `household_id` app-enforced isolou os dados mesmo com RLS inerte).
5. Tenta ler com o filtro correcto do household A — **assert:** rows encontradas.
6. O teste passa em CI (`pnpm --filter @meu-jarvis/db-test test`).

**AC-K2 (Teste de isolamento de rota HTTP):** Pelo menos 1 teste de rota (sugestão: `api/financas/contas/route.test.ts`) adiciona um cenário onde `auth.householdId` é um UUID diferente do household dos dados mock — **assert:** response é `{ accounts: [] }` (0 contas, não as contas do outro household).

### Bloco L — Gates obrigatórios

**AC-L1 (Quality gates):** `pnpm lint`, `pnpm typecheck`, `pnpm test` (todas as suites: web + db + db-test + outros packages), `pnpm check:rls`, `pnpm build` passam com exit 0 e 0 regressões. O baseline actual é ≥962 testes em `apps/web` — esta story deve manter ou aumentar esse número (sem regressões).

---

## Tasks / Subtasks

As tasks estão ordenadas por prioridade de risco (dados financeiros primeiro).

### T1 — Finanças: contas (AC-B1 a AC-B4)
- [x] `api/financas/contas/route.ts:67` — adicionar `AND household_id = ${auth.householdId}::uuid` ao SELECT de listagem
- [x] `api/financas/contas/[id]/route.ts:75` — adicionar ao GET
- [x] `api/financas/contas/[id]/route.ts:147` — adicionar ao PATCH/UPDATE
- [x] `api/financas/contas/[id]/route.ts:220` — adicionar ao DELETE

### T2 — Finanças: cartões (AC-C1 a AC-C2)
- [x] `api/financas/cartoes/route.ts:101` — adicionar ao SELECT de listagem
- [x] `api/financas/cartoes/[id]/route.ts:76,152,234` — adicionar ao GET, PATCH, DELETE

### T3 — Finanças: transacções (AC-D1 a AC-D2)
- [x] `api/financas/transacoes/route.ts:175` — adicionar ao SELECT de listagem (cursor preservado — household filtro no seed do conditions array)
- [x] `api/financas/transacoes/[id]/route.ts:90` — GET principal
- [x] `api/financas/transacoes/[id]/route.ts:149` — query de validação prévia (PATCH e DELETE)
- [x] `api/financas/transacoes/[id]/route.ts:169-192` — sub-queries de validação account/card/category (account/card `AND household_id`; category `AND (household_id = ... OR household_id IS NULL)`)
- [x] `api/financas/transacoes/[id]/route.ts:219,288,309` — UPDATE e DELETE

### T4 — Finanças: categorias — caso especial globais (AC-E1 a AC-E2)
- [x] `api/financas/categorias/route.ts:96` — listagem com `AND (household_id = ${auth.householdId}::uuid OR household_id IS NULL)`
- [x] `api/financas/categorias/[id]/route.ts:76,144,182,250` — GET (`OR IS NULL` p/ globais readable), parent sub-query (`OR IS NULL`), PATCH/DELETE estritos a household (globais read-only → 404). [DEV-DECISION D-SEC1.1]

### T5 — Finanças: recorrências e prestações (AC-F1 a AC-F4)
- [x] `api/financas/recorrencias/route.ts:126` — listagem
- [x] `api/financas/recorrencias/[id]/route.ts:87,145,155-179,221,293` — todas as operações + sub-queries FK
- [x] `api/financas/prestacoes/route.ts:88` — listagem
- [x] `api/financas/prestacoes/[id]/route.ts:81,126,138,142` — GET, SELECT prévio, transacção de delete (transactions + installments)

### T6 — Tarefas e recorrentes de tarefas (AC-A1, AC-G1 a AC-G2)
- [x] `lib/api-helpers/list-tasks.ts:168` — filtro `tasks.household_id = ${householdId}::uuid` no seed do conditions + sub-query tag_id
- [x] `api/recurrences/route.ts:76` — listagem task_recurrences
- [x] `api/recurrences/[id]/route.ts:56,115,174,232` — GET, PATCH (2 queries), DELETE

### T7 — Tags e Kanban (AC-A2 a AC-A4, AC-I5 a AC-I6)
- [x] `api/tags/route.ts:77` — listagem simples
- [x] `api/tags/route.ts:61` — listagem with_counts (+ subquery count com household)
- [x] `api/kanban-columns/route.ts:80` — listagem
- [x] `api/tags/[id]/route.ts:75,148` — PATCH/UPDATE, DELETE
- [x] `api/kanban-columns/[id]/route.ts` — todas as operações (PATCH select+update+post-select; DELETE select+count+dest+move+delete)

### T8 — Tasks IDOR handlers [id] (AC-I1 a AC-I4)
- [x] `api/tasks/[id]/route.ts:52,141,202` — GET, PATCH, DELETE
- [x] `api/tasks/[id]/move/route.ts:79,92,109,119,162` — move flow (5 queries: tasks + kanban_columns)
- [x] `api/tasks/[id]/tags/route.ts:65` — validação da task + tag (ambos os sub-selects)
- [x] `api/tasks/[id]/tags/[tagId]/route.ts:46` — DELETE task_tags com household

### T9 — Visão e Agent (AC-H1 a AC-H2)
- [x] `lib/visao/queries.ts` — adicionado parâmetro `householdId` a 6 funções (getBriefing sem db); filtro em todas; propagado aos 7 handlers `/api/visao/*` + RSC (page.tsx, WidgetGrid, 6 widgets)
- [x] `api/agent/prompt/route.ts:134,140` — `buildAccountContext` recebe `householdId`; filtro em contas e cartões

### T10 — SQL Injection (AC-J1)
- [x] `packages/db/src/client.ts:97` — query parametrizada via `sql\`select set_config('app.current_household_id', ${householdId}, true)\`` (import `sql` adicionado)

### T11 — Testes de isolamento (AC-K1 a AC-K2)
- [x] `packages/db-test/src/tests/cross_tenant_isolation.test.ts` — 4 testes via `admin()` (role bypassrls = runtime): (1) sem filtro vê cross-tenant; (2) filtro household B → 0 rows; (3) filtro household A → rows; (4) transactions financeiras isoladas. PASS (Testcontainers)
- [x] `apps/web/src/app/api/financas/contas/__tests__/route.test.ts` — 2 cenários SEC-1: query carrega household param bound; household sem contas → `{ accounts: [] }`
- [x] Correr `pnpm --filter @meu-jarvis/db-test test` — 164/164 PASS (Docker up)

### T12 — Quality gates (AC-L1)
- [x] `pnpm lint` — exit 0, 0 warnings
- [x] `pnpm typecheck` — exit 0
- [x] `pnpm test` (web + db) — 1057/1058 PASS (1 timeout flaky `tarefas/calendario`, passa isolado em 1251ms); db-test 164/164 PASS
- [x] `pnpm check:rls` — exit 0, NFR5 preservada
- [x] `pnpm build` — exit 0

### T13 — SEC-1-F3 + sweep (QA Loop it.2 — fecho do bloqueador do re-gate)
- [x] `api/agent/prompt/[runId]/confirm/route.ts:97` — verificação de pertença app-enforced: `resolveHouseholdId(user.id)` + filtro `and household_id = ${userHouseholdId}::uuid` na lookup de `agent_runs` → cross-household 404; docblocks falsos ("RLS bloqueia cross-household") corrigidos
- [x] `api/agent/prompt/[runId]/undo/route.ts:96` — idem (impede revert via service_role cross-household); docblock corrigido
- [x] `api/kanban-columns/batch/route.ts` — SEC-1-F4 (defesa-em-profundidade): filtro `and household_id = ${auth.householdId}::uuid` inline nas 4 mutações por `id` (DELETE coluna, UPDATE tasks move_to, UPDATE sort_order trick, UPDATE final)
- [x] Sweep alargada de `apps/web/src/app/api/**` + `apps/web/src/lib/**` (ver QA Results — tabela exaustiva)
- [x] Testes: +4 confirm (`__tests__/confirm.test.ts`), +4 undo (`__tests__/undo.test.ts`), +1 batch (`kanban-columns/batch/__tests__/route.test.ts`)
- [x] 6 gates re-corridos com evidência real (ver Debug Log References — SEC-1-F3)

---

## Dev Notes

### Arquitectura do isolamento app-enforced

O `householdId` legítimo está sempre disponível via `requireAuth(span)` (`apps/web/src/lib/api-helpers/auth.ts`), que já é chamado no topo de **todos** os handlers de rota:
```typescript
// apps/web/src/lib/api-helpers/auth.ts
import { requireAuth } from '@/lib/api-helpers/auth';
const auth = await requireAuth(span);
if (auth instanceof NextResponse) return auth; // 401 (não autenticado) ou 404 (sem household)
// auth: AuthContext { readonly userId: string; readonly householdId: string }
// auth.householdId: string (UUID do household do utilizador autenticado)
```
**Nota de precisão (PO-FIX-1):** o helper público chama-se `requireAuth(span)` e devolve `AuthContext | NextResponse`. NÃO existe um `resolveHouseholdId(req)` que devolva `AuthContext` — `resolveHouseholdId(userId: string)` é um helper de nível inferior que devolve `string | null` e é chamado *dentro* de `requireAuth`. Em cada handler, a variável `auth` já está em scope (o `requireAuth(span)` é chamado no início de cada `withRouteTracing`), portanto o @dev usa o `auth.householdId` já existente — não precisa adicionar a chamada de auth, apenas o filtro `household_id` à query.

Este padrão já é usado em todos os handlers de POST — onde os INSERTs injectam `${auth.householdId}`. O hotfix aplica o mesmo `auth.householdId` aos SELECT/UPDATE/DELETE que hoje não o tinham. **Nota `list-tasks.ts` (helper, não handler) — confirmado pelo @po:** `listTasksHelper` recebe `ListTasksParams` que **JÁ inclui `householdId`** — o handler chamador `api/tasks/route.ts:87` já passa `householdId: auth.householdId`. Logo, para AC-A1 o @dev **NÃO** precisa alterar a assinatura nem o chamador; basta adicionar à condição WHERE existente (`conditions` array, `list-tasks.ts:122`) uma entrada `conditions.push(sql\`tasks.household_id = ${householdId}::uuid\`)`. O param já está em scope dentro de `listTasksHelper`.

### Padrão de aplicação (copiar este padrão)

**LEAK — listagem sem `household_id`:**
```sql
-- ANTES (vulnerável):
select ... from public.accounts
where archived_at is null
order by name asc limit 200

-- DEPOIS (seguro):
select ... from public.accounts
where archived_at is null
  and household_id = ${auth.householdId}::uuid
order by name asc limit 200
```

**IDOR — handler [id] sem `household_id`:**
```sql
-- ANTES (vulnerável — qualquer utilizador pode ver qualquer conta por UUID):
select ... from public.accounts where id = ${id}::uuid limit 1

-- DEPOIS (seguro — só o household correcto encontra a conta):
select ... from public.accounts
where id = ${id}::uuid
  and household_id = ${auth.householdId}::uuid
limit 1
```
Quando `rows[0]` é `undefined` após o fix, o handler já devolve 404 — comportamento correcto (o utilizador não sabe se o recurso existe noutro household ou não existe de todo).

**Categorias globais — excepção:**
```sql
-- Listagem:
where (household_id = ${auth.householdId}::uuid or household_id is null)

-- Validação em sub-queries (e.g., ao criar uma transacção):
and (household_id = ${auth.householdId}::uuid or household_id is null)
```

### Ficheiros afectados (estimativa — confirmar antes de fechar a story)

| Ficheiro | Linhas a modificar | Bloco |
|----------|-------------------|-------|
| `apps/web/src/lib/api-helpers/list-tasks.ts` | ~168 | T6 |
| `apps/web/src/app/api/tags/route.ts` | ~61, ~77 | T7 |
| `apps/web/src/app/api/tags/[id]/route.ts` | ~75, ~148 | T7 |
| `apps/web/src/app/api/kanban-columns/route.ts` | ~80 | T7 |
| `apps/web/src/app/api/kanban-columns/[id]/route.ts` | ~91, ~142, ~191, ~266, ~276, ~308, ~321, ~327 | T7 |
| `apps/web/src/app/api/tasks/[id]/route.ts` | ~52, ~141, ~202 | T8 |
| `apps/web/src/app/api/tasks/[id]/move/route.ts` | ~79, ~92, ~109, ~119, ~162 | T8 |
| `apps/web/src/app/api/tasks/[id]/tags/route.ts` | ~65 | T8 |
| `apps/web/src/app/api/tasks/[id]/tags/[tagId]/route.ts` | ~46 | T8 |
| `apps/web/src/app/api/financas/contas/route.ts` | ~67 | T1 |
| `apps/web/src/app/api/financas/contas/[id]/route.ts` | ~75, ~147, ~220 | T1 |
| `apps/web/src/app/api/financas/cartoes/route.ts` | ~101 | T2 |
| `apps/web/src/app/api/financas/cartoes/[id]/route.ts` | ~76, ~152, ~234 | T2 |
| `apps/web/src/app/api/financas/transacoes/route.ts` | ~175 | T3 |
| `apps/web/src/app/api/financas/transacoes/[id]/route.ts` | ~90, ~149, ~169-192, ~219, ~288, ~309 | T3 |
| `apps/web/src/app/api/financas/categorias/route.ts` | ~96 | T4 |
| `apps/web/src/app/api/financas/categorias/[id]/route.ts` | ~76, ~144, ~182, ~250 | T4 |
| `apps/web/src/app/api/financas/recorrencias/route.ts` | ~126 | T5 |
| `apps/web/src/app/api/financas/recorrencias/[id]/route.ts` | ~87, ~145, ~155-179, ~221, ~293 | T5 |
| `apps/web/src/app/api/financas/prestacoes/route.ts` | ~88 | T5 |
| `apps/web/src/app/api/financas/prestacoes/[id]/route.ts` | ~81, ~126, ~138, ~142 | T5 |
| `apps/web/src/app/api/recurrences/route.ts` | ~76 | T6 |
| `apps/web/src/app/api/recurrences/[id]/route.ts` | ~56, ~115, ~174, ~232 | T6 |
| `apps/web/src/lib/visao/queries.ts` | ~138, ~168, ~176, ~207, ~249, ~281, ~306 | T9 |
| `apps/web/src/app/api/agent/prompt/route.ts` | ~134, ~140 | T9 |
| `packages/db/src/client.ts` | ~97 | T10 |
| `packages/db-test/src/tests/cross_tenant_isolation.test.ts` | novo | T11 |

### Dependências e bloqueadores

- **Sem bloqueadores externos** — todo o trabalho é app-code (TypeScript), sem migrations SQL, sem novas tabelas, sem segredos novos.
- `auth.householdId` já disponível em todos os handlers (via `resolveHouseholdId()`).
- `sql` tagged template literal já importado em todos os ficheiros de route.
- **Não introduzir** `import` de `@meu-jarvis/db` directamente em rotas — usar o padrão `import type` (REQ-INLINE-1, validado desde Story 5.5).
- Esta story NÃO deve rocar no schema (`packages/db/src/schema/`) nem criar migrations — `check:rls` mantém-se verde por design.

### Notas de teste

- **Framework:** Vitest (globals: true — `describe`/`it`/`expect` sem import).
- **Localização testes web:** `apps/web/src/app/api/**/__tests__/route.test.ts`.
- **Localização testes db-test:** `packages/db-test/src/tests/`.
- **Mock de `auth.householdId`:** nos testes de rota, usar o padrão existente de mock de `resolveHouseholdId()` que já existe nos testes das rotas de finanças — verificar `financas/contas/__tests__/route.test.ts` como referência.
- **Teste de isolamento (T11):** usar a connection string `DATABASE_URL` (pgbouncer 6543, role postgres) para simular o role de runtime real. O db-test já tem helpers `seedTwoHouseholds()` — reutilizar.
- **Baseline de testes a preservar:** ≥962 testes em `apps/web` (baseline Story 5.8). Não introduzir regressões.

### Estratégia de implementação incremental (sugestão para o @dev)

Implementar por T1→T2→T3 (finanças, mais sensíveis) primeiro, correr `pnpm test` após cada task de alto risco, depois T4→T5→T6→T7→T8→T9→T10, e por fim T11+T12 (testes de garantia + gates finais). Não esperar pelo final para correr os gates — descobrir regressões cedo.

### Context de segurança (não implementar — apenas awareness)

O hardening RLS-enforced (refactoring de `getDb()` para ligar como role `authenticated` com `request.jwt.claims` por request, compatível com pgbouncer transaction-mode) fica para story futura a cargo de `@architect` + `@data-engineer`. Esta story não toca no `client.ts` além do fix SQL injection em `setHouseholdContext`.

---

## Testing

### Testes de rota (web)

- Padrão: `apps/web/src/app/api/{domínio}/__tests__/route.test.ts`
- Framework: Vitest + globals
- Mock: `resolveHouseholdId()` → retorna `{ householdId: 'uuid-a', userId: 'uuid-u' }`
- Cenário crítico a adicionar: mock com `householdId` diferente dos dados seed → assert `{ items: [] }` ou 404

### Testes de isolamento (db-test)

- Localização: `packages/db-test/src/tests/cross_tenant_isolation.test.ts`
- Usa connection string `DATABASE_URL` (role runtime — postgres/bypassrls)
- Dois households, dados num deles, queries com filtro `household_id` do outro → assert 0 rows
- Este teste prova que a app-enforcement funciona mesmo com RLS inerte

### Nota sobre o gate `check:rls`

O gate continua a verificar que as policies existem no SQL — não verifica que são aplicadas em runtime. Esta story não altera o gate (fica para story futura de hardening). O gate apenas serve para garantir que nenhuma tabela nova foi adicionada sem RLS policies.

---

## Change Log

| Data | Versão | Descrição | Autor |
|------|--------|-----------|-------|
| 2026-06-02 | v1.4-ARCH-APPROVED | **Re-gate @architect (QA Loop it.2 — FINAL): PASS 9,4/10 — Done.** SEC-1-F3 **VERIFICADO FECHADO** ficheiro:linha: `confirm/route.ts:101-118` e `undo/route.ts:101-118` resolvem `resolveHouseholdId(user.id)` + filtram `agent_runs` por `and household_id = ${userHouseholdId}::uuid` → cross-household 404 (não revela existência) e sem-household 404 antes de tocar na DB. Cadeia fechada confirmada: o `getServiceDb()` do undo (`:182`) e o Planner+Executor do confirm (`:194-222`) só são alcançados **após** a verificação de pertença. Docblocks falsos corrigidos. SEC-1-F4 **VERIFICADO FECHADO** (kanban-columns/batch `:246-251,253-257,306-311,323-328` — 4 mutações com `household_id` inline). Testes F3 não-tautológicos: `confirm.test.ts:92-123` prova household bound (boundParamValues) + Planner/Executor/DB **nunca chamados** cross-household/sem-household; `undo.test.ts` análogo (serviceDb nunca aplica reverse ops cross-tenant). **Varredura adversarial INDEPENDENTE** (não confiou na tabela do @dev): grep próprio de `getUser(`, `where id = ${`, `from/update/delete public.`, mutações de domínio em `api/**`+`lib/**` — todos os handlers `getUser()` directo derivam household do próprio user (`me`/`agent-prompt`/`conta`); todos os `id`/FK user-controlled (confirm/undo runId + FK dos POST/`[id]`) filtrados por household; category FKs com `or household_id is null` (AC-E1); `audit-log.ts`/`idempotency.ts` operam por runId/household já validados; inngest = `getServiceDb()` legítimo. **Veredicto: zero vectores de isolamento cross-tenant residuais — afirmação de exaustividade do @dev confirmada independentemente.** D-SEC1.3 **RATIFICADA**. 6 gates re-corridos: lint/typecheck/check:rls/build exit 0; web **1068/1068 (0 flaky — `tarefas/calendario` passou na suite completa, confirma flaky≠regressão)**; db-test 164/164 (Docker real). Declaração: superfície de domínio de apps/web livre de vectores cross-tenant conhecidos (isolamento 100% app-enforced); ressalva — RLS Postgres continua inerte em runtime, hardening RLS-enforced fica para story posterior (fora de âmbito). Próximo: `@devops *push` (sem migrations). Gate file actualizado. | Aria (@architect) |
| 2026-06-02 | v1.4 | **SEC-1-F3 fechado + sweep alargada (QA Loop it.2).** @dev (Dex) fechou o IDOR cross-tenant de escrita/execução nas sub-rotas de agent runs: `confirm/route.ts:97` e `undo/route.ts:96` resolvem agora `resolveHouseholdId(user.id)` e filtram a lookup de `agent_runs` por `and household_id = ${userHouseholdId}::uuid` (cross-household → 404, não revela existência); `resolveHouseholdId` reusado de `@/lib/api-helpers/auth` [IDS: REUSE]. Docblocks falsos "RLS bloqueia cross-household" corrigidos (RLS inerte em runtime). **Sweep exaustiva** de `apps/web/src/app/api/**` + `lib/**`: 32 ficheiros de rota + 5 helpers de lib varridos — todos os handlers que autenticam via `getUser()` directo (`me`, `agent/prompt`, `conta/household`, `conta/preferencias`, `conta/household/{members,invites}`) derivam o household do próprio user (nunca user-controlled) ou usam Supabase JS/PostgREST RLS-via-JWT → seguros; confirm/undo eram o único vector real (runId user-controlled). **SEC-1-F4 fechado** (defesa-em-profundidade, alinhado com mandato da sweep): `kanban-columns/batch` tinha 4 mutações por `id` sem `household_id` inline (já guardadas por `validateInput` 422, não explorável — era o F2 LOW do gate); filtro `and household_id = ${auth.householdId}::uuid` adicionado a cada uma. **+9 testes** (4 confirm + 4 undo via `boundParamValues` provando household bound + service_role/Planner nunca invocados cross-household + 404 sem household; 1 batch provando household bound nas mutações). Bug latente corrigido: `undo.test.ts` setupAuth não mockava `.from()` — o fix F3 exigiu-o. 6/6 gates GREEN com evidência real (lint 0w, typecheck, web 1067/1068 + flaky calendario isolado 1296ms, db-test 164/164 Docker UP, check:rls, build). Baseline web 1061→1068. Mantém `Ready for Review` — re-gate @architect. | Dex (@dev) |
| 2026-06-02 | v1.3-ARCH-REGATE | **Re-gate @architect (QA Loop it.1): FAIL 6,5/10 — NÃO Done.** SEC-1-F1 **VERIFICADO FECHADO** ficheiro:linha nas 10 sub-queries FK dos 5 POST de Finanças (transações `:242,253,265`; recorrências `:182,193,205`; prestações `:143,154`; cartões `:156`; categorias-parent `:155`); testes não-tautológicos confirmados (`boundParamValues` prova household bound na query — falharia sem o filtro). D-SEC1.2 **RATIFICADA** (parent global coerente com GET/PATCH `[id]`, não reabre vector). 6 gates re-corridos: lint/typecheck/check:rls/build exit 0; web 1060/1061 (flaky `tarefas/calendario` confirmado isolado 1356ms — não-regressão); db-test 164/164 (Docker real). **Bloqueador novo SEC-1-F3 (HIGH/CRITICAL):** varredura adversarial final encontrou IDOR cross-tenant de ESCRITA/EXECUÇÃO nas sub-rotas de agent runs `/api/agent/prompt/[runId]/confirm:97-103` e `/undo:96-101` — lookup de `agent_runs` só por `runId`, sem `household_id` nem verificação de pertença do `user` ao `run.household_id`; comentário "RLS bloqueia cross-household" é a premissa falsa que motiva esta story. Vector: membro do household B executa/reverte mutações financeiras reais do household A conhecido só o run UUID (mais grave que o F1 probe-oracle). Fora do catálogo da auditoria (não cobria confirm/undo). FAIL (não CONCERNS) porque o vector residual é superior ao já fechado, num hotfix CRITICAL. Retorno ao @dev (it.2). Gate file actualizado. | Aria (@architect) |
| 2026-06-02 | v1.3 | **SEC-1-F1 fechado (QA Loop it.1).** @dev (Dex) adicionou filtro `household_id` app-enforced às 10 sub-queries de validação de FK dos POST de Finanças: transações (account/card/category), recorrências (account/card/category), prestações (card/category), cartões (account), categorias (parent). Padrão replicado do PATCH `[id]` já-correcto: account/card `and household_id = ${auth.householdId}::uuid`; category/parent `and (household_id = ${auth.householdId}::uuid or household_id is null)` (globais válidas — AC-E1). Comentários falsos "SELECT RLS-scoped não encontra cross-household" substituídos por nota correcta (RLS inerte em runtime). +4 testes web (transações 9→11, recorrências 9→11) via `boundParamValues` provando household bound nas FK-checks. 6/6 gates GREEN com evidência real (lint 0w, typecheck, web+db 1061 PASS, db-test 164 PASS Docker UP, check:rls, build). 1 [DEV-DECISION] D-SEC1.2 (parent global de categorias mantido válido, coerente c/ GET + PATCH `[id]`). Mantém `Ready for Review` — re-gate @architect. | Dex (@dev) |
| 2026-06-02 | v1.2-ARCH-GATE | **Gate @architect: CONCERNS 8,4/10 — NÃO Done.** Cobertura auditoria 26/26 (L1–L13 + I1–I13) + SQLi = 100% verificada ficheiro:linha. 5 gates verdes (lint/typecheck/web 1057+flaky confirmado/db-test 164/build/check:rls). AC-K1 sólido não-tautológico. D-SEC1.1 RATIFICADA. **Bloqueador SEC-1-F1 (MEDIUM-HIGH):** 10 sub-queries FK nos POST de Finanças (transações/recorrências/prestações/cartões/categorias-parent) validam FK por `id` sem `household_id` → IDOR de escrita + probe-oracle (inconsistência vs PATCH que já filtra). Retorno ao @dev. Gate file `docs/qa/gates/SEC-1-architect-gate.md`. | Aria (@architect) |
| 2026-06-02 | v1.0 | Draft inicial — hotfix CRITICAL cross-tenant, app-enforced | River (@sm) |
| 2026-06-02 | v1.2 | **Status Ready → Ready for Review.** @dev (Dex) implementou T1-T12 em modo YOLO. 41 LEAK+IDOR queries filtradas por `household_id` app-enforced + SQL injection fix em `client.ts` + 6 testes de isolamento novos (4 db-test AC-K1 via role bypassrls runtime + 2 web AC-K2). 5/5 gates GREEN com evidência real (lint 0w, typecheck, test 1057+164 PASS, check:rls PASS, build). Docker UP → AC-K1 provado contra Postgres real. 1 [DEV-DECISION] D-SEC1.1 (categorias globais read-only nos [id]). 1 timeout flaky em `tarefas/calendario` (não-regressão — passa isolado, não toca código alterado). | Dex (@dev) |
| 2026-06-02 | v1.1 | **Status Draft → Ready.** `@po *validate-story-draft` GO 9,6/10, confiança ALTA. Anti-hallucination byte-a-byte: 13+ ACs distintas confirmadas contra código real (L1/L2/L3/L5/L6/L7/L8/L9/L10/L11/L12/L13 LEAK · I2/I6/I7 IDOR · J1 SQL injection) — todos os ficheiros/linhas citados existem e estão de facto vulneráveis. Cobertura da auditoria = 100% (13/13 LEAK + 13/13 IDOR + SQLi mapeados a ACs; zero omissões). PO-FIX-1 aplicado inline: corrigido snippet de Dev Notes que citava `resolveHouseholdId(req)` inexistente → padrão real `requireAuth(span)` + nota sobre `listTasksHelper` (param `householdId` já threaded em `tasks/route.ts:87`) e visao queries (7 funções precisam de novo param). | Pax (@po) |

---

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Dex / @dev), modo YOLO autónomo.

### Debug Log References

- Gates finais (evidência real):
  - `pnpm lint` → 10/10 tasks, 0 warnings (exit 0)
  - `pnpm typecheck` → 10/10 tasks (exit 0)
  - `pnpm --filter @meu-jarvis/web --filter @meu-jarvis/db test` → 1057 passed + 1 timeout flaky (`tarefas/calendario/page.test.tsx`, passa isolado em 1251ms < 5000ms; não toca código alterado, mocka getDb). Total 1058 ≥ baseline 962.
  - `pnpm --filter @meu-jarvis/db-test test` → 35 ficheiros, 164/164 PASS (Docker/Testcontainers UP, Postgres 16 efémero)
  - `pnpm check:rls` → "Todas as tabelas multi-tenant têm coverage completa" (exit 0)
  - `pnpm build` → 10/10 tasks (exit 0)
- Docker disponível para db-test: **SIM** (`docker info` OK) — AC-K1 verificado contra Postgres real.

#### SEC-1-F3 (QA Loop it.2 — gates re-corridos com evidência real)

- `pnpm lint` → 10/10 tasks, "No ESLint warnings or errors" (exit 0)
- `pnpm typecheck` → 10/10 tasks (exit 0)
- `pnpm --filter @meu-jarvis/web --filter @meu-jarvis/db test` → 1067 passed + 1 timeout flaky (`tarefas/calendario/page.test.tsx`, passa isolado em 1296ms < 5000ms; não toca código alterado, mocka getDb). Total 1068 ≥ baseline 962. Web subiu 1061→1068 (+7 testes SEC-1-F3/F4; nota: o teste batch conta 1, +9 lógicos repartidos pelos ficheiros existentes confirm/undo).
- `pnpm --filter @meu-jarvis/db-test test` → 35 ficheiros, 164/164 PASS (Docker/Testcontainers UP, Postgres 16 efémero)
- `pnpm check:rls` → "Todas as tabelas multi-tenant têm coverage completa" (exit 0)
- `pnpm build` → 10/10 tasks (exit 0)
- Testes SEC-1-F3/F4 isolados: `confirm` 8/8, `undo` 14/14, `batch` 1/1 PASS.

### Completion Notes List

- **Padrão aplicado:** filtro `AND household_id = ${auth.householdId}::uuid` (ou `${householdId}::uuid` em helpers) adicionado a todas as queries LEAK (16) e IDOR (25+) da auditoria. INSERTs não tocados (já seguros). Jobs `getServiceDb()` não tocados (iteram todos os households por design).
- **Conditions-array seeds:** onde a listagem usa `const conditions = [...]`, o filtro household foi adicionado como primeiro elemento (transacções, recorrências finanças, recorrências tarefas, list-tasks, categorias, cartões) — elimina também o fallback `sql\`true\`` para query sem filtros.
- **Categorias globais (caso especial):** GET/listagem e validação de FK usam `OR household_id IS NULL` (globais visíveis a todos — AC-E1). PATCH/DELETE `[id]` usam filtro estrito (sem `OR IS NULL`) → categorias globais ficam read-only (404), preservando o comportamento documentado da RLS `categories_update_member` (D-SEC1.1).
- **Visão (T9):** as 6 funções de query com DB passaram a receber `householdId: string` (getBriefing não tem DB). Propagado a 3 superfícies: 7 handlers `/api/visao/*` (via `auth.householdId`), `isVisaoEmpty` em `page.tsx`, e os 6 widgets RSC (via prop `householdId` threaded através de `WidgetGrid`). `page.tsx` resolve `householdId` via `resolveHouseholdId(user.id)` e redirecciona `/bem-vindo` se ausente.
- **Agent prompt (T9):** `buildAccountContext` recebe `householdId` e filtra contas/cartões.
- **SQL injection (T10):** `setHouseholdContext` parametrizado (preventivo — não chamado em rotas de produção).
- **Testes:** AC-K1 via `admin()` (role bypassrls = role de runtime real) prova que o filtro app-enforced isola mesmo com RLS inerte; AC-K2 captura os params bound do objecto `SQL` Drizzle e assere que o household autenticado é interpolado.

#### SEC-1-F1 (QA Loop it.1 — fecho do bloqueador do gate)

- **Achado:** as 10 sub-queries de validação de FK dos handlers POST de Finanças validavam o recurso referenciado apenas por `id`, sem filtro `household_id` — IDOR de escrita (criar registo do meu household referenciando conta/cartão/categoria de outro) + probe-oracle de existência cross-tenant. Os PATCH equivalentes já filtravam `household_id` (inconsistência, não decisão).
- **Fix:** filtro `household_id` adicionado a cada sub-query, replicando exactamente o padrão do PATCH `[id]/route.ts:175,186,200`:
  - `transacoes/route.ts` — account (`and household_id = ${auth.householdId}::uuid`), card (idem), category (`and (household_id = ${auth.householdId}::uuid or household_id is null)`).
  - `recorrencias/route.ts` — account, card, category (mesmo padrão).
  - `prestacoes/route.ts` — card (estrito household), category (`or is null`).
  - `cartoes/route.ts` — account (`and household_id = ... and archived_at is null` — preserva PO_FIX F1).
  - `categorias/route.ts` — parent_id (`and (household_id = ... or household_id is null) and archived_at is null` — globais são parents válidos, ver D-SEC1.2).
- **Comentários corrigidos:** removidas as afirmações falsas "SELECT RLS-scoped não encontra rows cross-household" (RLS inerte em runtime — getDb() liga como role bypassrls), substituídas por nota correcta sobre o filtro app-enforced.
- **Testes (+4):** `transacoes/__tests__/route.test.ts` (+2: account FK-check binds household + 404 cross-household; category FK-check binds household + 404 cross-household), `recorrencias/__tests__/route.test.ts` (+2: account FK-check binds household + 404). Provam via `boundParamValues` que a sub-query de validação carrega o `household_id` autenticado como parâmetro bound — sem ele a query seria probe-oracle + FK cross-household.

#### SEC-1-F3 (QA Loop it.2 — fecho do bloqueador do re-gate + sweep alargada)

- **Achado (HIGH/CRITICAL):** as sub-rotas de agent runs `confirm` e `undo` faziam `select ... from agent_runs where id = ${runId}::uuid` sem filtro `household_id` nem verificação de pertença do utilizador autenticado. Como o `runId` vem do path (user-controlled) e a RLS está inerte em runtime, um membro do household B com um `runId` do household A executava (confirm, Planner+Executor, janela 5 min) ou revertia (undo, via `getServiceDb()`, janela 30s) mutações reais do household A. Fora do catálogo da auditoria (que cobria `agent/prompt/route.ts` L13, não confirm/undo).
- **Fix:** após o auth, ambos resolvem `resolveHouseholdId(user.id)` (helper já existente em `@/lib/api-helpers/auth` — [IDS: REUSE]) e adicionam `and household_id = ${userHouseholdId}::uuid` à lookup de `agent_runs`. Cross-household → 0 rows → 404 (não 403, para não revelar a existência do run noutro household). Sem household activo → 404 antes de tocar na DB. Docblocks falsos "RLS bloqueia cross-household" / "RLS implícita" corrigidos com a premissa real (RLS inerte; getDb() liga como role bypassrls). As funções a jusante (`updateAfterPlanner/Executor`, `applyReverseOp`, `incrementQuota`, audit) operam por `runId` mas só são alcançadas **após** a verificação de pertença — a cadeia fica fechada.
- **SEC-1-F4 (era o F2 LOW do gate — fechado por alinhamento com o mandato da sweep):** `kanban-columns/batch/route.ts` tinha 4 mutações por `id` (DELETE coluna, UPDATE tasks no move_to, UPDATE sort_order trick negativo, UPDATE final) sem `household_id` inline. Já estavam protegidas por `validateInput` (rejeita 422 ids fora do household antes da transacção) — não explorável — mas o filtro inline torna cada mutação segura por construção (defesa-em-profundidade). Adicionado `and household_id = ${auth.householdId}::uuid` a cada uma.
- **Sweep alargada (exaustiva — para parar o whack-a-mole):**
  1. **Handlers que autenticam via `supabase.auth.getUser()` em vez de `requireAuth`:** `me/route.ts` (Supabase JS/PostgREST, RLS-via-JWT, filtra `user_id` — seguro); `agent/prompt/route.ts` (resolve household do próprio user, usa em todas as queries — seguro); `conta/household/route.ts`, `conta/preferencias/route.ts` (household derivado do próprio membership — seguro); `agent/prompt/[runId]/confirm` e `/undo` (**vector real F3 — fechado**). O `aceitar-convite` está fora de âmbito (Story 6.7).
  2. **Acesso a entidade de domínio por `id`/PK sem `household_id`:** varridos todos os `where id = ${`, `from public.`, `update public.`, `delete from public.` em `api/**` e `lib/**` (excl. inngest, que iteram todos os households por design — legítimo). Domínios finanças/tarefas/kanban/tags/recurrences: todos já filtram `household_id` (fechados na v1.2/v1.3). Handlers de gestão de household (`members/[userId]`, `invites/[id]`, `invites/`) usam `requireAuth` + `auth.householdId` em cada query — seguros. Helpers em `lib` (`cost-router`, `rate-limiter`, `visao/queries`, `list-tasks`, `audit-log`) filtram `household_id` ou operam por `runId` já validado pelo handler. **Único resíduo sem filtro inline: kanban-columns/batch — fechado como F4.**
  3. **Veredicto:** após esta iteração não existe nenhuma query de domínio nem handler de escrita sem isolamento por household em `apps/web` (ou via filtro inline app-enforced, ou via RLS-via-JWT do PostgREST, ou household derivado do próprio user — nunca user-controlled). Tabela completa na secção QA Results.
- **Testes (+9):** `confirm.test.ts` (+4: query carrega household bound; 404 cross-household + Planner/Executor nunca executam; 404 sem household + DB nunca tocada), `undo.test.ts` (+4: idem + service_role nunca aplica reverse ops cross-household), `kanban-columns/batch/route.test.ts` (novo, +1: DELETE coluna + UPDATE tasks carregam household bound). Bug latente corrigido: `undo.test.ts` `setupAuth` não mockava `.from('household_members')` — o fix F3 (que chama `resolveHouseholdId`) exigiu-o; sem a correcção, 11 testes pré-existentes falhariam (regressão evitada).

#### [DEV-DECISION]

- **D-SEC1.3 — Fechar o F2/F4 (kanban-columns/batch) apesar de LOW não-bloqueante:** o @architect classificou o `kanban-columns/batch` como SEC-1-F2 LOW (não explorável — guard `validateInput` 422 prévio). Decisão @dev: fechá-lo nesta iteração como SEC-1-F4, alinhado com o objectivo explícito da sweep ("NÃO deve existir nenhuma query de domínio nem handler de escrita sem isolamento por household em todo o apps/web"). Custo baixo (4 filtros inline + 1 teste), elimina dependência da ordem de validação (se um futuro refactor mexesse no `validateInput`, as mutações ficariam expostas). Alternativa rejeitada: deixar como tech-debt LOW — contraria o mandato anti-whack-a-mole desta iteração. Não altera contrato nem comportamento observável (ids inválidos já eram rejeitados 422 a montante).

- **D-SEC1.2 — Parent global de categorias no POST:** a sub-query de validação de `parent_id` mantém `OR household_id IS NULL`, permitindo que uma categoria global seja parent de uma categoria do household. Coerente com (a) a listagem GET de categorias (`categorias/route.ts:90` — globais visíveis, AC-E1), (b) a validação de parent na rota `[id]/route.ts:150` (já usa `or household_id is null`), e (c) o comentário pré-existente "categoria visível (própria ou global)". Alternativa rejeitada: restringir parent a household estrito — divergiria do contrato GET/PATCH e quebraria a hierarquia sobre categorias globais (uso legítimo). O filtro `household_id` continua a bloquear referenciar uma categoria *per-household* de OUTRO household.

- **D-SEC1.1 — Categorias globais `[id]` PATCH/DELETE:** mantidas read-only (filtro estrito `household_id = ${auth.householdId}::uuid`, sem `OR IS NULL`). Globais não pertencem a nenhum household → 0 rows → 404. Preserva exactamente o contrato pré-existente (a RLS `categories_update_member` exigia `household_id NOT NULL`). GET e validação de `parent_id` mantêm `OR household_id IS NULL` (globais readable / usáveis como pai). Alternativa rejeitada: 403 explícito para globais — adicionaria um SELECT extra e divergiria do contrato 404 actual.

### File List

**Source (app-enforced filters):**
> Nota SEC-1-F1 (v1.3): os 5 handlers `route.ts` de Finanças que validam FK no POST (`transacoes`, `recorrencias`, `prestacoes`, `cartoes`, `categorias`) tiveram as sub-queries de FK-check filtradas por `household_id` — `prestacoes/route.ts` e `cartoes/route.ts` adicionados à lista nesta iteração; os restantes já constavam (tinham listagem filtrada).
- `apps/web/src/app/api/financas/contas/route.ts`
- `apps/web/src/app/api/financas/contas/[id]/route.ts`
- `apps/web/src/app/api/financas/cartoes/route.ts` (SEC-1-F1 — FK-check household)
- `apps/web/src/app/api/financas/cartoes/[id]/route.ts`
- `apps/web/src/app/api/financas/transacoes/route.ts`
- `apps/web/src/app/api/financas/transacoes/[id]/route.ts`
- `apps/web/src/app/api/financas/categorias/route.ts`
- `apps/web/src/app/api/financas/categorias/[id]/route.ts`
- `apps/web/src/app/api/financas/recorrencias/route.ts`
- `apps/web/src/app/api/financas/recorrencias/[id]/route.ts`
- `apps/web/src/app/api/financas/prestacoes/route.ts` (SEC-1-F1 — FK-check household)
- `apps/web/src/app/api/financas/prestacoes/[id]/route.ts`
- `apps/web/src/lib/api-helpers/list-tasks.ts`
- `apps/web/src/app/api/recurrences/route.ts`
- `apps/web/src/app/api/recurrences/[id]/route.ts`
- `apps/web/src/app/api/tags/route.ts`
- `apps/web/src/app/api/tags/[id]/route.ts`
- `apps/web/src/app/api/kanban-columns/route.ts`
- `apps/web/src/app/api/kanban-columns/[id]/route.ts`
- `apps/web/src/app/api/tasks/[id]/route.ts`
- `apps/web/src/app/api/tasks/[id]/move/route.ts`
- `apps/web/src/app/api/tasks/[id]/tags/route.ts`
- `apps/web/src/app/api/tasks/[id]/tags/[tagId]/route.ts`
- `apps/web/src/lib/visao/queries.ts`
- `apps/web/src/app/(app)/visao/page.tsx`
- `apps/web/src/app/(app)/visao/_components/WidgetGrid.tsx`
- `apps/web/src/app/(app)/visao/_components/widgets/TasksTodayWidget.tsx`
- `apps/web/src/app/(app)/visao/_components/widgets/TasksOverdueWidget.tsx`
- `apps/web/src/app/(app)/visao/_components/widgets/FinanceMonthWidget.tsx`
- `apps/web/src/app/(app)/visao/_components/widgets/RecurrencesNextWidget.tsx`
- `apps/web/src/app/(app)/visao/_components/widgets/AccountsBalanceWidget.tsx`
- `apps/web/src/app/(app)/visao/_components/widgets/CalendarWeekWidget.tsx`
- `apps/web/src/app/(app)/visao/_components/widgets/BriefingWidget.tsx`
- `apps/web/src/app/api/visao/tarefas-hoje/route.ts`
- `apps/web/src/app/api/visao/tarefas-atrasadas/route.ts`
- `apps/web/src/app/api/visao/saldo-contas/route.ts`
- `apps/web/src/app/api/visao/recorrencias-proximas/route.ts`
- `apps/web/src/app/api/visao/financas-mes/route.ts`
- `apps/web/src/app/api/visao/calendario-semana/route.ts`
- `apps/web/src/app/api/agent/prompt/route.ts`
- `apps/web/src/app/api/agent/prompt/[runId]/confirm/route.ts` (SEC-1-F3 — verificação de pertença ao household)
- `apps/web/src/app/api/agent/prompt/[runId]/undo/route.ts` (SEC-1-F3 — verificação de pertença ao household)
- `apps/web/src/app/api/kanban-columns/batch/route.ts` (SEC-1-F4 — filtro household inline nas mutações por id)
- `packages/db/src/client.ts` (SQL injection fix)

**Tests:**
- `packages/db-test/src/tests/cross_tenant_isolation.test.ts` (novo — AC-K1)
- `apps/web/src/app/api/financas/contas/__tests__/route.test.ts` (AC-K2 + helper boundParamValues)
- `apps/web/src/app/api/financas/transacoes/__tests__/route.test.ts` (SEC-1-F1 — +2 testes FK-check household; helper boundParamValues local)
- `apps/web/src/app/api/financas/recorrencias/__tests__/route.test.ts` (SEC-1-F1 — +1 teste FK-check household; helper boundParamValues local)
- `apps/web/src/app/(app)/visao/__tests__/page.test.tsx` (mock resolveHouseholdId)
- `apps/web/src/app/(app)/visao/_components/__tests__/WidgetGrid.test.tsx` (prop householdId)
- `apps/web/src/app/(app)/visao/_components/__tests__/widgets.test.tsx` (prop householdId)
- `apps/web/src/app/api/agent/prompt/__tests__/confirm.test.ts` (SEC-1-F3 — +4 testes cross-household; setupAuth já mockava `.from()`)
- `apps/web/src/app/api/agent/prompt/__tests__/undo.test.ts` (SEC-1-F3 — +4 testes cross-household; setupAuth `.from()` corrigido)
- `apps/web/src/app/api/kanban-columns/batch/__tests__/route.test.ts` (SEC-1-F4 — novo; household bound nas mutações)

---

## QA Results

### Architect Re-Gate FINAL (Aria) — 2026-06-02 (QA Loop it.2)

**Verdict: PASS — 9,4/10.** Gate file: `docs/qa/gates/SEC-1-architect-gate.md` (re-gate it.2 final). **Status → Done v1.4-ARCH-APPROVED.**

**SEC-1-F3 VERIFICADO FECHADO** — `confirm/route.ts:101-118` e `undo/route.ts:101-118`: `resolveHouseholdId(user.id)` + lookup `agent_runs where id = ${runId}::uuid and household_id = ${userHouseholdId}::uuid`. Sem household → 404 antes da DB; cross-household → 0 rows → 404 (não revela existência). Cadeia fechada: Planner+Executor (confirm `:194-222`) e `getServiceDb()` (undo `:182`) só alcançados após a verificação de pertença. Docblocks corrigidos (premissa "RLS bloqueia cross-household" removida).

**SEC-1-F4 VERIFICADO FECHADO** — `kanban-columns/batch/route.ts` 4 mutações por `id` (`:246-251` update tasks, `:253-257` delete coluna, `:306-311` sort_order trick, `:323-328` update final) com `and household_id = ${auth.householdId}::uuid` inline.

**Testes F3 não-tautológicos** — `confirm.test.ts` (8): `:92-97` boundParamValues prova household bound na query; `:99-110` cross-household → 404 + `plannerPlanMock`/`executorExecuteMock` **nunca chamados**; `:112-123` sem-household → 404 + `dbExecuteMock` **nunca chamado**. `undo.test.ts` (14) análogo (serviceDb nunca aplica reverse ops cross-tenant); bug latente corrigido (`setupAuth` mocka `.from('household_members')`). `batch/route.test.ts:170-172` prova household bound. SÓLIDO.

**Varredura adversarial INDEPENDENTE (ponto crítico do re-gate)** — não confiei na tabela do @dev; grep próprio de `getUser(`, `where id = ${`, `from/update/delete public.`, mutações de domínio em `apps/web/src/app/api/**` + `lib/**`:
- Handlers `getUser()` directo (`me:119-124` PostgREST RLS-via-JWT; `agent/prompt:112`; `conta/preferencias:111,218`; `conta/household:112,134,319-328`) — household derivado do próprio user, nunca user-controlled → SEGUROS.
- Todos os `id`/FK user-controlled (confirm/undo `runId`; FK dos POST/`[id]` de Finanças/Tarefas) filtrados por `household_id`; category FKs com `or household_id is null` (AC-E1 — verificado `transacoes/route.ts:265`, `transacoes/[id]:200`, `recorrencias/route.ts:205`, `recorrencias/[id]:184`, `prestacoes/route.ts:154`, `categorias/route.ts:155`, `categorias/[id]:80,150`).
- `conta/household/invites/[id]:59-61` + `members/[userId]:64-92` — delete por `household_id`+role guard → SEGUROS.
- `lib/agent/audit-log.ts` (4×`update agent_runs where id=${runId}`) + `idempotency.ts:106-108` — operam por runId/household **já validados** pelo handler chamador → não alcançáveis cross-tenant.
- `lib/inngest/functions/*` — `getServiceDb()` exclusivo, jobs iteram todos os households por design → LEGÍTIMO.

**Veredicto da varredura: zero vectores de isolamento cross-tenant residuais em apps/web.** A afirmação de exaustividade do @dev está confirmada independentemente.

**D-SEC1.3 RATIFICADA (APPROVE)** — fechar o F4 (kanban-batch) apesar de LOW elimina dependência da ordem de validação (`validateInput`), custo baixo, backward-compatible (422 a montante inalterado). Alinhado com o mandato anti-whack-a-mole.

**6 gates re-corridos independentemente:** lint PASS (exit 0), typecheck PASS, check:rls PASS, build PASS, web **1068/1068 (0 flaky — `tarefas/calendario` passou na suite completa nesta execução, confirma definitivamente flaky≠regressão)**, db-test 164/164 (Docker UP, Postgres 16 real). 0 regressões.

**Declaração de segurança:** a superfície de domínio de `apps/web` está livre de vectores de isolamento cross-tenant conhecidos — isolamento 100% app-enforced (filtro inline `household_id`, RLS-via-JWT do PostgREST, ou household derivado do próprio user). **Ressalva:** a RLS Postgres continua inerte em runtime (`getDb()` liga como role bypassrls); o hardening RLS-enforced (defense-in-depth) fica para story posterior a cargo de `@architect` + `@data-engineer`, fora do âmbito desta story. ACHADO-1 / `accept_invite` / Story 6.7 também fora de âmbito.

**Status:** **Done v1.4-ARCH-APPROVED.** Próximo passo: `@devops *push` (exclusivo — sem migrations, todo o fix é app-code).

---

### Dev — SEC-1-F3 fechado + sweep alargada (Dex, @dev) — 2026-06-02 (QA Loop it.2)

> Nota: secção informativa do @dev para o re-gate (a autoria oficial de QA Results é do @qa/@architect). Documenta a sweep exaustiva exigida pelo re-gate para confirmação de exaustividade.

**SEC-1-F3 FECHADO** — `confirm/route.ts:97` e `undo/route.ts:96` resolvem `resolveHouseholdId(user.id)` e filtram a lookup de `agent_runs` por `household_id` app-enforced. Cross-household → 404; sem household → 404 antes de tocar na DB. Docblocks falsos corrigidos. Testes provam (via `boundParamValues`) que o household autenticado é bound na query e que Planner/Executor (confirm) e service_role (undo) NUNCA executam no path cross-household.

**SEC-1-F4 FECHADO** (era o F2 LOW) — `kanban-columns/batch` 4 mutações por `id` com `household_id` inline. [DEV-DECISION D-SEC1.3].

**Sweep alargada `apps/web/src/app/api/**` + `lib/**` — classificação completa:**

| Superfície | Padrão | Veredicto |
|------------|--------|-----------|
| `me/route.ts` | `getUser()` directo + PostgREST | SEGURO — RLS-via-JWT + filtro `user_id` |
| `agent/prompt/route.ts` | `getUser()` + resolve household próprio | SEGURO — household nunca user-controlled |
| `agent/prompt/[runId]/confirm` | `getUser()` + runId user-controlled | **F3 — FECHADO** (filtro household + 404) |
| `agent/prompt/[runId]/undo` | `getUser()` + runId user-controlled | **F3 — FECHADO** (filtro household + 404) |
| `conta/household/route.ts` | `getUser()` + household próprio | SEGURO |
| `conta/preferencias/route.ts` | `getUser()` + filtro `user_id` | SEGURO |
| `conta/household/members/[userId]` | `requireAuth` + `auth.householdId` | SEGURO |
| `conta/household/invites/[id]` | `requireAuth` + `auth.householdId` | SEGURO |
| `conta/household/invites/route.ts` | `requireAuth` + `auth.householdId` | SEGURO |
| `conta/household/aceitar-convite` | accept_invite flow | FORA DE ÂMBITO (Story 6.7) |
| Finanças (contas/cartões/transações/categorias/recorrências/prestações `route.ts`+`[id]`) | `where id`/FK por `id` | SEGURO — `household_id` (v1.2/v1.3) |
| Tarefas/Kanban/Tags/Recurrences (`route.ts`+`[id]`+sub-rotas) | `where id` | SEGURO — `household_id` (v1.2) |
| `kanban-columns/batch` | mutações por `id` na transacção | **F4 — FECHADO** (filtro inline) |
| `lib/agent/cost-router.ts`, `rate-limiter.ts` | queries por `household_id` | SEGURO |
| `lib/visao/queries.ts`, `lib/api-helpers/list-tasks.ts` | filtro `household_id` (v1.2 T9/T6) | SEGURO |
| `lib/agent/audit-log.ts` | `update agent_runs where id = ${runId}` | SEGURO — runId já validado pelo handler chamador |
| `lib/inngest/functions/*` | mutações por `id` cross-household | LEGÍTIMO — jobs iteram todos os households por design |

**Veredicto da sweep:** zero queries de domínio ou handlers de escrita sem isolamento por household em `apps/web` após it.2. Nenhum novo vector encontrado além do F3 (bloqueador) e do F4 (defesa-em-profundidade, já não-explorável).

**6/6 gates GREEN** (evidência real, ver Debug Log References SEC-1-F3): lint 0w · typecheck · web 1067/1068 (flaky calendario isolado 1296ms) · db-test 164/164 (Docker UP) · check:rls · build.

---

### Architect Re-Gate (Aria) — 2026-06-02 (QA Loop it.1)

**Verdict: FAIL — 6,5/10.** Gate file: `docs/qa/gates/SEC-1-architect-gate.md` (actualizado para re-gate it.1).

**SEC-1-F1 VERIFICADO FECHADO** — as 10 sub-queries de validação de FK dos 5 POST de Finanças filtram agora `household_id` (transações `route.ts:242,253,265`; recorrências `:182,193,205`; prestações `:143,154`; cartões `:156`; categorias-parent `:155`). Comentários falsos corrigidos. Testes não-tautológicos: `boundParamValues()` extrai os parâmetros bound do objecto `SQL` Drizzle e assere `HOUSEHOLD_UUID` na sub-query de FK-check (`transacoes/route.test.ts:213-242`) — sem o filtro `and household_id` o teste falharia. Cobertura 10/10 dentro do escopo F1.

**D-SEC1.2 RATIFICADA (APPROVE)** — `OR household_id IS NULL` na validação de `parent_id` (`categorias/route.ts:155`) é coerente com GET (`:90`) e parent na rota `[id]` (`:80`); o filtro `household_id` bloqueia parents per-household de outro household, só globais (sem dono) são parents válidos. Não reabre vector.

**6 gates re-corridos independentemente:** lint PASS (exit 0), typecheck PASS, check:rls PASS, build PASS, web 1060/1061 (flaky `tarefas/calendario/page.test.tsx` confirmado isolado 1356ms < 5000ms — não-regressão, mocka getDb), db-test 164/164 (Docker UP, Postgres 16 real). 0 regressões.

**Bloqueador novo — SEC-1-F3 (HIGH/CRITICAL):** a varredura adversarial final (exigida pelo re-gate) encontrou um IDOR cross-tenant de **escrita/execução** nas sub-rotas de agent runs, fora do catálogo da auditoria (`CROSS-TENANT-AUDIT` cobria `agent/prompt/route.ts` L13, não confirm/undo):
- `api/agent/prompt/[runId]/confirm/route.ts:97-103` — `select ... from agent_runs where id = ${runId}::uuid` sem `household_id` nem verificação de pertença; depois executa Planner+Executor com `householdId: run.household_id` (`:182,203`).
- `api/agent/prompt/[runId]/undo/route.ts:96-101` — idem; aplica reverse ops via `getServiceDb()` (`:167-183`).

Ambos autenticam via `supabase.auth.getUser()` mas **nunca comparam o household do utilizador com `run.household_id`**. O comentário "RLS bloqueia cross-household" (confirm:16,96; undo:95) é a premissa falsa que esta story existe para refutar. Vector: um membro do household B com um `runId` do household A executa (confirm, janela 5 min) ou reverte (undo, janela 30s) mutações financeiras/tarefas reais do household A. Mais grave que o F1 (que era probe-oracle + integridade FK). 

**FAIL (não CONCERNS)** porque o vector residual é de severidade superior ao já fechado, num hotfix de segurança CRITICAL cujo âmbito é "dados do meu household nunca acessíveis a outro household através de qualquer rota da API".

**SEC-1-F2 (LOW, não bloqueia):** `kanban-columns/batch` muta por `id` sem household inline mas protegido por guard `validateInput` prévio (422). Não explorável.

**Status:** mantém `Ready for Review`. Retorno ao @dev (QA Loop it.2): fechar F3 (verificação de pertença → 404 cross-household em confirm:97 e undo:96 + 1 teste de rota por handler + corrigir docblocks). Após fix + re-verificação → PASS expectável → Done `v1.4-ARCH-APPROVED`. NÃO marcar Done agora.

---

### Architect Gate (Aria) — 2026-06-02

**Verdict: CONCERNS — 8,4/10.** Gate file: `docs/qa/gates/SEC-1-architect-gate.md`.

**Cobertura da auditoria: 26/26 (13 LEAK + 13 IDOR) + SQLi = 100%** — todas as queries L1–L13 e I1–I13 verificadas com evidência ficheiro:linha (ver tabela no gate file). J1 SQL injection parametrizado (`client.ts:100`). 5 gates re-corridos independentemente: lint PASS, typecheck PASS, web 1057/1058 (flaky `tarefas/calendario` confirmado isolado 1351ms — não-regressão), db-test 164/164 (Docker real), check:rls PASS, build PASS. Teste de isolamento AC-K1 sólido e não-tautológico; AC-K2 (`boundParamValues`) prova o filtro na query.

**D-SEC1.1 RATIFICADA (APPROVE)** — categorias globais `[id]` read-only (404 no PATCH/DELETE) preserva o contrato `categories_update_member`; GET + parent validation mantêm `or is null`; listagem mantém globais visíveis (AC-E1 intacto).

**Bloqueador para Done — SEC-1-F1 (MEDIUM-HIGH):** varredura adversarial independente encontrou IDOR de escrita nas **sub-queries de validação de FK dos handlers POST de Finanças** (transações `:239,248,257`; recorrências `:180,189,198`; prestações `:140,148`; cartões `:155`; categorias parent `:150`). Validam FK por `id` apenas, sem `household_id` — premissa "RLS-scoped" falsa em runtime (RLS inerte é a própria razão desta story). Vector: probe-oracle de existência cross-tenant + referências FK cross-tenant. Inconsistência (não decisão): o PATCH dos mesmos recursos JÁ aplica o filtro correctamente (`transacoes/[id]:175,186,200`). Fix: 1 linha por sub-query (padrão já provado) + 1-2 testes POST cross-household.

**SEC-1-F2 (LOW, não bloqueia):** `kanban-columns/batch` muta por `id` sem household inline, mas protegido por guard `validateInput` prévio (rejeita 422 ids fora do household) — não explorável, defesa-em-profundidade a reforçar.

**Status:** mantém `Ready for Review`. Retorno ao @dev para fechar SEC-1-F1 antes do push (segurança primeiro). Após fix + re-verificação → PASS expectável → Done v1.3-ARCH-APPROVED. NÃO marcar Done agora.
