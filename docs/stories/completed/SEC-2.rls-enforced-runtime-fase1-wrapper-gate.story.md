# Story SEC-2: RLS enforced em runtime — Fase 1 (wrapper `withHousehold` + gate de aplicação + piloto tarefas)

> **ID:** `SEC-2` (segurança transversal — continuação de SEC-1, implementa ADR-003 Fase 1).
> Não pertence a nenhum epic numerado — é um story de segurança cross-epic, tal como SEC-1.
> **Depende de:** SEC-1 (Done), Fase 0 do ADR-003 (VEREDICTO GO confirmado por `diag-adr003-phase0.ts`).

## Status

Done v1.3-ARCH-APPROVED (PASS 9,5/10 — @architect Aria adversarial gate; 8/8 focos de segurança limpos; 7/7 gates re-corridos verdes; 3/3 [DEV-DECISION] ratificadas. Ver QA Results + `docs/qa/gates/SEC-2-architect-gate.md`. Aguarda push @devops.)

## Executor Assignment

```
executor: "@dev"
quality_gate: "@architect"
quality_gate_tools: ["lint", "typecheck", "test", "check:rls", "build", "rls-application-gate"]
```

## Story

**As a** engenheiro/product owner da Expressia,
**I want** que o Postgres aplique activamente as 104 RLS policies em runtime (defense-in-depth, segunda rede independente sob o app-enforced),
**so that** uma query nova sem filtro `household_id` não causa vazamento cross-tenant silencioso — a RLS apanha o que o filtro aplicacional perder.

## Contexto e âmbito (ler antes das ACs — OBRIGATÓRIO)

### Ponto de partida

A Story SEC-1 (`6f56e32`) tornou o isolamento 100% app-enforced: ~42 queries têm filtro `household_id` explícito. **O app-enforced é a 1.ª rede e NUNCA é removido** — esta story adiciona a 2.ª rede por baixo. Defense-in-depth genuíno.

O ADR-003 confirmou empiricamente (script `diag-adr003-phase0.ts`, VEREDICTO GO) que:
- O role do runtime tem `rolbypassrls = TRUE` (RLS inerte hoje).
- `SET LOCAL ROLE authenticated` + `SET LOCAL request.jwt.claims` dentro de uma transação activa as 104 policies sem as alterar.
- `SET LOCAL` reverte no `COMMIT` — zero fuga de contexto entre requests no mesmo pgbouncer transaction-mode pool.
- `getServiceDb()` / service_role continua a bypassar RLS (jobs Inngest, migrations intactos).

### O que esta story faz (Fase 1 do ADR-003)

1. **Implementar `withHousehold(auth, fn)`** em `packages/db/src/client.ts` — wrapper transaccional que activa RLS por request de utilizador final. Reutiliza a mecânica exacta provada em `packages/db-test/src/rls-harness.ts:asUser()`.
2. **Corrigir o comentário falso** em `packages/db/src/client.ts:10-14` que afirma que connections `authenticated` herdam `auth.uid()` do JWT (demonstravelmente falso — ADR-003 §1.1).
3. **Endurecer o gate CI** com um teste de _aplicação_ real (não só existência estática de policies): semear 2 households num Postgres efémero, ligar com o role do runtime via `withHousehold`, provar 0 rows cross-tenant e INSERT bloqueado.
4. **Pilotar num domínio real (tarefas):** migrar a listagem de tarefas de `getDb()` para `withHousehold(auth, fn)`. Este piloto é obrigatório para a story ser demonstrável E2E em runtime real — sem nenhum call-site migrado, o wrapper existe mas nunca é exercido em produção. A escolha de tarefas justifica-se: é o domínio com mais cobertura de teste existente e o handler de listagem é o path mais simples (SELECT com filtro `household_id` — semântica trivial dentro de transação).

> **[PO-FIX-1 — verificação byte-a-byte do call-site]** O call-site a migrar **NÃO é internamente `list-tasks.ts`**. A verificação do código real (02/06/2026) revelou:
> - `apps/web/src/lib/api-helpers/list-tasks.ts` exporta `listTasksHelper(params)` — uma função **pura** que recebe `db` **injectado** como parâmetro (`ListTasksParams.db: DbShim`). **NÃO chama `getDb()` internamente** (decisão arquitectural G1 de Story 3.3 DP4-3.3, ratificada por Aria). Ver `list-tasks.ts:76,114-117`.
> - Quem chama `getDb()` é o **route handler** `apps/web/src/app/api/tasks/route.ts:89` (`GET`), passando-o como `db: getDb()` ao helper.
> - **Portanto o ponto de migração é `route.ts:49-109` (handler GET), não a função pura.** O padrão correcto: o handler GET passa a envolver a chamada em `withHousehold(auth, (tx) => listTasksHelper({ ...params, db: tx }))`. O helper `listTasksHelper` permanece intacto (recebe `tx` em vez de `getDb()`) — isto até preserva a testabilidade G1.

### Fora de âmbito

- Migração de todos os outros ~41 call-sites (`getDb()` → `withHousehold`) — Fase 2 do ADR-003, story(ies) separada(s) por domínio.
- Alteração das 104 RLS policies — intactas (decisão ADR-003).
- Jobs Inngest / `getServiceDb()` — intactos.
- `DATABASE_URL_AUTHENTICATED` — o mecanismo aprovado é `SET LOCAL ROLE authenticated` a partir da connection actual (caminho 3b do diagnóstico), não uma connection string dedicada.

---

## Acceptance Criteria

### Bloco A — Wrapper `withHousehold`

**AC-A1 (contrato público):** `packages/db/src/client.ts` exporta a função `withHousehold<T>(auth: { userId: string; householdId: string }, fn: (tx: Database) => Promise<T>): Promise<T>`. A assinatura respeita o contrato do ADR-003 §3.

