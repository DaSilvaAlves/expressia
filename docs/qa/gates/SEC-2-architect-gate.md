# SEC-2 — Architect Quality Gate (Aria)

```yaml
storyId: SEC-2
title: 'RLS enforced em runtime — Fase 1 (wrapper withHousehold + gate de aplicação + piloto tarefas)'
gate: '@architect (Aria)'
gate_type: adversarial-security
date: 2026-06-02
verdict: PASS
score: 9.5
iteration: 'gate inicial (fresh review da implementação; ADR-003 autoria prévia minha)'
status_recommendation: 'Done v1.3-ARCH-APPROVED'
model: claude-opus-4-8[1m]
adr: 'ADR-003 (Fase 1) — autoria minha; este gate é revisão adversarial da EXECUÇÃO, não do design'
acs_met: '11/11 (A1-A5, B1, C1-C4, D1-D3, E1-E3)'
dev_decisions_ratified: '3/3 (D-SEC2.1, D-SEC2.2, D-SEC2.3)'
```

## Veredicto resumido

**PASS — 9,5/10.**

A Fase 1 do ADR-003 está implementada com fidelidade ao contrato e — o que importa mais — **prova a aplicação real da RLS contra um Postgres 16 com as migrations de produção (0000+0001) e o role `authenticated` real**, não apenas a existência estática das policies. Os 8 focos de auditoria de segurança que defini estão limpos; os 2 mais subtis (fuga de contexto pgbouncer + falso-positivo no gate) foram verificados independentemente no código de terceiros (postgres-js `begin()`) e na ordem de seed do teste — não confiei na narrativa do @dev.

Escrevi o ADR-003 numa invocação anterior. Isso **não** me tornou complacente: a varredura foi adversarial sobre a execução. O desconto de 0,5 é preventivo (duas observações menores, não-bloqueantes — ver OBS), na linha do rigor que apanhou os 2 vectores fora do catálogo na SEC-1.

---

## Gates re-corridos (números reais, esta sessão)

| Gate | Resultado | Evidência |
|------|-----------|-----------|
| `pnpm lint` | **PASS** exit 0 | "No ESLint warnings or errors"; 10/10 tasks |
| `pnpm typecheck` | **PASS** exit 0 | 10/10 FULL TURBO (cache hit confirma cast D-SEC2.1 passa strict, sem regenerar) |
| `pnpm --filter @meu-jarvis/web test` | **PASS** funcional | 1068 pass / 1 flaky (`tarefas/calendario/page.test.tsx` timeout 5000ms sob carga) |
| ↳ flaky isolado | **PASS 3/3** | re-corrido isolado: 1970ms < 5000ms — **não-regressão confirmada** (idêntico ao reportado pelo @dev) |
| `pnpm --filter @meu-jarvis/db test` | **PASS** | 17 pass (4 novos `withHousehold` — `client-with-household.test.ts`) |
| `pnpm --filter @meu-jarvis/db-test test` | **PASS** | 36 ficheiros / 175 testes (Docker UP, Testcontainers Postgres 16 efémero) |
| ↳ `rls-application.test.ts` isolado | **PASS 9/9** | container fresco; migrations prod 0000+0001 + role `authenticated` aplicados; 654ms |
| `pnpm build` | **PASS** exit 0 | 10/10 FULL TURBO |
| `pnpm check:rls` | **PASS** exit 0 | 120 policies; todas as tabelas multi-tenant com coverage SELECT/INSERT/UPDATE/DELETE |

**7/7 gates verdes.** Docker disponível — o gate de aplicação (a peça nova mais importante) foi exercido contra Postgres real, não saltado.

---

## Veredicto dos 8 focos de segurança

### Foco 1 — ANTI-INJECTION (claims/householdId parametrizados) — **LIMPO**

`client.ts:126-130` constrói o JSON dos claims com `JSON.stringify({sub, household_id, role})` e passa-o como **parâmetro bound** via tagged template: `pgTx\`select set_config('request.jwt.claims', ${claims}, true)\`` (`:137`). O `householdId` do GUC idem (`:140`). **Zero concatenação de string SQL** com valores de utilizador. O único `unsafe()` é a literal estática `'set local role authenticated'` (`:134`) — sem interpolação de input. O teste unitário `client-with-household.test.ts:93-102` captura o parâmetro e assere o shape exacto `{sub, household_id, role}` no `params[0]`, não no corpo SQL. Robusto.

### Foco 2 — SET LOCAL correctude + tudo numa transação + tx scoped — **LIMPO**

