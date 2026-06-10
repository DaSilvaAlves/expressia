# Story SEC-8.1: Fix `withHousehold` — regressão `TypeError ...parsers` em runtime (Drizzle `db.transaction()`)

> **ID:** `SEC-8.1` (hotfix de segurança/runtime transversal — corrige a 2.ª rede RLS de **toda** a cadeia SEC-2→8). Story cross-epic, não pertence a epic numerado.
> **Depende de:** SEC-2 (Done — introduziu `withHousehold`), SEC-3/4/5/6/7 (Done — domínios migrados para `withHousehold`), SEC-8 (Done v1.1-ARCH-APPROVED — Cérebro AI via `executeAtomic`+`txRunner`→`withHousehold`).
> **Origem:** smoke E2E do Cérebro AI (run `a8dbb8c6`, 10/06/2026) — primeiro exercício **runtime real** do `withHousehold` em produção — expôs `Tool transaction failed: TypeError: Cannot read properties of undefined (reading 'parsers')`.
> **Diagnóstico (provado contra a DB real):** @aiox-master + scripts `diag-sec8-granular.ts` / `diag-sec8-fix.ts` (descartados após conversão em teste).

## Status

**Done v1.0-ARCH-APPROVED (@architect Aria, 10/06/2026).** Gate adversarial independente: **PASS 9,7/10** (severidade do fix: CRÍTICO/hotfix). 6/6 focos MET. **Counter-proof independente** (foco 2, o central): a própria Aria reverteu `withHousehold` para `pgSql.begin()` e confirmou que os 3 testes de `withHousehold.rls.test.ts` FALHAM com `TypeError ...parsers`; restaurando o fix, 3/3 GREEN — gate NÃO-tautológico, corre o código de produção real. `client.ts` restaurado byte-a-byte (git diff +40, idêntico ao do @dev). Gate file: `docs/qa/gates/SEC-8.1-architect-gate.md`. Próximo: `@devops *push` (commit único de fecho, fast-forward, sem `--force`/`--no-verify`, CodeRabbit SKIP, **sem `db:migrate`**).

> _Gate anterior @dev Dex (10/06/2026, v1.0-DEV): fix de 1 ficheiro de produção + reforço de teste. Causa raiz confirmada empiricamente contra Postgres real (T1 pgTx cru OK; T2/T3 `drizzle(pgTx).execute` → `TypeError ...parsers`). Correcção cirúrgica num único ficheiro de produção (`packages/db/src/client.ts`): `withHousehold` passa de `pgSql.begin()`+`drizzle(pgTx)` para `db.transaction()` (Drizzle), validado a activar a RLS (uid/household correctos). Novo gate de integração `withHousehold.rls.test.ts` exercita o `withHousehold` REAL de produção (não uma réplica) contra Testcontainers. 6/6 gates GREEN._

> _Implementação @dev Dex (10/06/2026, v1.0-DEV): fix de 1 ficheiro de produção + reforço de teste (o gate volta a apanhar regressões deste tipo porque corre o código de produção, não uma réplica). 1.ª rede (filtros `household_id` app-enforced) INALTERADA — sem janela de vazamento cross-tenant; o que havia era operações a falhar com 500._

---

## Executor Assignment

```
executor: "@dev"
quality_gate: "@architect"
quality_gate_tools: ["lint", "typecheck", "test", "build", "check:rls"]
```

## Story

**As a** engenheiro/product owner da Expressia,
**I want** que o wrapper `withHousehold` — a **2.ª rede RLS** de toda a cadeia SEC-2→8 (Finanças, Tarefas, Visão, Household e Cérebro AI) — funcione em **runtime real** sem lançar `TypeError`, abrindo a transacção via `db.transaction()` do Drizzle (cliente compatível) em vez de `pgSql.begin()`+`drizzle(pgTx)` (cliente Drizzle partido),
**so that** todas as ~109 chamadas a `withHousehold` deixem de rebentar com erro 500 em produção, mantendo a RLS genuinamente activa (defense-in-depth de duas redes) e o filtro `household_id` app-enforced (1.ª rede, SEC-1) intacto — e que o **gate de teste passe a correr o código de produção** para nunca mais mascarar uma regressão deste tipo.

---

## Contexto e âmbito

### O problema (causa raiz — provada)