**AC-A2 (mecânica interna — conforme Fase 0 provada):** dentro da transação que `withHousehold` abre, a sequência é:
1. `SET LOCAL ROLE authenticated` (activa RLS; conforme Q3b do diagnóstico).
2. `SET LOCAL request.jwt.claims = $claims` parametrizado — shape `{"sub": userId, "household_id": householdId, "role": "authenticated"}` (conforme Q4 do diagnóstico; anti-injection via `set_config` parameterizado).
3. *(opcional defense-in-depth)* `SET LOCAL app.current_household_id = $householdId` — alimenta `current_household_id()` para scripts/funções que o lêem.
4. `fn(tx)` — o callback recebe a transação scoped e corre nela.
5. `COMMIT` (ou `ROLLBACK` em erro) — `SET LOCAL` reverte; zero fuga de contexto entre requests (conforme Q5 do diagnóstico).

**AC-A3 (pgbouncer safety):** o `SET LOCAL ROLE` e o `SET LOCAL` dos claims ocorrem DENTRO da transação — **nunca** fora de transação com `SET` simples. Qualquer implementação que use `SET` (sem `LOCAL`) é uma violação bloqueante.

**AC-A4 (defence-in-depth mantida):** `withHousehold` não remove nem substitui o filtro `household_id` explícito nas queries do callback. A app-enforced (SEC-1) permanece como 1.ª rede.

**AC-A5 (compatibilidade `getDb()` / `getServiceDb()`):** `getDb()` e `getServiceDb()` continuam a existir e a funcionar inalterados. Os call-sites não migrados nesta story continuam a usar `getDb()` com app-enforced — sem regressão.

### Bloco B — Correcção do comentário falso

**AC-B1:** As linhas 10-14 de `packages/db/src/client.ts` (comentário "Connections como `authenticated` herdam `auth.uid()` do JWT (Supabase Auth Hook injecta `request.jwt.claims` com `household_id`)") são substituídas por comentário preciso que:
- Descreve o estado real: `getDb()` liga como role `postgres` (bypassa RLS); `withHousehold` é o caminho RLS-enforced.
- Referencia o ADR-003 e a Fase 0 como evidência.
- Não inventa comportamento não confirmado.

### Bloco C — Gate de aplicação real (NFR5 endurecido)

**AC-C1 (novo teste em `packages/db-test`):** existe um ficheiro de teste (ex.: `src/tests/rls-application.test.ts`) que, usando a infraestrutura Testcontainers da Story 1.4 (`rls-harness.ts`), semeia 2 households com dados de domínio (≥1 tarefa + ≥1 transacção por household) e prova com `withHousehold` (ou via `asUser()` que usa a mesma mecânica):

- SELECT de tarefas como user A → só vê tarefas de A (1 row), 0 de B.
- SELECT de tarefas como user B → só vê tarefas de B (1 row), 0 de A.
- `SELECT ... WHERE household_id = <B>` como user A → 0 rows (RLS bloqueia filtro cruzado).
- INSERT cross-household (user A a tentar inserir tarefa em household B) → erro `row-level security` / `new row violates`.

**AC-C2 (mesmo teste para transacções):** as asserções de AC-C1 repetidas para a tabela `transactions` (tabela financeira, confirma que o gate cobre mais que um domínio).

**AC-C3 (exit code 1 = build falha):** o teste de AC-C1/C2 corre no CI dentro do job `rls-gate` (`.github/workflows/ci.yaml`). Se alguma asserção de isolamento falhar (leak detectado), o job falha com exit code 1 e bloqueia merge.

**AC-C4 (gate estático mantido):** `scripts/check-rls-coverage.ts` continua a correr e a exigir as 4 policies por tabela com `household_id`. O novo teste de aplicação _completa_, não substitui, o gate estático.

### Bloco D — Piloto tarefas (E2E em runtime real)

**AC-D1 (migração do handler GET tasks — PO-FIX-1):** o **route handler** `apps/web/src/app/api/tasks/route.ts` (função `GET`, linhas 49-109) — que actualmente chama `getDb()` em `route.ts:89` e o passa a `listTasksHelper({ ..., db: getDb() })` — passa a envolver essa chamada em `withHousehold(auth, (tx) => listTasksHelper({ ..., db: tx }))`. O `listTasksHelper` em `list-tasks.ts` permanece uma função pura intacta (recebe `db` injectado) — só muda o que o handler lhe injecta: `tx` (scoped à transação RLS) em vez de `getDb()`. O filtro `WHERE tasks.household_id = ${householdId}::uuid` (SEC-1 AC-A1, hoje em `list-tasks.ts:125`) é mantido dentro do helper (defense-in-depth).

> **[PO-FIX-1b — conflito de tipos `DbShim` vs `Database`]** `listTasksHelper` tipa `db` como `DbShim` (`apps/web/src/lib/agent/db-shim.ts:29-37`) — interface minimal local (`execute`/`transaction`/`insert`) criada como workaround do break de tsc cross-package (`db-shim.ts:5-18`). O `tx` que `withHousehold` produz é um `Database` real do `@meu-jarvis/db` (`PostgresJsDatabase<typeof schema>`). **O @dev TEM de garantir que o `tx` injectado satisfaz `DbShim` no contexto do handler `apps/web`** — provavelmente expondo `withHousehold` via `db-shim.ts` (re-export lazy, como `getDb`/`getServiceDb` já são) para não reintroduzir o break de tsc que `db-shim` resolve. Migrar via import directo de `@meu-jarvis/db/client` em `apps/web` reintroduz o break documentado em `db-shim.ts:7-13`. **REQ: rotear `withHousehold` por `db-shim.ts`.**