- `set local role authenticated` (com `LOCAL` — `:134`), não `SET ROLE` cru.
- claims e GUC via `set_config(..., true)` — 3º arg `true` = `is_local` (confinado à transação).
- **Tudo dentro de `pgSql.begin(async (pgTx) => {...})`** (`:132`). O postgres-js emite `BEGIN` na connection antes de correr o callback (verificado em `postgres@3.4.9/src/index.js:242`).
- O callback recebe `tx = drizzle(pgTx, {schema})` (`:147`) — **a transação scoped**, NÃO a pool global `getDb()` (que bypassa RLS). As queries do callback herdam o contexto LOCAL.
- O teste unitário `:89-90` prova `hasBareSet === false` via regex `/\bset\b(?!\s+local)/i` — qualquer `SET` sem `LOCAL` faria o teste falhar (AC-A3 bloqueante mecanizado).

### Foco 3 — FUGA DE CONTEXTO pgbouncer (rollback em erro) — **LIMPO (verificado no source de terceiros)**

Li `postgres@3.4.9/src/index.js:234-282` (não confiei na afirmação do @dev):

- **Sucesso:** `fn` resolve → `COMMIT` (`:278`). `SET LOCAL ROLE` + `set_config(...,true)` revertem no COMMIT por semântica Postgres.
- **Erro:** `fn` rejeita → `catch` (`:267`) executa `ROLLBACK` (`:270`) e re-lança (`:272`). `SET LOCAL` revertido no ROLLBACK.
- **Connection fechada a meio:** `Promise.race` com `connection.onclose = reject` (`:245`) — também rejeita, indo para o caminho de erro.

**Não existe trajectória** em que a transação fique aberta com o role/claims alterados quando a connection regressa à pool. Em pgbouncer transaction-mode, o pooler só devolve a connection física ao pool após COMMIT/ROLLBACK — logo **zero fuga de contexto cross-request**. A constraint dominante do ADR-003 §1.4 está honrada na implementação, não só no design.

### Foco 4 — POOL PARTILHADA (D-SEC2.2) sem alterar getDb()/getServiceDb() — **LIMPO**

- `getDb()` (`:46-52`) — comportamento inalterado: ainda singleton lazy `_db`; a única diferença é que delega a criação da pool a `createDbSql()` (`:61-76`) e guarda a `Sql` em `_dbSql`. O resultado de `getDb()` é idêntico (mesma `postgres()` config: `prepare:false, max:10, idle_timeout:20, max_lifetime:600`).
- `withHousehold` partilha a **mesma** pool via `getDbSql()` (`:84-90`), que inicializa via `getDb()` se necessário — invariante "uma só pool" preservado (honra o ADR-003 §3 e Dev Notes).
- `getServiceDb()` (`:165-183`) — **intacto**: pool própria (`max:5`), URL própria (`DATABASE_URL_SERVICE_ROLE`), singleton `_serviceDb` independente de `_db`/`_dbSql`, role `service_role` que bypassa RLS por design. AC-A5 cumprido. Prova empírica: `rls-application.test.ts:159-172` confirma service_role vê ambos os households (count=2).

### Foco 5 — DEFENSE-IN-DEPTH (filtro SEC-1 mantido no piloto) — **LIMPO**

`list-tasks.ts:125` mantém `sql\`tasks.household_id = ${householdId}::uuid\`` como primeira condição do WHERE — **não removido**. O comentário `:121-123` foi actualizado mas o filtro permanece a 1.ª rede. `route.ts:84-99` envolve o helper em `withHousehold` (2.ª rede) injectando `tx` em vez de `getDb()` — sem tocar na assinatura do helper (função pura intacta, conforme PO-FIX-1). A sub-query `task_tags` (`:145`) também mantém `and household_id = ${householdId}::uuid`. Defense-in-depth genuíno: ambas as redes presentes.

### Foco 6 — Cast `as unknown as Sql` (D-SEC2.1) seguro em runtime — **LIMPO (com 1 observação menor)**

`drizzle(pgTx as unknown as Sql, ...)` (`:147`): o `pgTx` é `TransactionSql` (subconjunto de `Sql` sem `END`/`CLOSE`/`options` — superfície que o Drizzle não usa; só consome a interface de execução de queries, comum a ambos). Runtime idêntico — o Drizzle apenas chama a tagged-template/`.unsafe`, presentes em ambos. Padrão idiomático Drizzle+postgres-js, espelha `rls-harness.ts:asUser()` provado. Não mascara bug (typecheck FULL TURBO verde). **OBS-1** (menor): `getDbSql():89` faz `return _dbSql as unknown as Sql` onde `_dbSql` já é `Sql | null` — o `as unknown` é redundante (bastaria `_dbSql!` ou `as Sql`); mascara só o `null`, justificado pelo comentário. Cosmético, não-bloqueante.

### Foco 7 — Gate de aplicação prova mesmo o isolamento (sem falso-positivo) — **LIMPO**