`withHousehold` (em `packages/db/src/client.ts`) abria a transacção com `pgSql.begin()` (postgres-js cru) e depois construía o cliente Drizzle scoped à tx via `const tx = drizzle(pgTx as unknown as Sql)`. Esse cliente Drizzle estava **PARTIDO em runtime**: qualquer query via esse `tx` lançava `TypeError: Cannot read properties of undefined (reading 'parsers')`. O `TransactionSql` que `postgres.begin()` passa ao callback **não tem a shape** (`.options.parsers`) que o driver `drizzle-orm/postgres-js` espera ao construir um cliente sobre ele.

**Impacto:** `withHousehold` é usado por ~109 ficheiros (toda a superfície SEC-2→8). TODOS rebentavam em runtime — a 2.ª rede RLS **nunca funcionou em runtime real desde SEC-2 (02/06/2026)**. Os gates passavam porque os testes usavam mocks/harness Drizzle (`db.transaction`), **nunca** o `pgSql.begin` real de produção. O smoke E2E do Cérebro AI (10/06) foi o primeiro exercício runtime real e expôs o bug (run `a8dbb8c6`).

**Nota de segurança:** a **1.ª rede** (filtro `household_id` app-enforced, SEC-1) estava **intacta** — sem janela de vazamento cross-tenant. O sintoma era operações a falhar com 500, não fuga de dados.

### Porque o gate AC9 da SEC-8 não apanhou isto

O teste `executeAtomic.rls.test.ts` (AC9) montava um `txRunner` caseiro (`withHouseholdTxRunner`) que **REPLICAVA** a mecânica do `withHousehold` usando `db.transaction()` do Drizzle — exactamente o caminho que **funciona**. Nunca exercitou o `withHousehold` REAL de produção (que usava `pgSql.begin()`). A réplica mascarou a regressão. **Lição central:** o gate tem de correr o código de produção, não uma cópia.

### A correcção (validada empiricamente)

Reescrever `withHousehold` para usar `db.transaction()` (Drizzle) em vez de `pgSql.begin()`+`drizzle(pgTx)`:

- `getDb()` devolve um cliente Drizzle compatível; `db.transaction(async (tx) => …)` injecta o **transaction client do Drizzle**, totalmente compatível com `tx.execute`/query-builder e com a interface `DbShim`.
- `SET LOCAL ROLE authenticated` + `set_config('request.jwt.claims', $claims, true)` + `set_config('app.current_household_id', $householdId, true)` emitidos via `tx.execute(sql\`…\`)` — `claims` e `householdId` continuam **parâmetros bound** via template `sql` (anti-injection — nunca concatenados).
- `SET LOCAL` reverte no COMMIT — seguro em pgbouncer transaction-mode (6543). Semântica do ADR-003 §3 mantida.
- `getDbSql()` (a pool crua só usada pelo antigo `withHousehold`) ficou **órfão** → removido. `createDbSql()` (extraída só por causa do `getDbSql`) inlinada em `getDb()`. `_dbSql` (write-only após a remoção) removido.

---

## Acceptance Criteria

| # | Critério | Verificação |
|---|----------|-------------|
| AC1 | `withHousehold` abre a transacção via `db.transaction()` do Drizzle (não `pgSql.begin()`) | `client.ts` — `db.transaction(async (tx) => …)` |
| AC2 | `claims` e `householdId` continuam parâmetros **bound** via template `sql` (anti-injection) | `tx.execute(sql\`… ${claims} …\`)` — teste unit AC-A2/A3 |
| AC3 | `SET LOCAL ROLE authenticated` emitido; **nunca** `SET` simples | teste unit AC-A3 (`hasBareSet === false`) |
| AC4 | A RLS fica **genuinamente activa** dentro da tx (`auth.uid()` = sub, `current_household_id()` = household) | `withHousehold.rls.test.ts` (b) contra Postgres real |
| AC5 | Uma escrita simples via `withHousehold` REAL **sucede** (regressão directa do `TypeError`) | `withHousehold.rls.test.ts` (a) — falha com código antigo |
| AC6 | Cross-household via `withHousehold` REAL é **REJEITADO pela RLS** (não pelo filtro app) | `withHousehold.rls.test.ts` (c) — `row-level security` |
| AC7 | O gate de integração exercita o `withHousehold` **REAL de produção** (importado de `@meu-jarvis/db/client`), não uma réplica | `withHousehold.rls.test.ts` importa `mod.withHousehold` apontando `DATABASE_URL` ao Testcontainer |
| AC8 | 1.ª rede (filtros `household_id` app-enforced) e `getServiceDb` **INALTERADOS** | git diff — só `client.ts` toca produção; nada em call-sites |
| AC9 | Zero migration; 6/6 gates GREEN | lint · typecheck · check:rls · db · db-test · build |