**AC-D2 (sem regressão funcional):** os testes existentes do endpoint `/api/tasks` GET (`apps/web/src/app/api/tasks/__tests__/list.test.ts`) continuam a passar. Esse teste mocka `@/lib/agent/db-shim` (`getDb`/`getServiceDb` → `{ execute: dbExecuteMock }`, ver `list.test.ts:25-28`). Como `withHousehold` será roteado pelo mesmo módulo (PO-FIX-1b), o mock deve passar a expor também `withHousehold` (ex.: `withHousehold: (_auth, fn) => fn({ execute: dbExecuteMock })`). Sem reduzir a contagem de testes aprovados no baseline.

**AC-D3 (auth disponível no handler — PO-FIX-1):** o handler `GET` já obtém `auth = await requireAuth(span)` (`route.ts:55`) que devolve `{ userId, householdId }` (`auth.ts:63-93`, tipo `AuthContext` em `auth.ts:15-18`). **Nota factual:** `listTasksHelper` **não** recebe `auth: AuthContext` — recebe `householdId` e `userId` como campos separados de `ListTasksParams` (`list-tasks.ts:67-78`). A migração não toca a assinatura do helper; o `auth` necessário para `withHousehold` está disponível no handler. Não é necessária infraestrutura nova de passagem de auth.

### Bloco E — Quality gates e convenções

**AC-E1:** `pnpm lint` (ESLint, `--max-warnings=0`), `pnpm typecheck` (TypeScript strict), `pnpm test` (Vitest todos os packages), `pnpm build` e `pnpm check:rls` passam sem erros.

**AC-E2:** sem `any` no código novo; imports absolutos `@/` em `apps/web`; imports relativos `./` apenas dentro do mesmo package (`packages/db`); PT-PT em comentários e mensagens de erro.

**AC-E3 (`getServiceDb()` intacto):** correr `pnpm --filter @meu-jarvis/db-test exec tsx src/tests/rls-application.test.ts` (ou equivalente) com o caminho `service_role` não produz regressão — service_role ainda vê ambos os households (comportamento esperado para jobs).

---

## Tasks / Subtasks

- [x] **T1 — Corrigir comentário falso em `client.ts`** (AC-B1)
  - [x] T1.1 Substituir linhas 10-14 por comentário que descreve o estado real: `getDb()` usa role com `rolbypassrls`, RLS inerte; `withHousehold` é o caminho RLS-enforced; referência ao ADR-003.

- [x] **T2 — Implementar `withHousehold` em `packages/db/src/client.ts`** (AC-A1 a A5)
  - [x] T2.1 Adicionar a função `withHousehold<T>(auth, fn)` exportada logo abaixo de `getDb()`.
  - [x] T2.2 Dentro da função: abrir transação via `getDb()` pool (`postgres-js .begin()`); emitir `SET LOCAL ROLE authenticated`; emitir `set_config('request.jwt.claims', claims, true)` parametrizado; emitir `set_config('app.current_household_id', householdId, true)` (defense-in-depth extra); chamar `fn(tx)`; commit/rollback automático.
  - [x] T2.3 Confirmar que `SET LOCAL` é usado em toda a parte — nunca `SET` simples. (Validado por teste unitário AC-A3 — `hasBareSet === false`.)
  - [x] T2.4 Verificar compatibilidade tipológica: o `tx` passado ao callback tem tipo `Database`. **[DEV-DECISION D-SEC2.1]** — `drizzle()` tipa o cliente como `Sql`; `pgTx` de `begin()` é `TransactionSql` (subconjunto). Cast `as unknown as Sql` (nunca `any`), comentado. O `tx` resultante é `Database` — call-sites usam Drizzle sem cast.
  - [x] T2.5 Adicionar JSDoc com referência ao ADR-003 e à Fase 0.

- [x] **T3 — Endurecer gate CI com teste de aplicação real** (AC-C1 a C4)
  - [x] T3.1 Criar `packages/db-test/src/tests/rls-application.test.ts` usando `seedTwoHouseholds()`, `asUser()`, `expectRlsBlocks()` (já existem em `rls-harness.ts`).
  - [x] T3.2 Semear dados de domínio (tasks + transactions) via `adminSql` (`insertTask`/`insertAccount`/`insertTransaction` de `fixtures.ts`).
  - [x] T3.3 Asserções SELECT cross-household (AC-C1): userA vê só A (1 row), userB só B (1 row); SELECT `WHERE household_id = <outro>` → 0 rows.
  - [x] T3.4 Asserção INSERT cross-household bloqueado (AC-C1): `expectRlsBlocks()` + confirmação `count(*) = 0` via admin.
  - [x] T3.5 Repetir para `transactions` (AC-C2). **+ teste extra AC-E3:** `service_role` vê ambos os households (bypass intacto).
  - [x] T3.6 **[PO-confirmado]** Glob Vitest `src/**/*.{test,spec}.ts` apanha o novo ficheiro automaticamente — zero edição ao CI. Validado: a suite db-test correu 36 ficheiros / 175 testes, incluindo `rls-application.test.ts` (9 testes). Falha com exit 1 em caso de leak.

- [x] **T4 — Pilotar em tarefas: migrar o handler `GET /api/tasks`** (AC-D1 a D3) — **[PO-FIX-1: ponto de migração = route handler]**
  - [x] T4.0 Expor `withHousehold` via `apps/web/src/lib/agent/db-shim.ts` (re-export lazy, mesmo padrão de `getDb`/`getServiceDb`) — evita break tsc cross-package (PO-FIX-1b). Adicionado tipo `WithHouseholdAuth`.
  - [x] T4.1 Em `route.ts` (handler `GET`), substituída a chamada directa `listTasksHelper({ ..., db: getDb() })` por `withHousehold(auth, (tx) => listTasksHelper({ ..., db: tx }))`. `auth` já disponível.
  - [x] T4.2 `tx` (`Database`) satisfaz `DbShim` estruturalmente (`execute`/`transaction`/`insert`) — typecheck verde. `list-tasks.ts` **NÃO editado** (função pura intacta).
  - [x] T4.3 Filtro `WHERE tasks.household_id = ${householdId}::uuid` (SEC-1, `list-tasks.ts:125`) mantido — não removido (defense-in-depth).
  - [x] T4.4 Mock de `@/lib/agent/db-shim` em `list.test.ts` passou a expor `withHousehold: (_auth, fn) => fn({ execute: dbExecuteMock })`. 14/14 testes verdes (baseline preservado).

