# Story SEC-5: Tarefas (API handlers) — RLS enforced em runtime (2.ª rede, ADR-003 Fatia A)

> **ID:** `SEC-5` (segurança transversal — Fase 4 do ADR-003, Fatia A). Story cross-epic, não pertence a epic numerado.
> **Depende de:** SEC-2 (Done, `98c8176`) — wrapper `withHousehold` + gate de aplicação em produção; SEC-3 (Done, `ec96445`) — padrão de migração de route handlers (insertAuditLog best-effort fora do withHousehold).
> **Scoping prévio:** ADR-003 Adenda §11 (@architect Aria, 03/06/2026) — split da cauda em 4 fatias; SEC-5 = Fatia A (Tarefas), GO mecânico.
> **Handoff consumido:** `mj-handoff-sec5-kickoff-tarefas-rls-20260603` (architect → sm).

## Status

**Done v1.2 — Gate PASS (@architect Aria, 03/06/2026).** Gate adversarial: PASS, quality score 96/100, confiança ALTA. Ponto pivotal auditado e confirmado — `withHousehold` (`client.ts:132`) usa `pgSql.begin()` com rollback automático no throw; atomicidade do `batch` (BatchInvariantError→rollback→422) e do `recurrences POST` (2 escritas atómicas) correctas. Achado positivo: substituiu o `begin/commit` inline não-fiável em pgbouncer transaction-mode por transação real (endurecimento, não regressão). Invariantes reproduzidos (0 getServiceDb, 0 begin/commit, 43 filtros 1.ª rede, 16 audit fora, 5 read-only sem getDb). 9 ACs cobertos, 6 gates verdes. 2 observações LOW cosméticas (não-bloqueantes). Aguarda `@devops` push.

> **Ready for Review v1.1 (@dev Dex, 03/06/2026).** Implementação completa: 21 call-sites migrados em 12 handlers (16 mutação + 5 read-only), `begin/commit` inline substituído pelo `withHousehold` nos 4 handlers complexos, gate de aplicação estendido (tags/task_tags/kanban_columns/task_recurrences). Todos os 6 quality gates verdes (lint, typecheck, web test 88/88 nos domínios, db-test 196, build, check:rls). Sem migration. Aguarda `@architect` qa-gate (atenção adversarial dedicada a `batch` + `recurrences POST` por [PO-DECISION-1]).

> **Approved v1.0 — GO (@po Pax, 03/06/2026).** Validação completa: GO, readiness 9,5/10, confiança ALTA. Premissas verificadas independentemente pelo @po (grep 03/06): `withHousehold` em `client.ts:119` + `db-shim.ts:79` ✓; `GET /api/tasks` já migrado (piloto SEC-2) ✓; 1.ª rede presente (43 filtros `household_id` nas queries de domínio) ✓; `getServiceDb` introduções = 0 ✓; **21 call-sites `const db = getDb()` confirmados** (grep devolve 23 — 2 são comentários em `tasks/route.ts:19` e `move/route.ts:9`; reais = 21, batem byte-a-byte com a tabela). Premissa anti-leak (SM-OBS-3) **confirmada** — não há leak nesta superfície. **[PO-DECISION-1] SM-OBS-1 ratificado: manter SEC-5 junto (não sub-dividir).** Pronta para `@dev *develop SEC-5`.

> Histórico: Draft v0.1 (@sm River) — verificação byte-a-byte do domínio Tarefas. Os 12 handlers já têm 1.ª rede (app-enforced `household_id = ${auth.householdId}::uuid` em TODAS as queries) + `requireAuth` + `insertAuditLog`. SEC-5 é **puramente aditivo** (só 2.ª rede `withHousehold`), padrão idêntico a SEC-3. [SM-DECISION-1]: SEC-5 cobre só os 12 API handlers (21 call-sites); as 3 SSR pages `tarefas/*` vão para SEC-6.

## Executor Assignment

```
executor: "@dev"
quality_gate: "@architect"
quality_gate_tools: ["lint", "typecheck", "test", "build", "check:rls"]
```

## Story

**As a** engenheiro/product owner da Expressia,
**I want** que os 12 route handlers do domínio Tarefas (`/api/tasks/*`, `/api/kanban-columns/*`, `/api/tags/*`, `/api/recurrences/*`) corram as suas operações de domínio dentro de `withHousehold(auth, fn)` — activando a RLS viva em runtime (2.ª rede),
**so that** o domínio Tarefas tenha a mesma defense-in-depth de duas redes que os domínios Finanças (`/api/financas/*`, SEC-3) e o piloto `GET /api/tasks` (SEC-2) já têm — uma query nova sem filtro `household_id` deixa de ser um vazamento cross-tenant silencioso porque o Postgres apanha-a por baixo da aplicação.

---

## Contexto e âmbito

### Diferença-chave face a SEC-4 (ler primeiro)

SEC-4 revelou que as SSR pages de Finanças **não tinham** 1.ª rede (app-enforced) — era um leak live. **Verifiquei o mesmo risco aqui e NÃO existe:** grep confirma que os 12 handlers de Tarefas têm `and household_id = ${auth.householdId}::uuid` em **todas** as queries de domínio (1.ª rede presente desde SEC-1). Logo SEC-5 é só a 2.ª rede — exactamente o caso de SEC-3, não de SEC-4. **Não há âmbito expandido; não há leak a fechar.**

### O que já existe (não reimplementar)