---

## Tasks / Subtasks

- [x] **T1 — Confirmar causa raiz contra a DB real** (não assumir)
  - [x] Correr `diag-sec8-granular.ts` → T1 OK, T2/T3 `TypeError ...parsers` confirmado
  - [x] Correr `diag-sec8-fix.ts` → `db.transaction()` sucede + RLS activa (uid/hh correctos)
- [x] **T2 — Reescrever `withHousehold`** (`packages/db/src/client.ts`)
  - [x] `pgSql.begin()`+`drizzle(pgTx)` → `db.transaction()` (Drizzle)
  - [x] `claims`/`householdId` bound via template `sql` (anti-injection mantido)
  - [x] Remover `getDbSql()` órfão; inlinar `createDbSql()` em `getDb()`; remover `_dbSql` write-only
  - [x] Actualizar docstring (mecânica + nota de regressão SEC-8.1)
- [x] **T3 — Reforçar o gate: teste que corre o `withHousehold` REAL de produção**
  - [x] `packages/db-test/src/tests/withHousehold.rls.test.ts` — importa `@meu-jarvis/db/client` apontando `DATABASE_URL` ao Testcontainer
  - [x] (a) escrita simples sucede (regressão), (b) RLS activa, (c) cross-household rejeitado
  - [x] **Provar que falha com o código antigo** — restaurado `pgSql.begin()` temporariamente: 3/3 falham com `TypeError ...parsers`; revertido
  - [x] Adaptar o teste unit `client-with-household.test.ts` à nova mecânica (`db.transaction()` mockada)
- [x] **T4 — Limpeza** — remover scripts de diagnóstico temporários (`diag-sec8-array.ts`, `diag-sec8-granular.ts`, `diag-sec8-fix.ts`)
- [x] **T5 — Gates** — lint · typecheck · check:rls · `@meu-jarvis/db` · `@meu-jarvis/db-test` · `@meu-jarvis/tools` · `@meu-jarvis/planner-executor` · `@meu-jarvis/web` · build

---

## Dev Agent Record

### Agent Model Used

Claude Opus 4.8 (1M) — @dev (Dex).

### Debug Log References

- Causa raiz: `diag-sec8-granular.ts` → `host: …:6543 | T1 pgTx cru: {"ok":1} | T2 FALHOU: TypeError ...parsers | T3 FALHOU: TypeError ...parsers`.
- Correcção: `diag-sec8-fix.ts` → `FIX db.transaction OK — RLS context: {"uid":"df5b403f-…","hh":"2dedb1ec-…"}`.
- Prova de regressão do novo gate (código antigo restaurado temporariamente): `withHousehold.rls.test.ts` → 3/3 `TypeError: Cannot read properties of undefined (reading 'parsers')`. Código corrigido restaurado → 3/3 GREEN.

### Completion Notes

- **Causa raiz vs sintoma:** o cliente Drizzle construído sobre o `TransactionSql` de `postgres.begin()` não tem `.options.parsers` — o driver `drizzle-orm/postgres-js` espera-o ao instanciar. `db.transaction()` do Drizzle reusa o cliente da pool (correctamente configurado) e abre a tx internamente — daí funcionar.
- **Fronteira:** correcção isolada a `packages/db/src/client.ts`. Nenhum dos ~109 call-sites tocado — todos chamam `withHousehold` (assinatura intacta). 1.ª rede e `getServiceDb` inalterados. Billing CONGELADO (não tocado).
- **Reforço do gate (AC7):** o novo `withHousehold.rls.test.ts` aponta `process.env.DATABASE_URL` à connection do Testcontainer (`RLS_TEST_DATABASE_URL`) em `beforeAll` e importa dinamicamente o `withHousehold` de `@meu-jarvis/db/client` — o **mesmo** código de produção. O role `authenticated` + `auth.*` helpers já são criados pelo bootstrap do globalSetup, logo a RLS activa. O AC9 original (`executeAtomic.rls.test.ts`, com réplica `txRunner`) mantém-se como gate complementar do caminho `executeAtomic`.