- [x] **T5 — Quality gates** (AC-E1 a E3)
  - [x] T5.1 `pnpm lint` — exit 0 (10/10 tasks, "No ESLint warnings or errors").
  - [x] T5.2 `pnpm typecheck` — exit 0 (10/10 tasks).
  - [x] T5.3 `pnpm --filter @meu-jarvis/web test` — 1068 pass + 1 flaky conhecido (`tarefas/calendario/page.test.tsx`, passa isolado 3/3 — não-regressão); `pnpm --filter @meu-jarvis/db test` — 17 pass (incl. 4 novos `withHousehold`).
  - [x] T5.4 `pnpm build` — exit 0 (10/10 tasks).
  - [x] T5.5 `pnpm check:rls` — exit 0 (NFR5 estático inalterado).
  - [x] T5.6 `pnpm --filter @meu-jarvis/db-test test` — 36 ficheiros / 175 testes verdes (incl. `rls-application.test.ts` 9 testes AC-C1/C2/E3).

---

## Dev Notes

### Referências-chave (leitura obrigatória antes de implementar)

| Recurso | Localização | Porquê relevante |
|---------|-------------|-----------------|
| ADR-003 | `docs/adr/ADR-003-rls-enforced-runtime-hardening.md` | Decisão arquitectural completa; contrato `withHousehold`; plano faseado |
| Fase 0 (diagnóstico GO) | `packages/db-test/src/scripts/diag-adr003-phase0.ts` | Prova empírica que `SET LOCAL ROLE authenticated` + claims funciona; seed de 2 households |
| `asUser()` (mecânica provada) | `packages/db-test/src/rls-harness.ts:322-346` | Implementação de referência EXACTA do `SET LOCAL ROLE` + `set_config` parametrizado dentro de `begin()` — `withHousehold` é esta mecânica trazida para `packages/db` |
| `client.ts` | `packages/db/src/client.ts` | Ficheiro a modificar; `getDb()` (linhas 37-57), `getServiceDb()` (69-87), `setHouseholdContext` (93-101), comentário falso (10-14) |
| `auth.ts` | `apps/web/src/lib/api-helpers/auth.ts:63-93` | `requireAuth(span)` já devolve `{ userId, householdId }` (tipo `AuthContext`, `auth.ts:15-18`) — fonte de auth per-request para o piloto |
| `tasks/route.ts` | `apps/web/src/app/api/tasks/route.ts:49-109` (GET) | **[PO-FIX-1] O ponto de migração** — handler que chama `getDb()` (`route.ts:89`) e injecta em `listTasksHelper` |
| `list-tasks.ts` | `apps/web/src/lib/api-helpers/list-tasks.ts` | Função pura `listTasksHelper` (recebe `db` injectado — NÃO chama `getDb()`); permanece intacta no piloto, filtro household_id em `:125` |
| `db-shim.ts` | `apps/web/src/lib/agent/db-shim.ts:29-56` | Interface `DbShim` + re-export lazy de `getDb`/`getServiceDb`; rotear `withHousehold` aqui (PO-FIX-1b) |
| `check-rls-coverage.ts` | `scripts/check-rls-coverage.ts` | Gate estático actual (parse de policies) — manter inalterado |
| CI | `.github/workflows/ci.yaml` (job `rls-gate`) | Confirmar que o job corre os testes de `db-test` |

### Mecânica interna de `withHousehold` — guia de implementação

A implementação de referência encontra-se em `rls-harness.ts:asUser()` (linhas 322-346). Reproduzir a mesma sequência mas:
- Usar a `postgres` pool subjacente ao `getDb()` (não uma pool separada).
- O `tx` recebido pelo callback deve ter o tipo `Database` do Drizzle (wrapper sobre `PostgresJsDatabase`) para que as queries dentro do callback usem Drizzle ORM normalmente.

```
// Pseudocódigo ilustrativo (não vinculativo em detalhe de implementação)
export async function withHousehold<T>(
  auth: { userId: string; householdId: string },
  fn: (tx: Database) => Promise<T>,
): Promise<T> {
  // Obter a pool subjacente. Possíveis abordagens:
  //   (A) Manter a `postgres` instance exposta em módulo privado e usar .begin() nela.
  //   (B) Expor o cliente postgres via símbolo interno e envolver em Drizzle dentro da tx.
  // Escolher a abordagem mais simples que produza um `tx` de tipo Database.

  const claims = JSON.stringify({
    sub: auth.userId,
    household_id: auth.householdId,
    role: 'authenticated',
  });

  return pgClient.begin(async (pgTx) => {
    await pgTx.unsafe('set local role authenticated');
    await pgTx`select set_config('request.jwt.claims', ${claims}, true)`;
    await pgTx`select set_config('app.current_household_id', ${auth.householdId}, true)`;
    const tx = drizzle(pgTx, { schema }); // wrapping da tx em Drizzle
    return fn(tx);
  });
}
```

**Atenção à tipagem Drizzle:** `postgres-js` expõe `TransactionSql` dentro de `begin()`. É possível fazer `drizzle(txSql, { schema })` para obter um `Database` scoped à transação. Verificar que o tipo resultante é compatível com o que os call-sites esperam.

### Descobertas ADR-003 decisivas (anti-invenção)

