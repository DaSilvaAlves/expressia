# Architect Gate — Story SEC-4 (Finanças SSR — fechar leak cross-tenant app-enforced + RLS enforced em runtime)

**Story:** SEC-4 — Finanças SSR: 1.ª rede (app-enforced) nos 6 helpers + 2.ª rede (`withHousehold`) nas 5 pages
**Reviewer:** Aria (Architect AIOX) — gate arquitectural adversarial (padrão SEC-1/SEC-2/SEC-3; @qa não aplicável — security cross-epic)
**Review date:** 2026-06-03
**Story file:** `docs/stories/active/SEC-4.rls-enforced-runtime-fase3-financas-ssr-app-enforced.story.md`
**Story version reviewed:** v0.3-DEV (Ready for Review)
**ADR:** `docs/adr/ADR-003-rls-enforced-runtime-hardening.md` Adenda §10 (padrão RSC/SSR confirmado)
**Leak confirmation:** `docs/security/SEC4-FINANCAS-SSR-LEAK-CONFIRMATION-20260602.md`
**CodeRabbit:** Disabled (padrão SEC-1/2/3 — validação via gate adversarial)

---

## Decisão

**`PASS`** (APPROVED) — score **9,6/10**, confidence **HIGH**.

O leak cross-tenant CRITICAL nas 5 SSR pages de Finanças está **fechado com defense-in-depth de 2 redes**, em paridade com os route handlers `/api/financas/*` (SEC-3). A 1.ª rede (app-enforced) — que era **inexistente** nesta superfície — foi adicionada às 16 queries dos 6 helpers; a 2.ª rede (`withHousehold`) envolve o fetch das 5 pages, activando as 104 RLS policies em runtime. Implementação byte-a-byte conforme as ACs, sem invenção e sem desvio do padrão canónico.

Próximo passo: `@devops *push` (fast-forward, **sem** `db:migrate` — zero migration). Sem acções @dev restantes.

---

## Sumário executivo

SEC-4 não era "adicionar uma 2.ª rede" — a verificação byte-a-byte do @sm revelara que as 5 SSR pages de Finanças **não tinham 1.ª rede nenhuma**: dependiam 100% de RLS, que está **inerte em runtime** (`getDb()` liga como role com `rolbypassrls=TRUE` — ADR-003 §1.1). Logo havia um leak cross-tenant **live** de dados bancários (contas, IBANs, saldos, transacções, cartões, recorrências) — a mesma classe do ACHADO-2 de SMOKE-6.7, não coberta pela auditoria CROSS-TENANT de SEC-1.

A implementação fecha-o em duas frentes simultâneas e independentemente verificadas neste gate:

1. **Parte A (1.ª rede — fecha o leak):** filtro `household_id` app-enforced nas **16 queries** dos 6 helpers, sempre via parâmetro bound (`${householdId}::uuid`), nunca concatenação. Confirmei query-a-query contra o mapa de AC1 — nenhuma esquecida, incluindo o `installments` que ganhou um `WHERE` totalmente novo (o ponto mais propenso a omissão).
2. **Parte B (2.ª rede — RLS viva):** `withSpan` outermost → `withHousehold` inner nas 5 pages (ADR-003 Adenda §10.3). `getDb()` removido por completo. `este-mes` e `variaveis` mantêm o `Promise.all` **dentro** do mesmo callback — partilham transação/contexto RLS (AC3).

A única query divergente — categorias globais em `getVariableTxFilterOptions` (`OR household_id IS NULL`) — está correctamente isolada das de accounts/cards (estritas), espelhando `/api/financas/categorias`. Os `LEFT JOIN categories` em month-summary/list-recurrences/list-variable filtram a tabela principal (`t.`/`r.`), nunca o join — o nome de uma categoria global aparecer é comportamento correcto.

**DEV-DECISION-1 ratificada** (escopo do diag empírico). Os 6 gates de qualidade foram **re-executados por mim de forma independente** — todos verdes. Sem migration, sem toques em billing (congelado).

---

## Inspecção adversarial — focos do handoff

### a) As 16 queries (mapa AC1) — filtro bound em cada, nenhuma esquecida

