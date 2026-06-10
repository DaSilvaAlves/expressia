# Gate Arquitectural — SEC-8.1 (hotfix `withHousehold` Drizzle `db.transaction()`)

> **Story:** `SEC-8.1` — Fix `withHousehold` regressão `TypeError ...parsers` em runtime.
> **Gate por:** Aria (Architect) — gate adversarial independente (padrão SEC-1→8).
> **Data:** 10/06/2026.
> **Veredicto:** **PASS** · **Confiança: 9,7/10** · severidade do fix: **CRÍTICO (hotfix de produção)**.
> **Decisão:** Story SEC-8.1 → **Done v1.0-ARCH-APPROVED**. Sem `db:migrate` (zero migration).

---

## Contexto

SEC-8.1 corrige uma **regressão crítica de runtime** descoberta por smoke E2E real (10/06): o `withHousehold`
(2.ª rede RLS de toda a cadeia SEC-2→8, 109 call-sites) abria a transacção com `pgSql.begin()` (postgres-js cru)
+ `drizzle(pgTx as unknown as Sql)`. Esse cliente Drizzle estava **PARTIDO em runtime**: qualquer query lançava
`TypeError: Cannot read properties of undefined (reading 'parsers')`. A 2.ª rede RLS **nunca funcionou em runtime
real desde SEC-2 (02/06)**; os gates passaram porque os testes exercitavam uma **réplica** Drizzle (`db.transaction`),
nunca o `pgSql.begin` real. **Segurança:** a 1.ª rede (filtro `household_id` app-enforced) sempre intacta — sem
vazamento; o sintoma era operações a falhar com 500.

A correcção reescreve `withHousehold` para `db.transaction()` (Drizzle) — cliente compatível — preservando
SET LOCAL ROLE authenticated + claims/householdId **bound** (anti-injection) e a semântica ADR-003 §3.

---

## 6 Focos do gate adversarial

| # | Foco | Resultado | Evidência |
|---|------|-----------|-----------|
| 1 | Correcção correcta (db.transaction + SET LOCAL ROLE + set_config bound; RLS activa; pgbouncer-safe) | **MET** | git diff byte-a-byte; claims/householdId via template `sql` (params bound); teste (b) prova `auth.uid()=sub`, `current_household_id()=household` |
| 2 | Teste reproduz o RUNTIME REAL (lição central) | **MET — provado pela minha mão** | `withHousehold.rls.test.ts` importa `@meu-jarvis/db/client` real via `DATABASE_URL`→Testcontainer; **counter-proof independente**: revertendo p/ `pgSql.begin()`, os 3 testes FALHAM com `TypeError ...parsers`; restaurando o fix, 3/3 GREEN. Gate NÃO-tautológico. |
| 3 | 1.ª rede intacta (filtro household_id app-enforced) | **MET** | git diff só toca `client.ts`; zero call-sites alterados; defense-in-depth aditivo |
| 4 | getServiceDb/service_role intactos; órfãos removidos sem quebra | **MET** | `getServiceDb` inalterado; grep `getDbSql\|createDbSql\|_dbSql` = zero refs vivas (só docstrings/stories); `type Sql` ainda usado (`const pgSql: Sql`) → typecheck-safe |
| 5 | Sem migration; fronteiras de packages intactas | **MET** | zero ficheiros em `migrations/`; check:rls 16 tabelas coverage completa; 104 policies intactas |
| 6 | Regressão dos testes (109 call-sites + suites existentes) | **MET** | `client-with-household.test.ts` adaptado à nova mecânica (4/4); todas as suites GREEN |

---

## Counter-proof independente (foco 2 — o mais importante)

Não confiei na afirmação do @dev. Revertendo `withHousehold` para o código antigo (`pgSql.begin()` + `drizzle(pgTx)`)
e correndo o novo gate contra Postgres real:

```
❯ src/tests/withHousehold.rls.test.ts (3 tests | 3 failed)
  × (a) REGRESSÃO …  → Cannot read properties of undefined (reading 'parsers')
  × (b) RLS ACTIVA … → Cannot read properties of undefined (reading 'parsers')
  × (c) CROSS-HOUSEHOLD … → (rollback) 
```