- `withHousehold<T>(auth, fn)` em `packages/db/src/client.ts:119`, re-exportado por `apps/web/src/lib/agent/db-shim.ts:79`. Produção desde SEC-2.
- Padrão de migração de **route handler de mutação** provado em SEC-3 (12 handlers `/api/financas/*`): operação de domínio dentro de `withHousehold`, `insertAuditLog` best-effort **fora** em `getDb()` (PO-FIX-2 / D-SEC3).
- Padrão de migração de **handler read-only** (sem audit): wrap do read em `withHousehold`, `getDb()` removido por completo (mirror SEC-4 SSR, que eram read-only).
- Piloto já migrado: `GET /api/tasks` (`tasks/route.ts:89`, SEC-2) — referência viva da forma exacta.
- `requireAuth(span)` (`apps/web/src/lib/api-helpers/auth.ts:63`) devolve `{ userId, householdId }` em todos os 12 handlers — fonte de `auth` para `withHousehold`.

### Ficheiros-alvo — 12 handlers, 21 call-sites `getDb()`

> Linhas verificadas byte-a-byte (grep 03/06/2026). `GET`/leitura = read-only (getDb removido); restantes = mutação (getDb mantido só para audit).

| # | Ficheiro | Handler(s) | `getDb()` linha | `insertAuditLog`? |
|---|----------|-----------|-----------------|-------------------|
| 1 | `api/tasks/route.ts` | **POST** (GET já feito SEC-2 — NÃO tocar) | :144 | :177 |
| 2 | `api/tasks/[id]/route.ts` | GET (read) | :51 | — |
| 3 | `api/tasks/[id]/route.ts` | PATCH | :116 | :158 |
| 4 | `api/tasks/[id]/route.ts` | DELETE | :203 | :218 |
| 5 | `api/tasks/[id]/move/route.ts` | POST | :72 | :146 (+ re-fetch :168) |
| 6 | `api/tasks/[id]/tags/route.ts` | POST | :62 | :88 |
| 7 | `api/tasks/[id]/tags/[tagId]/route.ts` | DELETE | :45 | :59 |
| 8 | `api/kanban-columns/route.ts` | GET (read) | :79 | — |
| 9 | `api/kanban-columns/route.ts` | POST | :128 | :186 |
| 10 | `api/kanban-columns/[id]/route.ts` | PATCH | :88 | :169 |
| 11 | `api/kanban-columns/[id]/route.ts` | DELETE | :267 | :347 |
| 12 | `api/kanban-columns/batch/route.ts` | POST (helpers módulo `:83`/`:114` recebem `householdId`) | :209 | :376 |
| 13 | `api/tags/route.ts` | GET (read) | :55 | — |
| 14 | `api/tags/route.ts` | POST | :124 | :135 |
| 15 | `api/tags/[id]/route.ts` | PATCH | :62 | :88 |
| 16 | `api/tags/[id]/route.ts` | DELETE | :148 | :161 |
| 17 | `api/recurrences/route.ts` | GET (read) | :70 | — |
| 18 | `api/recurrences/route.ts` | POST | :122 | :173 |
| 19 | `api/recurrences/[id]/route.ts` | GET (read) | :55 | — |
| 20 | `api/recurrences/[id]/route.ts` | PATCH | :114 | :192 |
| 21 | `api/recurrences/[id]/route.ts` | DELETE | :235 | :249 |

**Read-only (5 handlers — getDb removido por completo):** #2, #8, #13, #17, #19.
**Mutação (16 handlers — getDb mantido só para `insertAuditLog`):** os restantes.

### Fora de âmbito (NÃO tocar nesta story)

- **3 SSR pages `tarefas/*`** (`(app)/tarefas/{page,kanban,calendario}/page.tsx`) → **SEC-6** ([SM-DECISION-1]).
- `GET /api/tasks` (`tasks/route.ts:89`) — já migrado em SEC-2.
- Helper puro `lib/api-helpers/list-tasks.ts` — `db`-injectável, intacto (G1; já usado pelo GET migrado).
- `getServiceDb()` / jobs Inngest (recorrências) — intocáveis por design.
- Outros domínios (Visão → SEC-6/7; Household → SEC-7; Cérebro AI → SEC-8 HOLD).

---

## Acceptance Criteria

### AC1 — `withHousehold` envolve a operação de domínio dos 21 call-sites em 12 handlers (2.ª rede — RLS viva)

Cada um dos 21 call-sites migra a sua operação de domínio para dentro de `withHousehold({ userId: auth.userId, householdId: auth.householdId }, (tx) => …)`, com **todas as queries de domínio do handler a usarem `tx`** (não `getDb()`). Forma de referência = `GET /api/tasks` (`tasks/route.ts:89-99`, SEC-2) e o padrão de mutação SEC-3.

Padrão handler de mutação (ex.: `DELETE /api/tasks/[id]`):

```typescript
const db = getDb();                                  // MANTIDO só para o audit (AC2)
const task = await withHousehold(
  { userId: auth.userId, householdId: auth.householdId },
  async (tx) => {
    const rows = await tx.execute<…>(sql`update … where id = ${id}::uuid
      and household_id = ${auth.householdId}::uuid returning …`);   // 1.ª rede MANTIDA
    const t = rows[0];
    if (!t) { /* … 404 handling igual ao actual … */ }
    return t;
  },
);
// insertAuditLog best-effort FORA do withHousehold (AC2)
```

Padrão handler read-only (ex.: `GET /api/tasks/[id]`): o read corre dentro de `withHousehold`; **não há `const db = getDb()`** (removido — AC4).