| Helper | Query | Filtro verificado | Bound |
|--------|-------|-------------------|-------|
| `account-balances.ts` | accounts `:109` | `and household_id = ${householdId}::uuid` | ✓ |
| `account-balances.ts` | transactions `:119` | `and household_id = ${householdId}::uuid` | ✓ |
| `list-card-statements.ts` | cards `c` `:128` | `and c.household_id = ${householdId}::uuid` | ✓ |
| `list-card-statements.ts` | transactions `:141` | `and household_id = ${householdId}::uuid` | ✓ |
| `list-card-statements.ts` | **installments `:150` (WHERE novo)** | `where household_id = ${householdId}::uuid` (antes do `order by`) | ✓ |
| `list-card-statements.ts` | progress/transactions `:158` | `and household_id = ${householdId}::uuid` | ✓ |
| `month-summary.ts` | totals `:96` | `and household_id = ${householdId}::uuid` | ✓ |
| `month-summary.ts` | category `t` `:110` | `and t.household_id = ${householdId}::uuid` | ✓ |
| `month-summary.ts` | day `:123` | `and household_id = ${householdId}::uuid` | ✓ |
| `month-projection.ts` | installments `:107` | `and household_id = ${householdId}::uuid` | ✓ |
| `month-projection.ts` | recurrences `:123` | `and household_id = ${householdId}::uuid` | ✓ |
| `list-recurrences.ts` | recurrences `r` `:70` | `conditions[0] = sql\`r.household_id = ${householdId}::uuid\`` | ✓ |
| `list-variable-transactions.ts` | transactions `t` `:88` | `conditions[0] = sql\`t.household_id = ${householdId}::uuid\`` | ✓ |
| `list-variable-transactions.ts` | categories `:183` | **AC2** — `(household_id = ${householdId}::uuid or household_id is null)` | ✓ |
| `list-variable-transactions.ts` | accounts `:190` | `and household_id = ${householdId}::uuid` (estrito) | ✓ |
| `list-variable-transactions.ts` | cards `:196` | `and household_id = ${householdId}::uuid` (estrito) | ✓ |

`grep household_id` em `lib/finance/*.ts` → **16 query-lines** (+ comentários). Zero concatenação de string. **PASS.**

### b) AC2 — globais SÓ em categorias; accounts/cards estritos; LEFT JOIN não filtrado

`getVariableTxFilterOptions`: a query de categorias é a única com o ramo `household_id is null` (`:183`); accounts (`:190`) e cards (`:196`) são estritos `= householdId`. Confirmado também pelo teste discriminante (`list-variable-transactions.test.ts:157-159`): `categoriesSql` contém `household_id is null`, `accountsSql`/`cardsSql` **não**. Os `LEFT JOIN categories c` em `month-summary` (`:106`), `list-recurrences` (`:95`) e `list-variable` (`:122`) filtram a tabela principal (`t.`/`r.`), nunca o join. **PASS.**

### c) AC3 — `Promise.all` dentro do MESMO callback `withHousehold`

- `este-mes/page.tsx:102-109` — `withHousehold(..., (tx) => Promise.all([getMonthSummary({db: tx,...}), getMonthProjection({db: tx,...})]))`. Um único contexto RLS partilhado.
- `variaveis/page.tsx:87-92` — idêntico para `listVariableTransactions` + `getVariableTxFilterOptions`.
- As 3 pages single-helper (patrimonio/cartoes/recorrentes) seguem `withSpan` → `withHousehold` → helper. **PASS.**

### d) AC4 — 0 `getDb`/`getServiceDb` nas 5 pages

`grep getDb|getServiceDb` nas 5 `page.tsx` → **No matches**. Idem nos 6 helpers. `grep insertAuditLog` → **No matches** (pages read-only, premissa AC4 confirmada). Import trocado para `withHousehold` via `@/lib/agent/db-shim` em todas. Guards (`redirect('/entrar')` + UI de erro por-página com `FinanceViewTabs current`) inalterados (AC5). **PASS.**

### e) DEV-DECISION-1 — escopo do diag empírico vs AC7 unitário — RATIFICADA

O diag `packages/db-test/src/tests/sec4_financas_ssr_leak.test.ts` (5 testes, role `admin()`/bypassrls = role de runtime real) prova, em 5 query-shapes representativas (accounts, transactions/month, cards, recurrences, variable-tx), que a shape **sem** filtro vê rows de ambos os households (leak) e **com** `household_id = $A` isola. **Não** foi expandido para as 16 queries.

**Ratifico a decisão.** Justificação arquitectural: o diag empírico prova o *mecanismo* (RLS inerte no role de runtime → o filtro app-enforced é o que isola), não precisa de o repetir em 16 variações. A cobertura das 16 superfícies exactas é garantida ao nível unitário pelo bound-param assert (AC7) — que confirmei cobrir as 16 queries: cada um dos 6 testes de helper captura o `SQL` Drizzle via `boundParamValues` (`_sql-bound-params.ts`, mirror SEC-1 AC-K2) e assere `householdId` nos params bound; `list-card-statements` cobre as 4 (incl. installments), `month-summary` as 3, `getVariableTxFilterOptions` as 3 + discriminante AC2. AC9.3 autoriza explicitamente o [DEV-DECISION] desde que AC7 se mantenha — está. O risco residual (uma query omitir o filtro sem ser apanhada pelo diag) é coberto pelo assert unitário. **PASS.**

---

## Quality Gates Arquitecturais — 10 áreas