| Facto | Fonte | Impacto |
|-------|-------|---------|
| As 104 policies usam `is_household_member(household_id)` → `auth.uid()` → `request.jwt.claims ->> 'sub'` | `0001_rls_policies.sql:541-552`; `0000_initial_schema.sql:51-64` | O shape dos claims TEM de incluir `sub: userId`. |
| `authenticated` é NOLOGIN — connection string directa falha (Q3a=false) | `diag-adr003-phase0.ts:277-318` | Usar `SET LOCAL ROLE authenticated` dentro de tx a partir da connection actual (Q3b=true). |
| `SET LOCAL` reverte no COMMIT — zero fuga de contexto | Q5 do diagnóstico | Pgbouncer transaction-mode é seguro com este padrão. |
| `getServiceDb()` usa `DATABASE_URL_SERVICE_ROLE` — intocável | `client.ts:69-87` | Não modificar. Jobs Inngest continuam a bypassar RLS por design. |
| `setHouseholdContext(db, id)` (já existe) usa GUC `app.current_household_id` | `client.ts:93-101` | O GUC é o mecanismo secundário (COALESCE em `current_household_id()`). Incluir no `withHousehold` como defense-in-depth extra. Não substitui o `sub` nos claims. |

### Piloto tarefas — contexto (corrigido por PO-FIX-1)

> **Correcção factual (verificação byte-a-byte @po):** a descrição anterior afirmava que `list-tasks.ts` "chama `getDb()`", "já recebe `auth: AuthContext`" e que "o filtro foi adicionado na linha 168". **Os três factos são falsos no código actual:**
> - `listTasksHelper` (`list-tasks.ts:114`) é função **pura** — recebe `db: DbShim` **injectado** (`ListTasksParams.db`, `list-tasks.ts:76`), NÃO chama `getDb()`.
> - Recebe `householdId`/`userId` **separados** (`list-tasks.ts:67-78`), NÃO um objecto `auth: AuthContext`.
> - O filtro `household_id` está em **`list-tasks.ts:125`** (a "linha 168" era a referência de SEC-1 AC-A1 ao estado do ficheiro ANTES de Story 3.6 adicionar o LEFT JOIN de tags, que mudou a numeração).
> Quem chama `getDb()` é o handler `route.ts:89`.

O `GET /api/tasks` (`route.ts:49-109`) é o ponto de migração. A migração consiste em:
1. O `auth = await requireAuth(span)` já está no handler (`route.ts:55`) — nenhuma mudança de assinatura no helper.
2. Envolver a chamada ao helper em `withHousehold(auth, (tx) => listTasksHelper({ ..., db: tx }))` (handler).
3. Injectar `tx` como `db` do helper em vez de `getDb()`.
4. O filtro `WHERE tasks.household_id = ${householdId}::uuid` permanece no helper (`list-tasks.ts:125`) — não editar o helper salvo por tipagem.
5. Garantir que `tx` (`Database`) satisfaz `DbShim` e que `withHousehold` é roteado por `db-shim.ts` (PO-FIX-1b).

**Risco de regressão:** envolver em transação muda a semântica de auto-commit. A query de listagem é um único `db.execute(sql\`...\`)` (`list-tasks.ts:171-191`) — uma SELECT com LEFT JOINs, sem connections paralelas nem subqueries Drizzle encadeadas fora do mesmo `execute`. Logo o wrap transaccional é seguro. **Coberto por AC-D2 + AC-C1 (teste de aplicação prova isolamento dentro de transação).**

### Padrão de testes de aplicação (reutilizar harness existente)

O `packages/db-test/src/rls-harness.ts` já exporta:
- `getRlsHarness()` — acesso ao `adminSql` e URL.
- `seedTwoHouseholds()` — 2 households com 2 users (desactiva triggers de onboarding; re-activa no finally).
- `asUser(userId, householdId, fn)` — executa `fn` com `SET LOCAL ROLE authenticated` + claims. Esta é exactamente a mecânica que `withHousehold` implementa.
- `expectRlsBlocks(userId, householdId, op)` — retorna `true` se a operação rejeitar por RLS.

O novo teste `rls-application.test.ts` pode reutilizar estas helpers directamente. Apenas precisa de semear dados de domínio (tasks + transactions) via `adminSql` antes de correr as asserções `asUser()`.

### Convenções obrigatórias do projecto

- Imports em `packages/db`: relativos `./` dentro do package (ver `client.ts` existente: `import * as schema from './schema'`).
- Imports em `apps/web`: absolutos `@/`.
- Sem `any`. Usar `unknown` + type guards se necessário.
- PT-PT em comentários e mensagens de erro.
- `prepare: false` na pool postgres-js (pgbouncer transaction-mode) — já está em `getDb()`, não alterar.

### Sobre o comentário a corrigir (linhas 10-14)

O texto actual afirma que connections `authenticated` herdam `auth.uid()` do JWT via Supabase Auth Hook. Isto é **factualmente incorrecto** para ligações postgres-js cruas (não-PostgREST): `auth.uid()` devolve NULL porque `request.jwt.claims` nunca é injectado automaticamente nestas connections. O ADR-003 §1.1 e o diagnóstico Q4 confirmam-no. O comentário correcto deve descrever:
- `getDb()` → role com `rolbypassrls`; RLS inerte.
- `withHousehold(auth, fn)` → `SET LOCAL ROLE authenticated` + claims por transação; RLS activa.
- `getServiceDb()` → `service_role`; bypassa RLS por design (jobs/migrations).

---

## Testing

### Abordagem