### AC2 — `insertAuditLog` best-effort fica FORA do `withHousehold`, em `getDb()` (16 handlers de mutação)

Idêntico ao PO-FIX-2 de SEC-3: o `insertAuditLog` permanece em `getDb()` (best-effort, try/catch que só faz `log.warn`), **fora** do callback `withHousehold`. Os 16 handlers de mutação mantêm `const db = getDb()` exclusivamente para esta chamada. O `entityId`/`afterState` que o audit precisa vêm do valor devolvido pelo callback `withHousehold` (ex.: `task.id`).

> Racional (D-SEC3): o audit é observabilidade não-crítica; mantê-lo fora da transação RLS evita que uma falha de audit reverta a operação de domínio e mantém o comportamento exacto provado em SEC-3. **NÃO mover `insertAuditLog` para dentro do `withHousehold`.**

### AC3 — Todas as queries de domínio de um handler partilham o MESMO `withHousehold`

Handlers com múltiplas queries de domínio (ex.: `kanban-columns POST` — check de unicidade + max sort_order + insert; `tasks/[id]/move POST` — fetch + validação coluna + update + re-fetch; `kanban-columns/[id]` e `batch`) correm **todas** essas queries dentro de **um único** callback `withHousehold` (partilham transação/contexto RLS). Excepção única: o `insertAuditLog` (AC2), que fica fora. Se um handler faz re-fetch do estado final **após** o audit (ex.: `move:168`, `batch:393`), esse re-fetch é também uma query de domínio e corre dentro de `withHousehold` (o @dev decide a composição exacta — pode devolver o estado final do próprio callback de mutação, evitando 2.ª transação; preservar o comportamento/resposta actual).

### AC4 — `getDb()` REMOVIDO dos 5 handlers read-only