| # | Área | Verdict | Nota arquitectural |
|---|------|---------|-------------------|
| 1 | AC1 — 16 queries app-enforced (1.ª rede) | **PASS** | 16/16 com filtro `household_id` bound; mapa byte-a-byte confirmado; `installments` com WHERE novo presente. Zero concatenação. |
| 2 | AC2 — excepção das categorias globais | **PASS** | `OR household_id IS NULL` só em categorias de `getVariableTxFilterOptions`; accounts/cards estritos; LEFT JOIN categories nos outros helpers filtra a tabela principal. Espelha `/api/financas/categorias` (D-SEC1.1). |
| 3 | AC3 — `withHousehold` envolve fetch das 5 pages | **PASS** | `withSpan` outermost → `withHousehold` inner (ADR-003 §10.3). `Promise.all` no mesmo callback em este-mes/variaveis — contexto RLS partilhado. |
| 4 | AC4 — `getDb()` removido das 5 pages | **PASS** | grep zero `getDb`/`getServiceDb`/`insertAuditLog` nas pages. Pages read-only sem audit log — premissa correcta. |
| 5 | AC5 — import via db-shim; guards inalterados | **PASS** | `withHousehold` de `@/lib/agent/db-shim` (nunca directo — break tsc cross-package). Guards + UI de erro por-página com tab correcto intactos (não centralizado, §10.2). |
| 6 | AC6 — getServiceDb/jobs/helpers puros intactos | **PASS** | git status não mostra `card-statement-helpers.ts`/`finance-recurrence-helpers.ts` (intocados; testes puros 10/10 + 16/16 verdes). Zero migration nova. |
| 7 | AC7 — bound-param regressão nos 6 testes de helper | **PASS** | `boundParamValues` (mirror SEC-1 AC-K2) cobre as 16 queries unitariamente; PO-OBS-2 honrada (multi-query assert nos 3 helpers densos). |
| 8 | AC8 — mock `withHousehold` + assert householdId nas 5 pages | **PASS** | mock de `@/lib/agent/db-shim` expõe `withHousehold: (_auth, fn) => fn({execute})`; cada page assere helper chamado com `householdId: 'h1'`. |
| 9 | AC9 — confirmação empírica + gate de aplicação | **PASS** | diag `sec4_financas_ssr_leak` 5/5 (role bypassrls); `rls-application` 15/15 (2.ª rede); `cross_tenant_isolation` 4/4. DEV-DECISION-1 ratificada. |
| 10 | AC10 — gates de qualidade todos verdes | **PASS** | lint · typecheck · build · check:rls · web · db-test — re-executados por mim (ver tabela abaixo). Sem migration. |

---

## Gates re-executados independentemente (não confiados ao relato @dev)

| Gate | Comando | Resultado |
|------|---------|-----------|
| Lint | `pnpm lint` | **EXIT 0** — "No ESLint warnings or errors" (10/10 FULL TURBO) |
| Typecheck | `pnpm typecheck` | **EXIT 0** — 10/10 packages |
| Check RLS | `pnpm check:rls` | **EXIT 0** — todas as tabelas cobertas (incl. finance.ts: accounts, cards, categories, recurrences, installments, transactions) |
| Build | `pnpm build` | **EXIT 0** — 5 rotas `financas/*` compiladas (dynamic ƒ); middleware intacto (94,6 kB) |
| Web (finanças) | `pnpm --filter @meu-jarvis/web test -- src/lib/finance src/app/(app)/financas` | **111/111** (15 ficheiros): 6 helpers + 5 pages + 2 helpers puros (10/10, 16/16) |
| db-test | `pnpm --filter @meu-jarvis/db-test test` (Docker 29.1.3) | **186/186** (37 ficheiros): `sec4_financas_ssr_leak` 5/5 · `rls-application` 15/15 · `cross_tenant_isolation` 4/4 |

Ambiente: Docker UP, Postgres 16 efémero (Testcontainers, schema 0000+0001). O flaky pré-existente `tarefas/calendario/page.test.tsx` (timeout sob carga paralela, sem relação com SEC-4) não foi exercido por este gate (escopo restrito a finanças) — registo conforme já documentado em SEC-2/SEC-3/6.2.

---

## Riscos residuais

| Risco | Estado |
|-------|--------|
| Filtro app-enforced em falta numa das 16 queries | Mitigado — 16/16 verificadas + AC7 bound-param + diag empírico |
| Categorias globais filtradas estritamente por engano | Mitigado — AC2 explícito + teste discriminante dedicado |
| `withHousehold` quebra streaming RSC | Não-issue — fetch `await`-ado antes do JSX (ADR-003 §10.4) |
| Outras superfícies SSR de domínio (tarefas, household, visão) | **Fora de âmbito** — endereçar em SEC-5+ (visão já coberta por SEC-1 T9) |

---

## Acção pós-gate

1. Story → **Done v1.0-ARCH-APPROVED**; QA Results preenchidos; story movida `active/` → `completed/`.
2. Gate file (este) em `docs/qa/gates/SEC-4-architect-gate.md`.
3. Handoff `architect → devops` criado; HANDOFF-INDEX actualizado; handoff `dev → architect` consumido + arquivado.
4. **`@devops *push`** — fast-forward, sem `--force`/`--no-verify`, **sem** `db:migrate` (zero migration). Billing continua congelado.

— Aria, arquitectando o futuro