| Camada | Ferramenta | Ficheiro(s) |
|--------|-----------|-------------|
| Unitário (wrapper) | Vitest (`packages/db`) | `packages/db/src/__tests__/client-with-household.test.ts` (novo) |
| Aplicação RLS (integração real) | Vitest + Testcontainers (`packages/db-test`) | `packages/db-test/src/tests/rls-application.test.ts` (novo) |
| Regressão piloto tarefas | Vitest (`apps/web`) | `apps/web/src/app/api/tasks/__tests__/list.test.ts` (adaptar mock `db-shim` — PO-FIX-1) |
| Gate estático | `scripts/check-rls-coverage.ts` | Executar `pnpm check:rls` |

### Cenários de teste obrigatórios

**Unitário — `withHousehold`:**
- Chamar `withHousehold` com um `auth` válido e um callback que devolve um valor → resultado propagado correctamente.
- Callback que lança erro → a função rejeita (rollback implícito).
- Confirmar que a função exportada tem a assinatura correcta.

**Aplicação RLS (Testcontainers — usa `asUser()` do harness que tem a mesma mecânica):**
- SELECT tasks como userA → `toHaveLength(1)`, todas com `household_id = householdA`.
- SELECT tasks como userB → `toHaveLength(1)`, todas com `household_id = householdB`.
- SELECT tasks `WHERE household_id = householdB` como userA → `toHaveLength(0)`.
- INSERT task com `household_id = householdB` como userA → `expectRlsBlocks()` retorna `true`.
- Repetir SELECT e INSERT para `transactions`.
- `getServiceDb()` / service_role → `adminSql.begin(tx => { tx.unsafe('set local role service_role'); ... })` → vê ambos os households (bypass confirmado intacto).

**Piloto tarefas (apps/web):**
- `list-tasks.ts` migrado: testes existentes continuam a passar.
- Se o teste existente mockava `getDb()`, actualizar para mockar `withHousehold` ou usar um mock do `tx` equivalente.
- Garantir que o filtro `household_id` continua a ser aplicado dentro do callback (AC-D1/D3).

### CI — job `rls-gate`

**[PO-confirmado byte-a-byte]** O job `rls-gate` em `.github/workflows/ci.yaml:177-178` JÁ corre `pnpm --filter @meu-jarvis/db-test test` (step "Suite dinâmica RLS (Story 1.4 — Testcontainers Postgres 16 efémero)"). O novo `rls-application.test.ts` em `packages/db-test/src/tests/` é apanhado automaticamente pela config Vitest do package. Provável zero edição ao CI — só confirmar o glob do package.

---

## Dev Agent Record

### Agent Model Used

Dex (@dev) — Claude Opus 4.8 (1M context). Modo YOLO autónomo.

### Debug Log References

- `pnpm lint` → exit 0 (10/10 tasks; "No ESLint warnings or errors").
- `pnpm typecheck` → exit 0 (10/10 tasks). 1 erro intermédio resolvido: `drizzle(pgTx)` rejeitava `TransactionSql` (ver D-SEC2.1).
- `pnpm --filter @meu-jarvis/db test` → 17 pass (4 ficheiros; +4 novos `withHousehold`).
- `pnpm --filter @meu-jarvis/web test` → 1068 pass / 1 flaky (`tarefas/calendario/page.test.tsx`, timeout sob carga paralela; passa isolado 3/3 — não-regressão, flaky conhecido pré-existente).
- `pnpm build` → exit 0 (10/10 tasks).
- `pnpm check:rls` → exit 0 (NFR5 estático: todas as tabelas multi-tenant com coverage SELECT/INSERT/UPDATE/DELETE).
- `pnpm --filter @meu-jarvis/db-test test` (Docker UP) → 36 ficheiros / 175 testes pass, incluindo `rls-application.test.ts` (9 testes — AC-C1/C2/E3).
- CodeRabbit `--prompt-only -t uncommitted`: working tree limpo (9 ficheiros) mas free-tier limita a 150 ficheiros e contou 334 (artefactos não-versionados do workspace). Revisão scoped por `--dir`: `packages/db` → 0 findings; `packages/db-test/src/tests` → 0 findings; `apps/web/src/app/api/tasks` → 0 findings; `apps/web/src/lib/agent` (db-shim) → rate-limited (12min). Nenhum CRITICAL nos 3 dirs revistos; db-shim.ts é re-export lazy de 35 linhas espelhando o padrão `getDb`/`getServiceDb` existente — risco CRITICAL implausível. Self-healing: 0 iterações necessárias.

### Completion Notes

- **Wrapper `withHousehold` (T1/T2):** implementado em `packages/db/src/client.ts` logo abaixo de `getDb()`. Refactor mínimo: extraída a criação da pool postgres-js para `createDbSql()` privada + singleton `_dbSql`, para que `withHousehold` partilhe a MESMA pool de `getDb()` (invariante "uma só pool") e tenha acesso ao `Sql` cru necessário para `.begin()`. A mecânica replica `rls-harness.ts:asUser()` byte-a-byte: `SET LOCAL ROLE authenticated` (unsafe), `set_config('request.jwt.claims', $claims, true)` parametrizado com `{sub, household_id, role}`, `set_config('app.current_household_id', $hid, true)` (defense-in-depth), depois `drizzle(pgTx)` scoped à tx → `fn(tx)`. Comentário falso (linhas 10-14) substituído pela descrição real do estado RLS (getDb bypassa; withHousehold activa; getServiceDb por design).
- **Gate de aplicação (T3):** `rls-application.test.ts` semeia 2 households + dados de domínio e prova isolamento real via `asUser()` (mesma mecânica do wrapper) para `tasks` E `transactions` (SELECT cross-tenant = 0, filtro cruzado = 0, INSERT cross-tenant bloqueado), mais teste AC-E3 confirmando que `service_role` vê ambos os households (bypass intacto). Apanhado automaticamente pelo glob Vitest — zero edição ao CI (confirmado na execução real).
- **Piloto tarefas (T4):** handler `GET /api/tasks` migrado para `withHousehold(auth, (tx) => listTasksHelper({..., db: tx}))`. `withHousehold` roteado por `db-shim.ts` (re-export lazy + tipo `WithHouseholdAuth`) — não reintroduz o break tsc cross-package. Função pura `list-tasks.ts` **intacta** (filtro `household_id` SEC-1 preservado). `POST /api/tasks` mantém `getDb()` (fora de âmbito — Fase 2). Mock do teste existente adaptado; 14/14 verdes.
- **Defense-in-depth confirmado:** SEC-1 (filtro app-enforced) NÃO foi removido. SEC-2 adiciona a 2.ª rede (RLS activa por transação). `getDb()`/`getServiceDb()`/Inngest/migrations intactos (AC-A5/E3).