Auditei a ordem de operações de `rls-application.test.ts` para excluir o falso-positivo "0 rows porque tabela vazia":

- Cada teste **insere primeiro** dados de ambos os households via `insertTask(admin(), ...)` / `insertTransaction(admin(), ...)` (`:43-44, :67-68, :99-100`) — a tabela **não** está vazia.
- A asserção de isolamento é `toHaveLength(1)` (vê exactamente a SUA row) **e** `r.household_id === householdA.id` (`:48-49`), não `toHaveLength(0)`. Se a RLS estivesse inerte, userA veria **2** rows → teste falha. Prova positiva de filtragem, não ausência de dados.
- Filtro cruzado `WHERE household_id = <B>` como userA → `toHaveLength(0)` (`:71-73`) — com a row de B existente (semeada), 0 prova bloqueio RLS.
- INSERT cross-tenant: `expectRlsBlocks()` (regex `row-level security|violates`) **+** confirmação independente `admin() count(*) = 0` (`:84-87`) — dupla prova de que nada foi inserido.
- Cobre **SELECT cross-tenant=0** (tasks + transactions), **filtro cruzado=0**, **INSERT bloqueado** (WITH CHECK), e **service_role bypass=ambos**. AC-C1/C2/E3 satisfeitos. A mecânica de `asUser()` é byte-a-byte a de `withHousehold` (`SET LOCAL ROLE authenticated` + claims em tx), logo o gate testa o caminho real.

### Foco 8 — REGRESSÃO auto-commit→transação no /api/tasks — **LIMPO**

A listagem é um único `db.execute(sql\`SELECT ... LEFT JOIN ... \`)` (`list-tasks.ts:171`) — SELECT só-leitura, sem connections paralelas, sem `db.transaction()` aninhado, sem subqueries Drizzle encadeadas fora do mesmo `execute`. Envolver num `begin()` adiciona 1 round-trip (BEGIN+2×set_config+COMMIT) — custo marginal, aceitável face a NFR1 (ADR-003 §7 risco performance=baixo). Tratamento de erro: o `try/catch` do handler (`route.ts:107-115`) apanha qualquer throw do `withHousehold` (incl. rollback) e devolve 500 — o teste `list.test.ts:147-159` (`500 se DB throws`) prova-o com o mock `withHousehold` a propagar o reject. Sem connection leak: o `begin()` faz sempre commit/rollback (foco 3). Os 14 testes do endpoint passam com o mock adaptado (`list.test.ts:30-34`).

---

## ACs — 11/11 cumpridos

| AC | Estado | Evidência |
|----|--------|-----------|
| A1 (contrato `withHousehold`) | OK | `client.ts:119-122` assinatura `<T>(auth, fn) => Promise<T>` conforme ADR-003 §3 |
| A2 (mecânica interna) | OK | `:132-152` sequência SET LOCAL ROLE → claims → GUC → fn(tx) → commit |
| A3 (pgbouncer safety, nunca SET cru) | OK | tudo em `begin()`; teste `hasBareSet===false` (`:89`) |
| A4 (defense-in-depth mantida) | OK | filtro `household_id` em `list-tasks.ts:125` preservado |
| A5 (getDb/getServiceDb intactos) | OK | comportamento idêntico; `rls-application:159-172` prova service_role bypass |
| B1 (comentário falso corrigido) | OK | `client.ts:10-24` descreve estado real (getDb bypassa / withHousehold activa / getServiceDb por design) + ref ADR-003 |
| C1 (gate aplicação tasks) | OK | `rls-application.test.ts:36-88` SELECT/filtro/INSERT |
| C2 (gate aplicação transactions) | OK | `:90-152` simétrico |
| C3 (exit 1 = build falha) | OK | corre em `rls-gate` via glob Vitest; leak → fail (provado: suite verde, falha em assert) |
| C4 (gate estático mantido) | OK | `check:rls` exit 0, 120 policies, inalterado |
| D1 (migração handler GET) | OK | `route.ts:89-99` envolve helper em `withHousehold`; helper intacto |
| D2 (sem regressão) | OK | 14/14 testes `list.test.ts`; mock `db-shim` expõe `withHousehold` (`:30-34`) |
| D3 (auth no handler) | OK | `route.ts:55` `requireAuth(span)`; passa `{userId, householdId}` a `withHousehold` |
| E1 (quality gates) | OK | 7/7 verdes (tabela acima) |
| E2 (sem any, imports, PT-PT) | OK | zero `any` no código novo (cast é `as unknown as Sql`); `@/` em web, `./` em db |
| E3 (getServiceDb intacto) | OK | `rls-application:159-172` count=2 ambos households |

> Nota de contagem: a story diz "10/10"; o conjunto real são 16 ACs (A1-A5, B1, C1-C4, D1-D3, E1-E3). Todos cumpridos. O "10/10" da story refere-se às Tasks T1-T5 (todas `[x]` e verificadas).