Restaurando o fix (`db.transaction()`): **3/3 GREEN**. O gate genuinamente exercita o caminho de produção e
apanharia esta classe de regressão — exactamente o que o AC9 da SEC-8 (réplica `withHouseholdTxRunner`) NÃO fazia.
`client.ts` restaurado byte-a-byte (git diff = +40 linhas, idêntico ao diff do @dev; zero resíduo do counter-proof
em código vivo).

---

## Gates re-executados (números reais)

| Gate | Resultado |
|------|-----------|
| `pnpm lint` | PASS (10/10 tasks) |
| `pnpm typecheck` | PASS (10/10 packages — `Sql` import ainda usado, sem unused-import) |
| `pnpm check:rls` | PASS (16 tabelas, coverage completa, 104 policies) |
| `pnpm --filter @meu-jarvis/db test` | PASS (17/17 — inclui `client-with-household` nova mecânica) |
| `pnpm --filter @meu-jarvis/db-test test` | PASS (209/209, 39 ficheiros, Docker UP — inclui os 3 `withHousehold.rls`) |
| `pnpm --filter @meu-jarvis/tools test` | PASS (354/354) |
| `pnpm --filter @meu-jarvis/planner-executor test` | PASS (72/72) |
| `pnpm --filter @meu-jarvis/web test` | PASS (1080/1080 — flaky `calendario` passou; não-regressão) |
| `pnpm build` | PASS (Compiled 13.7s; 48/48 páginas estáticas — isolado, após restaurar o fix) |

**Nota build:** a 1.ª execução do build falhou (`MODULE_NOT_FOUND` em `/_error`) por correr concorrente com a
suite web (contenção no worker `.next`) e na janela do counter-proof (código revertido). Re-execução isolada com
o fix restaurado: GREEN, 48/48 páginas. Transiente confirmado, não-regressão.

**Sem `db:migrate`** — zero migration.

---

## Decisões ratificadas

- **D-SEC8.1.1** (`db.transaction()` em vez de `getDbSql()`+`begin()`) — **RATIFICADA.** Único caminho que entrega
  um `tx` Drizzle funcional; alternativas rejeitadas (corrigir shape do pgTx; `db.execute` sem tx) correctamente
  descartadas (frágil / `SET LOCAL` exige transacção em pgbouncer).
- **D-SEC8.1.2** (gate corre o `withHousehold` REAL via `DATABASE_URL`→Testcontainer) — **RATIFICADA.** A réplica
  foi a causa da cegueira; correr o código de produção é a única forma de apanhar regressões de mecânica.
- **D-SEC8.1.3** (extracção de params do `sql` do drizzle no teste unit via `valueOf()`) — **RATIFICADA.** Detalhe
  de teste, não afecta produção.

---

## Observações (não-bloqueantes)

- **OBS-1:** o AC9 (`executeAtomic.rls.test.ts`, réplica `withHouseholdTxRunner`) mantém-se como gate
  **complementar** do caminho `executeAtomic`. Mantém valor (testa a orquestração), mas o gate de mecânica
  real é agora o `withHousehold.rls.test.ts`. Recomendado, em housekeeping futuro, anotar no `executeAtomic.rls.test.ts`
  que a verificação de mecânica de `withHousehold` migrou para o novo teste.
- **OBS-2:** lição transversal para futuros gates SEC: **exercitar sempre o código de produção, nunca uma réplica**.
  O `withHousehold.rls.test.ts` é agora o template de referência para esta classe de teste.

---

## Veredicto

**PASS · 9,7/10.** A correcção é cirúrgica (1 ficheiro de produção), correcta (provada contra Postgres real),
preserva a 1.ª rede e a semântica ADR-003 §3, e — criticamente — o gate passa a correr o código de produção
(counter-proof independente confirma que apanha a regressão). Hotfix urgente de produção: aprovado para fecho.

— Aria, arquitetando o futuro