### [DEV-DECISION] para o gate ratificar

- **[DEV-DECISION D-SEC2.1] (tipagem `drizzle(TransactionSql)`):** `drizzle()` do postgres-js tipa o cliente como `Sql`; o `pgTx` recebido por `begin()` é `TransactionSql` (subconjunto sem `END`/`CLOSE`/`options`/etc — irrelevantes para o Drizzle, que só usa a superfície de execução de queries). Resolvido com cast `pgTx as unknown as Sql` (nunca `any`, conforme AC-E2), comentado inline. Runtime idêntico. **Razão:** alternativa (refactor do tipo de `begin` ou expor o `TransactionSql` cru ao callback como `asUser` faz) quebraria o contrato AC-A1/T2.4 que exige `tx: Database` para os call-sites usarem Drizzle ORM. Padrão idiomático Drizzle+postgres-js.
- **[DEV-DECISION D-SEC2.2] (extracção `createDbSql()` + singleton `_dbSql`):** para `withHousehold` partilhar a pool de `getDb()` sem criar uma segunda, extraí a construção da pool postgres-js para uma função privada e guardei a instância `Sql` num singleton de módulo (`_dbSql`), populado por `getDb()`. `getDbSql()` (privado) inicializa via `getDb()` se ainda não existir. **Razão:** o ADR-003 §3 e Dev Notes pedem "usar a pool subjacente ao getDb(), não uma pool separada". Mudança mínima, transparente para call-sites de `getDb()` (comportamento inalterado — AC-A5).
- **[DEV-DECISION D-SEC2.3] (teste AC-E3 dentro de `rls-application.test.ts`):** adicionei um terceiro `describe` provando que `service_role` vê ambos os households (via `admin().begin()` + `set local role service_role`), em vez de um ficheiro/script separado. **Razão:** AC-E3 vive naturalmente ao lado das asserções de isolamento; mesma fixture (`seedTwoHouseholds`), custo marginal zero, e o leitor vê 1.ª e 2.ª rede + bypass no mesmo sítio.

### File List

| Ficheiro | Acção | Nota |
|---------|-------|------|
| `packages/db/src/client.ts` | Modificado | Comentário 10-14 corrigido (AC-B1); `withHousehold` + `createDbSql()`/`getDbSql()` privados (AC-A1-A5, D-SEC2.2) |
| `packages/db/src/__tests__/client-with-household.test.ts` | Criado | Teste unitário do wrapper (4 testes — AC-A1/A2/A3/A4/A5; mocks de `postgres`/`drizzle`) |
| `packages/db-test/src/tests/rls-application.test.ts` | Criado | Gate de aplicação real (9 testes — AC-C1/C2/E3; tasks + transactions + service_role) |
| `apps/web/src/lib/agent/db-shim.ts` | Modificado | **[PO-FIX-1b]** Re-export lazy de `withHousehold` + tipo `WithHouseholdAuth` |
| `apps/web/src/app/api/tasks/route.ts` | Modificado | **[PO-FIX-1]** Piloto: handler GET envolve `listTasksHelper` em `withHousehold` (POST inalterado) |
| `apps/web/src/app/api/tasks/__tests__/list.test.ts` | Modificado | **[PO-FIX-1]** Mock de `db-shim` expõe `withHousehold` (AC-D2; 14/14 verdes) |
| `.github/workflows/ci.yaml` | Verificado (não editado) | Job `rls-gate` já corre `pnpm --filter @meu-jarvis/db-test test` (`ci.yaml:178`) — apanha o novo teste automaticamente; zero edição confirmada |

---

## QA Results

**Gate:** @architect (Aria) — adversarial-security — 02/06/2026
**Veredicto:** PASS — **9,5/10** — recomendação **Done v1.3-ARCH-APPROVED**
**Gate file:** `docs/qa/gates/SEC-2-architect-gate.md`

### Gates re-corridos independentemente (esta sessão, Docker UP)

| Gate | Resultado |
|------|-----------|
| `pnpm lint` | PASS exit 0 |
| `pnpm typecheck` | PASS exit 0 (FULL TURBO — cast D-SEC2.1 passa strict) |
| `pnpm --filter @meu-jarvis/web test` | 1068 pass / 1 flaky (`tarefas/calendario` — passa isolado 3/3, não-regressão) |
| `pnpm --filter @meu-jarvis/db test` | 17 pass (4 novos `withHousehold`) |
| `pnpm --filter @meu-jarvis/db-test test` | 175 pass / 36 ficheiros; `rls-application.test.ts` 9/9 contra Postgres 16 + role `authenticated` real |
| `pnpm build` | PASS exit 0 |
| `pnpm check:rls` | PASS exit 0 (120 policies) |

### 8 focos de segurança — todos LIMPOS