#### [DEV-DECISION] D-SEC8.1.1 — `db.transaction()` em vez de `getDbSql()`+`begin()`
- **Decisão:** usar `getDb().transaction()` (Drizzle) e remover toda a maquinaria de acesso à pool crua (`getDbSql`, `createDbSql` extraída, `_dbSql`).
- **Razão:** o cliente Drizzle sobre `TransactionSql` cru está partido em runtime (provado). `db.transaction()` é o caminho idiomático do Drizzle e o único que entrega um `tx` funcional. A pool crua só existia para alimentar o `begin()` — agora desnecessária.
- **Alternativas rejeitadas:** (a) corrigir a shape do `pgTx` antes de `drizzle(pgTx)` — frágil, depende de internals do postgres-js; (b) `db.execute` sem transacção + `SET LOCAL` na connection — perigoso em pgbouncer transaction-mode (vazaria contexto cross-request). `SET LOCAL` exige transacção.

#### [DEV-DECISION] D-SEC8.1.2 — gate corre o `withHousehold` REAL via `DATABASE_URL`→Testcontainer
- **Decisão:** no novo teste, apontar `DATABASE_URL` ao container e importar `@meu-jarvis/db/client` dinamicamente, em vez de replicar a mecânica.
- **Razão:** a réplica (`withHouseholdTxRunner`) foi exactamente o que mascarou a regressão. Correr o código de produção é a única forma de o gate apanhar regressões de mecânica deste tipo (AC7).
- **Nota de isolamento:** `getDb()` é singleton por processo; em `pool: forks, singleFork: true` o registry de módulos é partilhado, mas nenhum outro ficheiro db-test importa `@meu-jarvis/db/client` `getDb`/`withHousehold` — o singleton é criado só por este teste, apontando ao container. Sem colisão.

#### [DEV-DECISION] D-SEC8.1.3 — extracção de params do `sql` do drizzle no teste unit
- **Decisão:** no `client-with-household.test.ts`, o helper `describeSql` normaliza o valor bound via `String.prototype.valueOf()` (o drizzle interpola o param como wrapper primitivo `String`, não como `Param{value}`).
- **Razão:** confirmado por inspecção do `queryChunks` real (`StringChunk` + `String` wrapper). Sem isto, a asserção dos claims lia `undefined`.

### File List

**Modificados (produção):**
- `packages/db/src/client.ts` — `withHousehold` reescrito (`db.transaction()`); `getDbSql`/`createDbSql`/`_dbSql` removidos; docstrings actualizados.

**Modificados (teste):**
- `packages/db/src/__tests__/client-with-household.test.ts` — adaptado à nova mecânica (`db.transaction()` mockada; extracção de params do `sql`).

**Criados (teste):**
- `packages/db-test/src/tests/withHousehold.rls.test.ts` — gate de integração do `withHousehold` REAL de produção contra Testcontainers (regressão + RLS viva + cross-household).

**Removidos (scripts de diagnóstico temporários):**
- `packages/db/src/scripts/diag-sec8-array.ts`
- `packages/db/src/scripts/diag-sec8-granular.ts`
- `packages/db/src/scripts/diag-sec8-fix.ts`

### Change Log

| Data | Versão | Descrição | Autor |
|------|--------|-----------|-------|
| 2026-06-10 | v1.0-DEV | Fix `withHousehold` (`db.transaction()`); novo gate de integração que corre o código de produção (provado que falha com o antigo); limpeza de scripts. 6/6 gates GREEN. Ready for Review. | @dev (Dex) |

---

## Gates executados (6/6 GREEN)

| Gate | Resultado |
|------|-----------|
| `pnpm lint` | PASS (10/10 tasks) |
| `pnpm typecheck` | PASS (10/10 packages) |
| `pnpm check:rls` | PASS (16 tabelas, coverage completa) |
| `pnpm --filter @meu-jarvis/db test` | PASS (17/17) |
| `pnpm --filter @meu-jarvis/db-test test` | PASS (209/209, Docker UP — inclui os 3 novos `withHousehold.rls`) |
| `pnpm --filter @meu-jarvis/tools test` | PASS (354/354) |
| `pnpm --filter @meu-jarvis/planner-executor test` | PASS (72/72) |
| `pnpm --filter @meu-jarvis/web test` | PASS (1079/1080 + 1 flaky `calendario` — verde isolado 1306ms; timeout só sob carga da suite completa, não-regressão) |
| `pnpm build` | PASS (exit 0; 48 páginas estáticas; compiled 13.8s) |

**Sem `db:migrate`** — zero migration (104 policies intactas).