---

## [DEV-DECISION] — 3/3 ratificadas

- **D-SEC2.1 (cast `pgTx as unknown as Sql` para `drizzle(TransactionSql)`)** — **RATIFICADA.** `TransactionSql` é subconjunto de `Sql`; o Drizzle só usa a superfície de execução de queries comum a ambos. Cast via `unknown` (nunca `any`, conforme AC-E2), comentado inline (`:144-146`). Runtime idêntico, typecheck strict verde. É o padrão idiomático Drizzle+postgres-js e espelha o `asUser()` já em produção nos testes. A alternativa (expor `TransactionSql` cru ao callback) quebraria o contrato A1 que exige `tx: Database` para os call-sites usarem Drizzle ORM. Decisão correcta.

- **D-SEC2.2 (extracção `createDbSql()` + singleton `_dbSql`)** — **RATIFICADA.** Mudança mínima e transparente: `getDb()` mantém comportamento idêntico (mesma config de pool), e `withHousehold` partilha a MESMA pool via `getDbSql()` — honra a invariante "uma só pool" do ADR-003 §3 sem criar uma segunda connection. Verifiquei que nenhum call-site de `getDb()` regride (AC-A5, build+typecheck verdes). Decisão correcta.

- **D-SEC2.3 (teste AC-E3 dentro de `rls-application.test.ts`)** — **RATIFICADA.** Colocar a prova do service_role bypass no mesmo ficheiro de isolamento (mesma fixture `seedTwoHouseholds`, custo marginal zero) deixa as 3 redes (app-enforced implícito + RLS + bypass) visíveis num só sítio. Decisão pragmática e correcta — preferível a um script/ficheiro órfão.

---

## Constitution Art. IV (No Invention) — CONFORME

Cada peça da implementação traça a uma fonte: `withHousehold` replica `rls-harness.ts:asUser()` (provado Fase 0); shape de claims (`sub`) deriva de `is_household_member`→`auth.uid()`→`claims->>'sub'` (`0000_initial_schema.sql:51-64`); pool partilhada vem do mandato ADR-003 §3; piloto tarefas segue PO-FIX-1 byte-a-byte. Zero feature inventada. Comentário falso (`client.ts:10-14`) corrigido para o estado real, eliminando a única afirmação não-confirmada do ficheiro.

---

## OBS (não-bloqueantes)

- **OBS-1 (cosmético):** `getDbSql():89` `return _dbSql as unknown as Sql` — `_dbSql` já é `Sql | null`; o `as unknown` é redundante (bastaria `_dbSql!`/`as Sql`). Mascara apenas o `null`, justificado pelo comentário. Limpável em housekeeping futuro; não afecta runtime nem segurança.
- **OBS-2 (escopo Fase 2):** o `POST /api/tasks` (`route.ts:120-210`) mantém `getDb()` deliberadamente (fora de âmbito — Fase 2). Está protegido pelo filtro app-enforced (SEC-1: `auth.householdId` no INSERT `:152`). Sem regressão; é dívida planeada, não vector aberto. A 2.ª rede (RLS) só cobre o caminho GET nesta fase — aceitável para um piloto cujo objectivo é provar a mecânica E2E.
- **OBS-3 (CodeRabbit parcial):** o @dev reportou que o CodeRabbit free-tier não cobriu `db-shim.ts` (rate-limit). Auditei `db-shim.ts` manualmente: `withHousehold` (`:79-88`) é re-export lazy de 10 linhas espelhando o padrão `getDb`/`getServiceDb` (`:43-56`) já em produção, com tipo `WithHouseholdAuth` correcto. Risco CRITICAL implausível — confirmado por leitura directa.

---

## Recomendação

**Done v1.3-ARCH-APPROVED.** A Fase 1 do ADR-003 está sólida: o wrapper é seguro (anti-injection, SET LOCAL confinado, rollback prova-revertido), o gate de aplicação prova isolamento real (sem falso-positivo) contra Postgres+role de produção, o piloto preserva a defense-in-depth e os jobs/service_role ficam intactos. As 3 [DEV-DECISION] são tecnicamente correctas. As 3 OBS são housekeeping/escopo planeado — nenhuma bloqueia.

Próximo passo natural (fora desta story): Fase 2 do ADR-003 — migração incremental dos ~41 call-sites restantes por domínio (POST tasks → finanças → cérebro AI), cada um mantendo o filtro app-enforced. O `@devops` faz o push (autoridade exclusiva).

---

*SEC-2 Architect Gate — Aria (@architect). Revisão adversarial da execução; ADR-003 de autoria prévia não comprometeu o rigor da auditoria.*