1. **Anti-injection** — claims/householdId como params bound (`set_config(...,$claims,true)`); zero concatenação SQL.
2. **SET LOCAL correctude** — `SET LOCAL ROLE authenticated` + `set_config(...,true)` dentro de `begin()`; tx scoped (não a pool global); teste prova `hasBareSet===false`.
3. **Fuga pgbouncer** — verificado em `postgres@3.4.9/src/index.js:234-282`: COMMIT em sucesso, ROLLBACK em erro, `onclose` em connection fechada — `SET LOCAL` revertido em TODOS os caminhos antes de a connection voltar à pool.
4. **Pool partilhada (D-SEC2.2)** — `getDb()` inalterado; `withHousehold` partilha mesma pool via `getDbSql()`; `getServiceDb()` pool/URL/role separados, bypass intacto.
5. **Defense-in-depth** — filtro app-enforced SEC-1 (`list-tasks.ts:125`) MANTIDO no piloto.
6. **Cast D-SEC2.1** — `as unknown as Sql` seguro (TransactionSql ⊂ Sql, superfície usada comum); não mascara bug.
7. **Gate de aplicação sem falso-positivo** — dados de ambos households semeados ANTES das asserções; `toHaveLength(1)+household_id correcto` (não 0); INSERT bloqueado com `count(*)=0` independente.
8. **Regressão auto-commit→tx** — SELECT só-leitura único; +1 round-trip marginal; erro→500 provado; sem connection leak.

### [DEV-DECISION] ratificadas

- **D-SEC2.1** (cast `pgTx as unknown as Sql`) — RATIFICADA (idiomático Drizzle+postgres-js; preserva contrato `tx: Database`).
- **D-SEC2.2** (extracção `createDbSql()` + singleton `_dbSql`) — RATIFICADA (invariante "uma só pool"; `getDb()` transparente).
- **D-SEC2.3** (AC-E3 no mesmo ficheiro de teste) — RATIFICADA (mesma fixture; 3 redes visíveis num só sítio).

### OBS (não-bloqueantes)

- **OBS-1:** `getDbSql():89` `as unknown as Sql` redundante (cosmético; `_dbSql!` bastaria).
- **OBS-2:** `POST /api/tasks` mantém `getDb()` (escopo Fase 2; protegido por filtro app-enforced SEC-1).
- **OBS-3:** CodeRabbit não cobriu `db-shim.ts` (rate-limit); auditado manualmente — re-export lazy de 10 linhas, risco CRITICAL implausível.

**Constitution Art. IV (No Invention):** CONFORME. Zero PT-BR no código novo. Zero `any` (cast via `unknown`).

---

## Change Log

| Data | Versão | Descrição | Autor |
|------|--------|-----------|-------|
| 2026-06-02 | 1.0 | Draft inicial — ADR-003 Fase 1 | River (@sm) |
| 2026-06-02 | 1.1-PO | Validação @po (GO 9,0/10). PO-FIX-1: o call-site de piloto NÃO é `list-tasks.ts` (função pura, `db` injectado) mas o handler `tasks/route.ts:89` GET — AC-D1/D3, T4.1-T4.4, Dev Notes e File List corrigidos. PO-FIX-1b: conflito de tipos `DbShim` vs `Database` — `withHousehold` deve ser roteado por `db-shim.ts` para não reintroduzir break tsc cross-package. Corrigidas afirmações factuais falsas: "list-tasks chama getDb()", "já recebe auth: AuthContext", "filtro na linha 168" (real: `:125`). Confirmado byte-a-byte: CI `rls-gate` JÁ corre db-test (`ci.yaml:177-178`); Fase 0 GO real (`diag-adr003-phase0.ts`, caminho 3b); `asUser()` mecânica existe (`rls-harness.ts:322-346`); `getServiceDb()`/`getDb()` intactos. | Pax (@po) |
| 2026-06-02 | 1.3-ARCH-APPROVED | Gate adversarial @architect (Aria). PASS **9,5/10** → Done. 7/7 gates re-corridos verdes independentemente (Docker UP: db-test 175 pass incl. `rls-application` 9/9 contra Postgres 16 + role authenticated real). 8/8 focos de segurança LIMPOS — destaque: foco 3 (fuga pgbouncer) verificado no source de `postgres@3.4.9/src/index.js:234-282` (COMMIT/ROLLBACK/onclose revertem SET LOCAL em todos os caminhos); foco 7 (gate sem falso-positivo) confirmado por ordem de seed (dados ANTES das asserções, `toHaveLength(1)` não 0). 3/3 [DEV-DECISION] ratificadas (D-SEC2.1/2.2/2.3). 11/11 ACs cumpridos. Constitution Art. IV conforme; zero PT-BR/any no código novo. 3 OBS não-bloqueantes (cosmético `getDbSql:89`; POST tasks=escopo Fase 2; CodeRabbit db-shim auditado manualmente). Gate file: `docs/qa/gates/SEC-2-architect-gate.md`. Aguarda push @devops. | Aria (@architect) |
| 2026-06-02 | 1.2-DEV | Implementação completa (modo YOLO). T1-T5 todos [x]. `withHousehold` em `client.ts` (mecânica `asUser()` replicada: SET LOCAL ROLE + claims parametrizados + GUC defense-in-depth; pool partilhada via `createDbSql()`/singleton `_dbSql`). Comentário falso 10-14 corrigido. Teste unitário (4 testes) + teste de aplicação real `rls-application.test.ts` (9 testes — tasks/transactions/service_role). Piloto GET /api/tasks migrado via `withHousehold` roteado por `db-shim.ts`; `list-tasks.ts` intacto; filtro SEC-1 preservado. 6/6 gates GREEN: lint/typecheck/build/check:rls exit 0; db 17 pass; web 1068 pass + 1 flaky conhecido (não-regressão); db-test 175 pass (Docker UP). 3 [DEV-DECISION] D-SEC2.1 (cast `as unknown as Sql` para `drizzle(TransactionSql)`), D-SEC2.2 (extracção pool partilhada), D-SEC2.3 (AC-E3 no mesmo ficheiro de teste). CodeRabbit 0 findings nos 3 dirs revistos. Ready for Review — aguarda @architect *qa-gate. | Dex (@dev) |