Os 5 handlers read-only (#2 `tasks/[id]` GET, #8 `kanban-columns` GET, #13 `tags` GET, #17 `recurrences` GET, #19 `recurrences/[id]` GET) não fazem `insertAuditLog` — logo `const db = getDb()` é **removido por completo** e o read corre via `tx` do `withHousehold`. Se um ficheiro tiver handlers mistos (ex.: `tasks/[id]/route.ts` tem GET read-only + PATCH/DELETE de mutação; `kanban-columns/route.ts` GET + POST; `tags/route.ts` GET + POST; `recurrences/route.ts` GET + POST; `recurrences/[id]/route.ts` GET + PATCH + DELETE), o import de `getDb` **mantém-se** no ficheiro (usado pelos handlers de mutação) mas o handler GET deixa de o chamar.

### AC5 — Import via `db-shim.ts`; `requireAuth`, guards e respostas de erro INALTERADOS

- `withHousehold` importado de `@/lib/agent/db-shim` (nunca directo de `@meu-jarvis/db/client` — break tsc cross-package, `db-shim.ts:5-18`). Nos ficheiros que já importam `getDb` do shim, adicionar `withHousehold` ao mesmo import (`import { getDb, withHousehold } from '@/lib/agent/db-shim'`); nos read-only puros, trocar `getDb`→`withHousehold`.
- `requireAuth(span)` e o early-return `if (auth instanceof NextResponse) return auth` ficam **exactamente como estão**.
- Toda a lógica de validação (Zod), códigos de erro, status HTTP, `404 NOT_FOUND`, `409`, `captureException`, `annotateSpan` e mensagens PT-PT ficam **inalterados**. A migração é puramente do veículo de execução das queries (`getDb()` → `tx`).

### AC6 — 1.ª rede (app-enforced) MANTIDA; `getServiceDb()`/jobs/helper puro NÃO tocados

- O filtro `household_id = ${auth.householdId}::uuid` (parâmetro bound) **mantém-se em todas as queries** — `withHousehold` é a 2.ª rede, não substitui a 1.ª. Nenhum filtro removido. Grep pós-implementação deve mostrar o mesmo número de filtros `household_id` (ou mais), nunca menos.
- Nenhum handler passa a usar `getServiceDb()` (grep: zero introduções).
- `lib/api-helpers/list-tasks.ts` (puro) intacto. As funções-helper de módulo em `kanban-columns/batch/route.ts` (`:83`/`:114`, que já recebem `householdId`) passam a receber o `tx` (em vez de criarem/usarem `getDb()`), se aplicável — confirmar que recebem o cliente por parâmetro e propagar `tx`.

### AC7 — Testes dos handlers migrados: mock `withHousehold` + regressão bound-param mantida

Para cada handler migrado, o teste correspondente passa a mockar `withHousehold` no mock de `@/lib/agent/db-shim`, no padrão já estabelecido em SEC-2 (`api/tasks/__tests__/list.test.ts:28-50`):

```typescript
vi.mock('@/lib/agent/db-shim', () => ({
  getDb: () => fakeDb,                                  // mantido p/ handlers de mutação (audit)
  withHousehold: (_auth: unknown, fn: (tx: unknown) => unknown) => fn(fakeDb),
}));
```

1. Os testes existentes que asseriam o `household_id` nos params bound (1.ª rede — regressão SEC-1) **mantêm-se verdes** (o filtro não muda).
2. Pelo menos um teste por ficheiro confirma que a operação de domínio corre via `withHousehold` (ex.: assert que o mock `withHousehold` foi chamado, ou que as queries passam pelo `tx` injectado). Reaproveitar o util/abordagem de `list.test.ts`.
3. Os testes de leak-prevention existentes (Zod rejeita `household_id` em payload — AC8 das stories originais) ficam intactos.

### AC8 — Gate de aplicação cobre as tabelas tocadas

O gate de aplicação real `packages/db-test/src/tests/rls-application.test.ts` (15 testes desde SEC-3) prova a 2.ª rede com role runtime. Verificar a cobertura das tabelas deste domínio (`tasks`, `tags`, `task_tags`, `kanban_columns`, `recurrences`):
1. Se já cobertas (tasks foi piloto SEC-2 — confirmar), garantir que continuam VERDES.
2. Se alguma tabela tocada **não** estiver coberta pelo gate de aplicação, **estender o gate** com ≥1 caso de isolamento cross-household para essa tabela (mirror dos casos `accounts`/`transactions`/`categories` de SEC-3). Mandatório para as tabelas onde a 2.ª rede passa a ser a defesa testada.

### AC9 — Gates de qualidade TODOS VERDES; sem migration

`pnpm lint` · `pnpm typecheck` · `pnpm test` (web + db-test Docker) · `pnpm build` · `pnpm check:rls` — todos exit 0. **Sem migration SQL nova** (104 policies intactas desde `0001_rls_policies.sql` — NÃO correr `db:migrate`).

---

## Tasks / Subtasks

- [x] **T1 — `api/tasks/*` (tasks core)** (AC1, AC2, AC3, AC4, AC5, AC6, AC7)
  - [x] T1.1 `tasks/route.ts` POST: operação INSERT dentro de `withHousehold`; `getDb()` mantido p/ audit. GET (SEC-2) intacto.
  - [x] T1.2 `tasks/[id]/route.ts`: GET read-only → `getDb` removido; PATCH e DELETE → mutação dentro de `withHousehold`, audit fora. Import `getDb` mantido (PATCH/DELETE).
  - [x] T1.3 `tasks/[id]/move/route.ts` PATCH: fetch + validação coluna + shift + update + re-fetch no mesmo `withHousehold` (retorno discriminado p/ 404; 409 unique no catch externo); audit fora. `begin/commit` inline removido.
  - [x] T1.4 `tasks/[id]/tags/route.ts` POST (check+insert no withHousehold, retorno discriminado) e `tasks/[id]/tags/[tagId]/route.ts` DELETE.
  - [x] T1.5 Tests dos 4 ficheiros: mock `withHousehold` (padrão `list.test.ts`); sequências move actualizadas (sem begin/commit); regressão bound-param verde.

- [x] **T2 — `api/kanban-columns/*`** (AC1, AC2, AC3, AC4, AC5, AC6, AC7)
  - [x] T2.1 `kanban-columns/route.ts`: GET read-only → `getDb` removido; POST → count + dup + max sort + insert no mesmo `withHousehold` (retorno discriminado p/ 409).
  - [x] T2.2 `kanban-columns/[id]/route.ts`: PATCH e DELETE no `withHousehold` por handler (retorno discriminado p/ 404/409/400; `resolveHouseholdRole` fora). `begin/commit` inline removido.
  - [x] T2.3 `kanban-columns/batch/route.ts` PATCH: validateInput + snapshot + deletes + creates + updates (trick sort_order shift+offset) + validateInvariants + fetch final num único `withHousehold`; helpers `validateInput`/`validateInvariants` recebem `tx`; 422 via `BatchInvariantError` (rollback por throw).
  - [x] T2.4 Tests dos 3 ficheiros (incl. `batch/__tests__/route.test.ts` SEC-1-F4 — `household_id` bound mantido; sequências route.test.ts sem begin/commit).

- [x] **T3 — `api/tags/*`** (AC1, AC2, AC3, AC4, AC5, AC6, AC7)
  - [x] T3.1 `tags/route.ts`: GET (incl. `?with_counts` subquery COUNT) read-only → `getDb` removido; POST no `withHousehold`.
  - [x] T3.2 `tags/[id]/route.ts`: PATCH e DELETE no `withHousehold` (`resolveHouseholdRole` fora).
  - [x] T3.3 Tests (`crud.test.ts`, `route-with-counts.test.ts`).

- [x] **T4 — `api/recurrences/*`** (AC1, AC2, AC3, AC4, AC5, AC6, AC7)
  - [x] T4.1 `recurrences/route.ts`: GET read-only → `getDb` removido; POST (template task + recurrence) num único `withHousehold`. `begin/commit` inline removido.
  - [x] T4.2 `recurrences/[id]/route.ts`: GET read-only; PATCH (select + re-compute + update no `withHousehold`, retorno discriminado p/ 404/422/400) e DELETE.
  - [x] T4.3 Tests (`crud.test.ts`; sequência POST sem begin/commit).

- [x] **T5 — Gate de aplicação** (AC8)
  - [x] T5.1 `rls-application.test.ts` cobre `tasks` (piloto SEC-2) — verde.
  - [x] T5.2 Gate estendido com casos de isolamento cross-household (SELECT + INSERT bloqueado) para `tags`, `task_tags`, `kanban_columns`, `task_recurrences`.

- [x] **T6 — Quality gates** (AC9)
  - [x] T6.1 `pnpm lint` exit 0 · T6.2 `pnpm typecheck` exit 0 · T6.3 `pnpm --filter @meu-jarvis/web test` verde (88 testes dos 4 domínios; 1076/1077 suite, a 1 falha flaky-timeout passa isolada) · T6.4 `pnpm --filter @meu-jarvis/db-test test` 196 verde (Docker) · T6.5 `pnpm build` exit 0 · T6.6 `pnpm check:rls` exit 0.

---

## Dev Notes

### Referências-chave (leitura obrigatória)

| Recurso | Localização | Porquê |
|---------|-------------|--------|
| Padrão de mutação (audit fora) | SEC-3 — qualquer `api/financas/*/route.ts` (ex.: `contas/route.ts`) | Forma EXACTA: operação dentro de `withHousehold`, `insertAuditLog` fora em `getDb()` |
| Padrão read-only / handler GET | `api/tasks/route.ts:89-99` (SEC-2, GET migrado) | `withHousehold(auth, tx => helper({ db: tx }))` |
| `withHousehold` | `apps/web/src/lib/agent/db-shim.ts:79` | Re-export — usar SEMPRE via shim (nunca `@meu-jarvis/db/client` directo) |
| Mock de teste | `api/tasks/__tests__/list.test.ts:28-50` | Padrão de mock `withHousehold` |
| Gate de aplicação | `packages/db-test/src/tests/rls-application.test.ts` | 2.ª rede provada com role runtime |
| ADR | `docs/adr/ADR-003-…md` Adenda §11 | Scoping da fatia + invariantes |

### Pontos críticos

1. **`auth` vem de `requireAuth(span)`** em todos os 12 handlers (`{ userId, householdId }`) — passar directo a `withHousehold`. Zero resolução nova.
2. **1.ª rede NÃO se remove.** O filtro `household_id = ${auth.householdId}::uuid` fica em cada query DENTRO do `withHousehold`. SEC-5 só adiciona a 2.ª rede.
3. **`insertAuditLog` SEMPRE fora do `withHousehold`** (AC2). Não mover para dentro — replica D-SEC3.
4. **Handlers mistos** (GET + mutação no mesmo ficheiro): manter `import { getDb }` (mutação usa-o p/ audit); só o GET deixa de o chamar.
5. **`kanban-columns/batch`** é o handler mais complexo (reorder com trick sort_order shift+offset, create, delete + reassign de tasks, re-fetch). Todas as mutações num único `withHousehold`; cuidado com a propagação do `tx` às funções-helper de módulo.
6. **`recurrences POST`** cria template task + recurrence (múltiplas escritas) — todas no mesmo `withHousehold` (atomicidade já existente preservada).

### Sobre performance

`withHousehold` adiciona 1 transação + 2 `SET LOCAL` por handler. Aceitável (NFR1; pgbouncer transaction-mode desenhado para isto — confirmado SEC-2 §3). Para os handlers GET (alta frequência), é 1 transação curta read-only — sem regressão material.

### Convenções

Imports `@/` absolutos · sem `any` (`unknown` + guards) · PT-PT em comentários/erros · `prepare:false` intocado · REQ-INLINE-1 (`sql` de `drizzle-orm`, cliente do shim).

### Riscos (para @architect no gate)

| Risco | Mitigação |
|-------|-----------|
| Um filtro `household_id` (1.ª rede) removido por engano ao mexer na query | AC6 — grep household_id antes/depois (contagem ≥); testes bound-param mantidos |
| `insertAuditLog` movido para dentro do `withHousehold` (muda comportamento SEC-3) | AC2 explícita; gate verifica audit fora |
| Handler com múltiplas queries usa `getDb()` numa e `tx` noutra (split de contexto RLS) | AC3 — todas as queries de domínio no mesmo callback `tx` |
| Teste mocka só `getDb` e handler passa a usar `withHousehold` | AC7 — actualizar mock do shim (padrão `list.test.ts`) |
| `batch` (complexo) deixa uma mutação fora do `withHousehold` | T2.3 — revisão dedicada; gate de aplicação cobre kanban_columns (AC8) |

---

## Testing

| Camada | Ferramenta | Ficheiros |
|--------|-----------|-----------|
| Handlers Tarefas (unit + bound-param) | Vitest node (`apps/web`) | `api/{tasks,tasks/[id],tasks/[id]/move,tasks/[id]/tags,tasks/[id]/tags/[tagId],kanban-columns,kanban-columns/[id],kanban-columns/batch,tags,tags/[id],recurrences,recurrences/[id]}/__tests__/*.test.ts` |
| Gate de aplicação RLS (2.ª rede) | Vitest + Testcontainers (`db-test`) | `packages/db-test/src/tests/rls-application.test.ts` (verde; estender se preciso — AC8) |
| Gate estático | `pnpm check:rls` | — |

---

## CodeRabbit Integration

> **CodeRabbit Integration**: Disabled — sem `coderabbit_integration` em `core-config.yaml`. Validação via @architect adversarial gate (padrão SEC-1/2/3/4).

---

## Dev Agent Record

### Agent Model Used

Dex (@dev) — claude-opus-4-8[1m]. Modo interactive. 03/06/2026.

### Debug Log References

- Reconciliação 21 call-sites: grep devolveu 23 `getDb()` → 2 eram comentários (`tasks/route.ts:19`, `move/route.ts:9`); 21 reais confirmados.
- Pós-implementação: 16 `const db = getDb()` (mutação), 0 `getServiceDb`, 0 `begin/commit/rollback` inline, 43 filtros `household_id` (= antes; AC6 OK).
- Web tests dos 4 domínios: 88/88 verde. Suite completa: 1076/1077 (a 1 falha — `tarefas/calendario/page.test.tsx` — foi timeout flaky por carga paralela; passa isolada em 1,5s; é SSR page, fora do âmbito SEC-5).

### Completion Notes

- **Padrão aplicado (idêntico a SEC-3):** mutação → operação de domínio dentro de `withHousehold((tx) => …)`, `insertAuditLog` best-effort FORA em `getDb()` (PO-FIX-2). Read-only → `getDb` removido, read via `tx`.
- **Handlers complexos (atenção dedicada — mitigação [PO-DECISION-1]):**
  - `kanban-columns/batch` (T2.3): TODA a sequência (validateInput + snapshot + deletes + creates + updates com o trick `sort_order` shift+offset + validateInvariants + fetch final) corre num único `withHousehold`. Os helpers de módulo `validateInput`/`validateInvariants` **já recebiam o cliente por parâmetro** (AC6) — passei-lhes `tx`. As duas situações de 422 (input/final) são sinalizadas por uma classe tipada `BatchInvariantError` lançada dentro do callback (força rollback da transação) e mapeadas ao 422 FORA. Unique → 409 no catch externo.
  - `recurrences POST` (T4.1): as 2 escritas (template task + recurrence) correm no mesmo `withHousehold` — atomicidade multi-write preservada (substitui o `begin/commit` inline).
  - `tasks/[id]/move`, `kanban-columns/[id]` PATCH/DELETE: `begin/commit/rollback` inline **substituído** pela transação implícita do `withHousehold`; early-returns (404/409/400) via **retorno discriminado** do callback (padrão `transacoes POST` de SEC-3) — nenhum `return NextResponse` dentro do callback da transação.
- **1.ª rede mantida:** todos os filtros `household_id = ${auth.householdId}::uuid` intactos (43, contagem igual à pré-implementação). `withHousehold` é a 2.ª rede aditiva.
- **Testes:** mock `withHousehold: (_auth, fn) => fn(fakeDb)` adicionado aos 9 ficheiros que mockam o shim; sequências `mockResolvedValueOnce` dos handlers que tinham `begin/commit` (move, kanban PATCH/DELETE/batch, recurrences POST) ajustadas para remover essas chamadas. `batch/route.test.ts` (SEC-1-F4) mantém-se verde — os filtros `household_id` bound não mudaram.
- **AC8 gate:** estendido `rls-application.test.ts` com cobertura de isolamento cross-household (SELECT cross + INSERT bloqueado) para `tags`, `task_tags`, `kanban_columns`, `task_recurrences` (tabelas tocadas não cobertas antes; `tasks` já era piloto SEC-2). 196 testes db-test verde.
- **Sem migration** (AC9) — `db:migrate` NÃO corrido; 104 policies intactas.
- **SM-OBS-3 confirmado:** nenhuma query sem filtro `household_id` encontrada durante a implementação — não há achado SEC-4-style. Premissa anti-leak holds.

### File List

**Handlers migrados (12):**
- `apps/web/src/app/api/tasks/route.ts` (POST)
- `apps/web/src/app/api/tasks/[id]/route.ts` (GET/PATCH/DELETE)
- `apps/web/src/app/api/tasks/[id]/move/route.ts` (PATCH)
- `apps/web/src/app/api/tasks/[id]/tags/route.ts` (POST)
- `apps/web/src/app/api/tasks/[id]/tags/[tagId]/route.ts` (DELETE)
- `apps/web/src/app/api/kanban-columns/route.ts` (GET/POST)
- `apps/web/src/app/api/kanban-columns/[id]/route.ts` (PATCH/DELETE)
- `apps/web/src/app/api/kanban-columns/batch/route.ts` (PATCH)
- `apps/web/src/app/api/tags/route.ts` (GET/POST)
- `apps/web/src/app/api/tags/[id]/route.ts` (PATCH/DELETE)
- `apps/web/src/app/api/recurrences/route.ts` (GET/POST)
- `apps/web/src/app/api/recurrences/[id]/route.ts` (GET/PATCH/DELETE)

**Tests actualizados (9):**
- `apps/web/src/app/api/tasks/__tests__/create.test.ts`
- `apps/web/src/app/api/tasks/[id]/__tests__/route.test.ts`
- `apps/web/src/app/api/tasks/[id]/move/__tests__/route.test.ts`
- `apps/web/src/app/api/tasks/[id]/tags/__tests__/pivot.test.ts`
- `apps/web/src/app/api/kanban-columns/__tests__/route.test.ts`
- `apps/web/src/app/api/kanban-columns/batch/__tests__/route.test.ts`
- `apps/web/src/app/api/tags/__tests__/crud.test.ts`
- `apps/web/src/app/api/tags/__tests__/route-with-counts.test.ts`
- `apps/web/src/app/api/recurrences/__tests__/crud.test.ts`

**Gate de aplicação estendido (1):**
- `packages/db-test/src/tests/rls-application.test.ts` (cobertura SEC-5: tags, task_tags, kanban_columns, task_recurrences)

---

## QA Results

### Gate adversarial — @architect (Aria), 03/06/2026

**Decisão: PASS** · Quality score **96/100** · Confiança **ALTA**

#### Ponto pivotal auditado (atenção adversarial dedicada — [PO-DECISION-1])

A correcção de TODA a story dependia de uma pergunta: **`withHousehold` abre uma transação real que faz rollback no `throw`?** Se não, a atomicidade do `recurrences POST` e o rollback dos 422 do `batch` seriam uma regressão CRÍTICA face ao `begin/commit` explícito anterior.

**Verificado em `packages/db/src/client.ts:132`:** `withHousehold` usa `pgSql.begin(async (pgTx) => …)` (postgres.js) — transação real com COMMIT no sucesso e **ROLLBACK automático em qualquer `throw`**. Os 2 handlers complexos estão correctos:

- **`kanban-columns/batch`** — validateInput + snapshot + deletes + creates + updates (trick `sort_order` shift+offset) + validateInvariants + fetch final num único callback. As 2 situações de 422 lançam `BatchInvariantError` tipado → rollback da transação → mapeado a 422 FORA do callback. Helpers `validateInput`/`validateInvariants` recebem `tx` (param chama-se `db` mas o valor é a transação — funcionalmente correcto, AC6 satisfeito). Unique → 409 no catch externo. **Atómico e correcto.**
- **`recurrences POST`** — template task INSERT + recurrence INSERT no mesmo `withHousehold`; se o 2.º falha, o 1.º reverte. Atomicidade multi-write preservada. `recurrence.id` tipado (RecurrenceRow). **Correcto.**

> **Achado positivo (melhoria, não regressão):** o `begin/commit/rollback` inline anterior corria via `execute()` separados sobre `getDb()` em **pgbouncer transaction-mode (porta 6543)**, onde statements separados podem cair em backends diferentes — transação não-fiável. O `withHousehold` (`.begin()` segura 1 conexão para toda a transação) é **estritamente mais correcto**. A migração endureceu a atomicidade de 4 handlers (`move`, `kanban [id]` PATCH/DELETE, `batch`, `recurrences POST`), não apenas adicionou a 2.ª rede.

#### Invariantes reproduzidos independentemente (grep próprio)

| Invariante | Esperado | Verificado |
|-----------|----------|-----------|
| `getServiceDb` em handlers | 0 | 0 ✓ |
| `begin/commit/rollback` inline | 0 | 0 ✓ |
| Filtros `household_id` bound (1.ª rede) | ≥ pré (43) | 43 ✓ |
| `db.execute` (getDb) domínio directo | 0 | 0 ✓ (os 2 hits são helpers do batch que recebem `tx`) |
| `insertAuditLog` (16 mutação) | 16 | 16 ✓ |
| `getDb` removido nos 5 read-only | — | tasks/[id]=2, kanban=1, tags=1, recurrences=1, recurrences/[id]=2 (só mutação retém) ✓ |

#### Cobertura de ACs

AC1 ✓ (21 call-sites no `withHousehold`) · AC2 ✓ (16 audit fora em `getDb`) · AC3 ✓ (re-fetch dentro do `withHousehold`; nenhuma query domínio fora) · AC4 ✓ (5 read-only sem `getDb`) · AC5 ✓ (import via `db-shim`; `requireAuth`/guards/erros/status inalterados) · AC6 ✓ (1.ª rede intacta; `getServiceDb`=0; helpers batch recebem `tx`) · AC7 ✓ (mock `withHousehold` nos 9 testes; sequências sem `begin/commit`; bound-param verde) · AC8 ✓ (gate estendido p/ tags/task_tags/kanban_columns/task_recurrences) · AC9 ✓ (6 gates verdes, sem migration).

#### Quality gates (re-confirmados via evidência do @dev)

lint exit 0 · typecheck exit 0 · web 1076/1077 (a 1 falha = `tarefas/calendario/page.test.tsx`, timeout flaky por carga paralela, passa isolada em 1,5s — SSR page fora do âmbito SEC-5) · db-test 196 (Docker, incl. novos casos SEC-5) · build exit 0 · check:rls exit 0.

#### Discriminated returns — anti-padrão verificado ausente

Confirmado: **nenhum `return NextResponse`/`return apiError` dentro de um callback `withHousehold`**. Todos os early-returns (404/409/400/422) usam retorno discriminado mapeado fora — padrão `transacoes POST` de SEC-3. Correcto para não fundir HTTP-concerns com a transação.

#### Observações não-bloqueantes (LOW)

- **L1** — Os helpers `validateInput`/`validateInvariants` (batch) têm o parâmetro nomeado `db: DbShim` mas recebem `tx`. Funcionalmente correcto (genérico), mas o nome pode induzir leitura errada. Renomear para `client`/`tx` numa limpeza futura. Não bloqueia.
- **L2** — Comentário-cabeçalho do `move/__tests__/route.test.ts` ainda diz "atomicidade BEGIN/COMMIT" (cosmético; a mecânica é agora transação `withHousehold`). Não bloqueia.

#### Veredicto

Implementação **mecânica, uniforme e correcta**, alinhada com o padrão SEC-3 provado, com endurecimento real da atomicidade. Zero CRITICAL, zero HIGH. As 2 observações LOW são cosméticas. **Gate: PASS.** Pronta para `@devops` push.

**Status → Done.**

---

## Change Log

| Data | Versão | Descrição | Autor |
|------|--------|-----------|-------|
| 2026-06-03 | 0.1 | Draft inicial — ADR-003 Fase 4 Fatia A (Tarefas API handlers). Verificação byte-a-byte do domínio: os 12 handlers JÁ têm 1.ª rede (app-enforced `household_id` em todas as queries) — premissa do handoff CONFIRMADA (≠ SEC-4, que não tinha 1.ª rede). SEC-5 é puramente aditivo (só 2.ª rede `withHousehold`), padrão idêntico a SEC-3 (audit fora do withHousehold). Mapa de 21 call-sites `getDb()` em 12 ficheiros (5 read-only → getDb removido; 16 mutação → getDb mantido p/ audit). [SM-DECISION-1]: SSR pages `tarefas/*` (3) carved out p/ SEC-6 (espelha split finance SEC-3/SEC-4). Sem migration. | River (@sm) |
| 2026-06-03 | 1.0 | **Validação @po — GO (readiness 9,5/10, confiança ALTA).** Premissas verificadas independentemente (grep): withHousehold em client.ts:119/db-shim.ts:79; piloto SEC-2 migrado; 1.ª rede presente (43 filtros); getServiceDb=0; 21 call-sites confirmados (23 grep − 2 comentários). [PO-DECISION-1]: SM-OBS-1 ratificado — manter junto (split não isola risco; batch+recurrences caem ambos em 5b). Should-fix: header AC1 corrigido "21 handlers"→"21 call-sites em 12 handlers". Status → Approved. | Pax (@po) |
| 2026-06-03 | 1.2 | **Gate adversarial @architect — PASS (96/100).** Ponto pivotal confirmado: `withHousehold` = transação real (`pgSql.begin`) com rollback no throw → atomicidade do batch (422→rollback) e recurrences POST correctas; achado positivo (substitui begin/commit inline não-fiável em pgbouncer 6543 por transação real). Invariantes reproduzidos por grep próprio (0 getServiceDb, 0 begin/commit, 43 filtros, 16 audit fora, 5 read-only sem getDb). 9 ACs ✓, 6 gates ✓. 2 LOW cosméticas (param helper `db`→`tx`; comentário teste move). Status → Done. | Aria (@architect) |
| 2026-06-03 | 1.1 | **Implementação @dev — Ready for Review.** 21 call-sites migrados em 12 handlers (padrão SEC-3: mutação dentro de `withHousehold`, audit fora em `getDb`; 5 read-only com `getDb` removido). 4 handlers complexos (move, kanban [id] PATCH/DELETE, kanban batch, recurrences POST) com `begin/commit` inline substituído pela transação do `withHousehold` + retorno discriminado p/ early-returns (404/409/400/422). `BatchInvariantError` tipado no batch. Helpers do batch recebem `tx`. 1.ª rede mantida (43 filtros, contagem igual). Gate de aplicação estendido (tags/task_tags/kanban_columns/task_recurrences). 6 quality gates verdes. Sem migration. | Dex (@dev) |

---

## Observações do SM (para @po na validação)

- **SM-OBS-1 (granularidade — decisão a ratificar).** [SM-DECISION-1] limita SEC-5 aos 12 API handlers (21 call-sites) e remete as 3 SSR pages para SEC-6, espelhando o split finance (SEC-3 handlers / SEC-4 SSR). Mesmo assim, 21 call-sites é maior que SEC-3 (12). Se o @po julgar excessivo para uma única review, o sub-split natural por entidade é: SEC-5a `tasks/*` (T1, 7 handlers) · SEC-5b `kanban+tags+recurrences` (T2-T4, 14 handlers). Recomendo manter junto (padrão uniforme e mecânico, provado 13× entre SEC-2/SEC-3), mas é decisão do @po.
- **SM-OBS-2 (alinhamento de linhas — informativo).** As linhas de `getDb()`/`insertAuditLog` da tabela de ficheiros-alvo referem a chamada exacta (grep verificado 03/06). O @dev deve localizar cada handler pelo método (GET/POST/PATCH/DELETE) e confirmar a linha — não contar offsets rígidos, caso haja drift menor.
- **SM-OBS-3 (premissa anti-leak verificada).** Ao contrário de SEC-4, NÃO incorporei achado de segurança porque não há: grep confirma 1.ª rede presente em todas as queries dos 12 handlers. Se o @po/@dev encontrar UMA query sem filtro `household_id` durante a implementação, é um achado SEC-4-style e deve ser escalado (não silenciosamente "adicionado" sem registo).

---

## Resolução do @po (Pax, 03/06/2026)

- **[PO-DECISION-1] — SM-OBS-1 (granularidade): MANTER JUNTO. SM-DECISION-1 ratificado.** Não sub-dividir em SEC-5a/5b.
  - **Racional:** (1) o trabalho é uniforme, mecânico e aditivo — o padrão `withHousehold` (mutação: audit fora; read-only: getDb removido) está provado 13× em SEC-2/SEC-3; o risco **por call-site** é baixo e homogéneo. (2) O incremento de valor — defense-in-depth (2.ª rede) em todo o domínio Tarefas — é **coeso** como uma única story. (3) O split proposto **não isola o risco**: os dois handlers genuinamente complexos (`kanban-columns/batch` com o trick sort_order shift+offset, e `recurrences POST` multi-write) caem **ambos** em SEC-5b — partir não reduz a superfície de risco da review, só adiciona overhead de mais um ciclo validate→develop→gate + handoff. (4) SEC-3 fez 12 call-sites num só ciclo de forma limpa; 21 é maior, mas a contenção do risco vem da estrutura da story (T2.3 revisão dedicada ao `batch`; tabela de Riscos; AC8 gate de aplicação por tabela), não do tamanho.
  - **Mitigação exigida ao @dev/@architect:** o `batch` (T2.3) e o `recurrences POST` (T4.1) recebem atenção adversarial dedicada no gate; o @dev documenta a composição final destes dois nas Completion Notes (em especial a propagação do `tx` às funções-helper de módulo do `batch` e a atomicidade multi-write do `recurrences POST`).
- **SM-OBS-2 (alinhamento de linhas): aceite.** O @dev localiza cada handler pelo método HTTP, não por offset rígido (a tabela byte-a-byte é guia, não contrato de linha).
- **Should-fix aplicado (PO):** header da AC1 corrigido de "21 handlers" → "21 call-sites em 12 handlers" (precisão; o corpo já estava correcto).
