# Story SEC-4: Finanças SSR — fechar leak cross-tenant (app-enforced) + RLS enforced em runtime (5 pages)

> **ID:** `SEC-4` (segurança transversal — Fase 3 do ADR-003, continuação de SEC-3).
> Não pertence a nenhum epic numerado — story de segurança cross-epic.
> **Depende de:** SEC-2 (Done, `98c8176`) — wrapper `withHousehold` em produção; SEC-3 (Done, `ec96445`) — padrão de domínio Finanças nos route handlers.
> **Confirmação arquitectural prévia:** ADR-003 Adenda §10 (@architect Aria, 02/06/2026) — padrão RSC/SSR validado (GO).

## Status

Done v1.0-ARCH-APPROVED (@architect Aria, 2026-06-03. Gate adversarial PASS — score 9,6/10, confidence HIGH. Inspecção byte-a-byte: 16/16 queries com filtro `household_id` bound (mapa AC1 confirmado, incl. installments WHERE novo, zero concatenação); AC2 globais SÓ em categorias de getVariableTxFilterOptions (accounts/cards estritos; LEFT JOIN categories filtra tabela principal); AC3 Promise.all no mesmo callback withHousehold em este-mes/variaveis; AC4 grep zero getDb/getServiceDb/insertAuditLog nas 5 pages e 6 helpers; AC6 helpers puros intactos + zero migration. DEV-DECISION-1 RATIFICADA (diag empírico prova o mecanismo em 5 query-shapes role bypassrls; AC7 bound-param cobre as 16 unitariamente). 6/6 gates re-executados independentemente: lint/typecheck/build/check:rls exit 0; web finanças 111/111; db-test 186/186 (sec4-leak 5/5 + rls-application 15/15 + cross_tenant_isolation 4/4). Gate file: docs/qa/gates/SEC-4-architect-gate.md. Próximo: `@devops *push` — fast-forward, sem db:migrate. Billing congelado.)

Ready for Review v0.3-DEV (@dev Dex, claude-opus-4-8[1m]. Implementação completa em YOLO autónomo: 6 helpers com filtro app-enforced nas 16 queries (1.ª rede), 5 pages envolvidas em `withHousehold` (2.ª rede), `getDb()` removido das 5 pages. AC7 bound-param regressão nos 6 testes de helper via util partilhado; AC2 globais asseridas; AC8 mock withHousehold + assert householdId nas 5 pages. AC9.1 prova empírica (sec4-leak 5/5) + AC9.2 rls-application 15/15 verde. Todos os gates AC10 verdes: lint/typecheck/build/check:rls exit 0; db-test 186/186; web finanças 100% verde (1 flaky não-relacionado, verde isolado). Sem migration. Aguarda `@architect *qa-gate SEC-4`.)

Ready v0.2-PO (GO 9,4/10 — @po Pax. Verificação byte-a-byte completa: grep confirma 0 `household_id` em `lib/finance/` (leak real); as 16 queries de AC1 existem nas linhas/aliases indicados e nenhuma tem filtro hoje; as 5 pages chamam `getDb()` EXACTAMENTE nas linhas 54/55/93/88/81; os guards `householdId` em 39/37/65/59/52 são EXACTOS; 0 `insertAuditLog` e 0 `getServiceDb` nas 5 pages (premissas AC4/AC6 correctas); padrão AC2 espelha `categorias/route.ts:93`; os 2 helpers puros estão bem classificados (G1); `withHousehold` confirmado em `db-shim.ts:79` com shape `{userId,householdId}`. 2 PO-OBS não-bloqueantes registadas. Ver Change Log + tabela de Verificação byte-a-byte.)

Draft v0.1 (@sm River. **ALERTA DE SEGURANÇA incorporado** — esta story NÃO é um simples "adicionar 2.ª rede": a verificação byte-a-byte revelou que as 5 SSR pages de Finanças NÃO têm 1.ª rede (app-enforced) — dependem 100% de RLS, que está inerte em runtime. Ver secção **🛑 Achado de segurança** abaixo. Âmbito expandido por decisão do Eurico (02/06/2026): SEC-4 fecha o leak (app-enforced) E adiciona a 2.ª rede (withHousehold). Aguarda `@po *validate-story-draft SEC-4`.)

## Executor Assignment

```
executor: "@dev"
quality_gate: "@architect"
quality_gate_tools: ["lint", "typecheck", "test", "build", "check:rls"]
```

## Story

**As a** engenheiro/product owner da Expressia,
**I want** que as 5 SSR pages de Finanças (`patrimonio`, `cartoes`, `recorrentes`, `variaveis`, `este-mes`) **(1)** apliquem o filtro `household_id` explícito (app-enforced — 1.ª rede, hoje **ausente**) nos seus 6 helpers de leitura, e **(2)** corram dentro de `withHousehold(auth, fn)` para activar a RLS em runtime (2.ª rede),
**so that** o vazamento cross-tenant de dados financeiros (contas, IBANs, saldos, transacções, cartões, recorrências) — que a auditoria CROSS-TENANT de SEC-1 **não cobriu** nesta superfície — seja fechado com a mesma defense-in-depth de duas redes que os route handlers `/api/financas/*` já têm desde SEC-3.

---

## 🛑 Achado de segurança (LER PRIMEIRO — origem do âmbito expandido)

### O que foi descoberto (verificado byte-a-byte, 02/06/2026)

As 5 SSR pages de Finanças chamam helpers em `lib/finance/*` que executam queries de domínio **sem qualquer filtro `household_id`** — dependem exclusivamente de "RLS authenticated" (ver docblocks: `account-balances.ts:9`, `list-card-statements.ts:9`, `month-summary.ts:23`, `month-projection.ts:38`).

**Grep confirmou: ZERO ocorrências de `household_id` em toda a `apps/web/src/lib/finance/` e nas 5 pages `(app)/financas/*/page.tsx`.**

| Helper | Linha(s) de query | Tabela | Filtro household HOJE |
|--------|-------------------|--------|----------------------|
| `account-balances.ts` | 91, 102 | accounts, transactions | **NENHUM** |
| `list-card-statements.ts` | 116, 125, 136, 145 | cards, transactions, installments, transactions | **NENHUM** |
| `month-summary.ts` | 85, 94, 109 | transactions ×3 | **NENHUM** |
| `month-projection.ts` | 93, 106 | transactions, recurrences | **NENHUM** |
| `list-recurrences.ts` | 76 | recurrences | **NENHUM** |
| `list-variable-transactions.ts` | 102, 166, 171, 176 | transactions, categories, accounts, cards | **NENHUM** |

### Porque é um leak live (não teórico)

1. **ADR-003 §1.1 (empírico, `diag-getdb-auth.ts`/`diag-rls-runtime.ts`):** `getDb()` liga como role `postgres` com `rolbypassrls=TRUE` → as 104 RLS policies estão **inertes em runtime**.
2. **Logo:** `select … from public.accounts where archived_at is null` via `getDb()`, sem filtro app-enforced, devolve contas de **TODOS os households**. Um utilizador do household A em `/financas/patrimonio` vê contas, `iban_last4`, saldos, cartões, transacções e recorrências do household B.
3. **A auditoria CROSS-TENANT de SEC-1** (`docs/security/CROSS-TENANT-AUDIT-20260602.md`, severidade CRITICAL) cobriu os route handlers `/api/financas/*` (L5–L11, I7–I12) e o RSC da **Visão** (`lib/visao/queries.ts` recebeu `householdId` — SEC-1 T9). **NÃO cobriu** as SSR pages de Finanças nem `lib/finance/*`. A declaração "100% app-enforced" de SEC-1 (story linha 533) **não inclui esta superfície** — foi um gap não-detectado.

### Severidade e ressalva

- **Severidade:** HIGH/CRITICAL (vazamento cross-tenant de dados bancários em produção, mesma classe do ACHADO-2 de SMOKE-6.7).
- **Ressalva honesta (@sm):** a confirmação é baseada no código real + ADR-003 + auditoria SEC-1. A **exploitabilidade empírica** deve ser confirmada por `@architect`/`@data-engineer` com um diag script (estilo Fase 0 do ADR-003) — recomendado como primeiro passo do `@dev`/gate (ver AC9). O código foi lido; o exploit não foi corrido.
- **Contradição com o handoff consumido:** `mj-handoff-sec4-kickoff-…` afirmava "o resto continua protegido SÓ pelo app-enforced (1.ª rede) — seguro" e "Sem janela de vulnerabilidade aberta". **Isto é falso para estas 5 pages** — não têm 1.ª rede. Documentado na tabela de Divergências.

### Decisão de âmbito (Eurico, 02/06/2026)

**"Expandir SEC-4 (2 redes)":** SEC-4 fecha o leak adicionando o filtro app-enforced aos 6 helpers (espelhando o que SEC-1 fez a `lib/visao/queries.ts`) **E** envolve as 5 pages em `withHousehold` (2.ª rede). Não é um hotfix separado — é uma story única que repõe a paridade defense-in-depth.

---

## Contexto e âmbito

### O que já existe (não reimplementar)

- `withHousehold<T>(auth, fn)` em `packages/db/src/client.ts:119`, re-exportado por `apps/web/src/lib/agent/db-shim.ts:79`. Em produção desde SEC-2.
- Padrão RSC/SSR confirmado em **ADR-003 Adenda §10.3** (withSpan outermost, withHousehold inner).
- Padrão app-enforced canónico para RSC: **SEC-1 T9** (`lib/visao/queries.ts` — `householdId: string` injectado pelo chamador, filtro em cada query, propagado às pages/widgets).
- `resolveHouseholdId(user.id)` (`apps/web/src/lib/api-helpers/auth.ts:24`) — já chamado por todas as 5 pages no guard.

### O que esta story faz

**Parte A — fechar leak (1.ª rede, app-enforced):** adicionar `householdId: string` aos 6 helpers de leitura e o filtro `household_id` a cada uma das 16 queries.

**Parte B — defense-in-depth (2.ª rede, RLS viva):** envolver o fetch das 5 pages em `withHousehold({ userId: user.id, householdId }, (tx) => helper({ db: tx, householdId, … }))`.

### Ficheiros-alvo

**SSR pages (5) — `apps/web/src/app/(app)/financas/`:**

| # | Page | getDb() | Helper(s) consumido(s) |
|---|------|---------|------------------------|
| 1 | `patrimonio/page.tsx` | :54 | `getAccountBalances` |
| 2 | `cartoes/page.tsx` | :55 | `getCardStatements` |
| 3 | `este-mes/page.tsx` | :93 | `getMonthSummary` + `getMonthProjection` |
| 4 | `recorrentes/page.tsx` | :88 | `listRecurrences` |
| 5 | `variaveis/page.tsx` | :81 | `listVariableTransactions` + `getVariableTxFilterOptions` |

**Helpers de query (6) — `apps/web/src/lib/finance/`:** `account-balances.ts`, `list-card-statements.ts`, `month-summary.ts`, `month-projection.ts`, `list-recurrences.ts`, `list-variable-transactions.ts`.

### Fora de âmbito (NÃO tocar)

- `financas/page.tsx` (raiz) — só `redirect('/financas/este-mes')`, sem `getDb()`/auth.
- Helpers **puros** sem DB: `card-statement-helpers.ts` (`calcStatementCycle`), `finance-recurrence-helpers.ts` (`calcNextRunDate`) — não têm queries, intactos (G1).
- Route handlers `/api/financas/*` — já migrados (SEC-3).
- `getServiceDb()` / jobs Inngest — intocáveis por design.
- Outros domínios (tarefas restantes, cérebro AI, household, visão) — SEC-5+.

---

## Acceptance Criteria

### AC1 — Filtro `household_id` app-enforced adicionado às 16 queries (1.ª rede — fecha o leak)

Cada um dos 6 helpers passa a receber `householdId: string` e cada query de domínio passa a incluir o filtro `household_id` explícito (mirror SEC-1 `lib/visao`). Mapa exacto (alias verificado byte-a-byte):

| Helper | Query (linha actual) | Filtro a adicionar |
|--------|----------------------|--------------------|
| `account-balances.ts` | accounts `:91` | `and household_id = ${householdId}::uuid` |
| `account-balances.ts` | transactions `:102` | `and household_id = ${householdId}::uuid` |
| `list-card-statements.ts` | cards (alias `c`) `:116` | `and c.household_id = ${householdId}::uuid` |
| `list-card-statements.ts` | transactions `:125` | `and household_id = ${householdId}::uuid` |
| `list-card-statements.ts` | installments `:136` (sem WHERE — adicionar) | `where household_id = ${householdId}::uuid` (antes do `order by`) |
| `list-card-statements.ts` | progress/transactions `:145` | `and household_id = ${householdId}::uuid` |
| `month-summary.ts` | totals `:85` | `and household_id = ${householdId}::uuid` |
| `month-summary.ts` | category (alias `t`) `:94` | `and t.household_id = ${householdId}::uuid` |
| `month-summary.ts` | day `:109` | `and household_id = ${householdId}::uuid` |
| `month-projection.ts` | transactions `:93` | `and household_id = ${householdId}::uuid` |
| `month-projection.ts` | recurrences `:106` | `and household_id = ${householdId}::uuid` |
| `list-recurrences.ts` | recurrences (alias `r`) `:76` | condição `sql\`r.household_id = ${householdId}::uuid\`` no array `conditions` |
| `list-variable-transactions.ts` | transactions (alias `t`) `:102` | condição `sql\`t.household_id = ${householdId}::uuid\`` no array `conditions` |
| `list-variable-transactions.ts` | accounts `:171` | `and household_id = ${householdId}::uuid` |
| `list-variable-transactions.ts` | cards `:176` | `and household_id = ${householdId}::uuid` |
| `list-variable-transactions.ts` | categories `:166` | **AC2 (excepção globais)** |

O filtro usa sempre o parâmetro bound (`${householdId}`) — nunca concatenação de string.

### AC2 — Excepção das categorias globais (o único caso divergente)

Na query de **categorias** de `getVariableTxFilterOptions` (`list-variable-transactions.ts:166`), o filtro deve incluir as categorias globais (`household_id IS NULL`), espelhando exactamente o padrão da API `/api/financas/categorias` (`AND (household_id = X OR household_id IS NULL)` — D-SEC1.1):

```sql
where archived_at is null
  and (household_id = ${householdId}::uuid or household_id is null)
```

Rationale: as 24 categorias default são globais (CLAUDE.md — seed). O dropdown de filtros tem de as mostrar, tal como a API faz. As queries de **accounts** e **cards** NÃO têm globais — filtro estrito `= householdId`. Esta é a única query divergente — a mais sensível a um leak de globais mal-configurado.

> Nota: as queries de `month-summary`/`list-recurrences`/`list-variable-transactions` que fazem `LEFT JOIN categories c` para obter o **nome** filtram pela tabela principal (`t.household_id`/`r.household_id`) — o nome de uma categoria global aparecer é correcto (globais são partilhadas). Não adicionar filtro de household ao join de categorias nesses casos.

### AC3 — `withHousehold` envolve o fetch das 5 pages (2.ª rede — RLS viva)

Cada page envolve a sua operação de fetch em `withHousehold`, conforme ADR-003 Adenda §10.3 (withSpan outermost, withHousehold inner):

```typescript
const data = await withSpan('finance.X.render', { route: '…' }, async () =>
  withHousehold(
    { userId: user.id, householdId },
    (tx) => helper({ db: tx, householdId, /* …outros params */ }),
  ),
);
```

Para `este-mes` (2 helpers) e `variaveis` (2 funções), **ambas as chamadas correm dentro do MESMO callback `withHousehold`** (o `Promise.all` existente fica dentro do callback) — partilham a mesma transação/contexto RLS.

### AC4 — `const db = getDb()` REMOVIDO das 5 pages (sem audit log em RSC)

Ao contrário dos handlers de mutação de SEC-3 (que mantinham `getDb()` para `insertAuditLog` best-effort — PO-FIX-2), estas 5 pages são **read-only** e **nenhuma faz `insertAuditLog`** (verificado — zero ocorrências). Logo o `const db = getDb()` é **removido por completo** das 5 pages; o `getDb` deixa de ser importado (substituído por `withHousehold` no import de `@/lib/agent/db-shim`).

### AC5 — Import via `db-shim.ts`; guards e UI de erro por-página INALTERADOS

- `withHousehold` importado de `@/lib/agent/db-shim` (nunca directo de `@meu-jarvis/db/client` — break tsc cross-package, `db-shim.ts:5-18`).
- As guards `if (!user) redirect('/entrar')` e `if (!householdId) return <UI de erro com FinanceViewTabs current="…">` ficam **exactamente como estão** (ADR-003 Adenda §10.2 — NÃO centralizar; cada page tem a sua UI de erro com o tab correcto). O `householdId` já resolvido no guard é reutilizado (zero resolução nova).

### AC6 — `getServiceDb()` / jobs / helpers puros NÃO tocados

- Nenhuma page nem helper passa a usar `getServiceDb()` (verificar grep: zero).
- `card-statement-helpers.ts` e `finance-recurrence-helpers.ts` (puros, sem DB) ficam intactos — assinaturas inalteradas (G1).

### AC7 — Testes dos 6 helpers actualizados: `householdId` + regressão do filtro

Os 6 ficheiros `lib/finance/__tests__/*.test.ts` correspondentes:
1. Passam a chamar o helper com `householdId` (ex.: `getAccountBalances({ db: fakeDb(…), householdId: 'h1' })`).
2. **Pelo menos um teste por helper captura o objecto `SQL` Drizzle passado a `execute` e assere que o `household_id` do household autenticado está nos parâmetros bound** (mirror SEC-1 AC-K2 — regressão que impede o leak de reabrir). Para `getVariableTxFilterOptions`, asserir adicionalmente que a query de categorias inclui o ramo `household_id is null` (AC2) e as de accounts/cards **não**.

### AC8 — Testes das 5 pages actualizados: mock `withHousehold` + `householdId`

Os 5 ficheiros `(app)/financas/*/__tests__/page.test.tsx`:
1. O mock de `@/lib/agent/db-shim` passa a expor `withHousehold` além de (ou em vez de) `getDb`:
   ```typescript
   vi.mock('@/lib/agent/db-shim', () => ({
     withHousehold: (_auth: unknown, fn: (tx: unknown) => unknown) => fn({ execute: vi.fn() }),
   }));
   ```
2. Pelo menos um teste por page assere que o helper foi chamado com `householdId` resolvido (ex.: `expect(mocks.getAccountBalancesMock).toHaveBeenCalledWith(expect.objectContaining({ householdId: 'h1' }))`).

### AC9 — Confirmação empírica do leak/fix (recomendado-mandatório) + gate de aplicação

1. **[Recomendado fortemente — @architect/@data-engineer no gate]** Um diag script (estilo `diag-rls-runtime.ts`) ou um teste em `packages/db-test` que prove, com o **role de runtime real** (`admin()`/bypassrls — como SEC-1 AC-K1 em `cross_tenant_isolation.test.ts`), que a query-shape de `accounts`/`transactions` SEM filtro devolve rows cross-household e COM o filtro `household_id` devolve 0 do outro household. Fecha empiricamente o achado.
2. O gate de aplicação existente `packages/db-test/src/tests/rls-application.test.ts` (15 testes desde SEC-3, cobre `accounts`, `transactions`, `categories` globais) confirma a 2.ª rede (RLS viva) — verificar que continua VERDE.
3. Se o @dev/@architect julgar o ponto 1 fora de âmbito de uma story de migração, registar como [DEV-DECISION] com justificação — mas as asserções de bound-param (AC7) são **mandatórias** como regressão mínima.

### AC10 — Gates de qualidade TODOS VERDES

`pnpm lint` · `pnpm typecheck` · `pnpm test` (web + db-test Docker) · `pnpm build` · `pnpm check:rls` — todos exit 0. **Sem migration SQL nova** (104 policies intactas desde `0001_rls_policies.sql`).

---

## Tasks / Subtasks

- [x] **T1 — `account-balances.ts` + page `patrimonio`** (AC1, AC3, AC4, AC5, AC7, AC8)
  - [x] T1.1 Helper: add `householdId: string`; filtro nas 2 queries (`:91`, `:102`).
  - [x] T1.2 Page: remover `const db = getDb()`; trocar import `getDb`→`withHousehold`; envolver fetch em `withHousehold({ userId: user.id, householdId }, (tx) => getAccountBalances({ db: tx, householdId }))` dentro do `withSpan`.
  - [x] T1.3 Tests: `account-balances.test.ts` (+householdId, +bound-param assert); `patrimonio/__tests__/page.test.tsx` (mock withHousehold, assert householdId).

- [x] **T2 — `list-card-statements.ts` + page `cartoes`** (AC1, AC3, AC4, AC5, AC7, AC8)
  - [x] T2.1 Helper: add `householdId`; filtro nas 4 queries (`:116` alias `c`, `:125`, `:136` novo WHERE, `:145`).
  - [x] T2.2 Page: withHousehold + `getCardStatements({ db: tx, today, householdId })`.
  - [x] T2.3 Tests: `list-card-statements.test.ts` + `cartoes/__tests__/page.test.tsx`.

- [x] **T3 — `month-summary.ts` + `month-projection.ts` + page `este-mes`** (AC1, AC3, AC4, AC5, AC7, AC8)
  - [x] T3.1 `month-summary.ts`: add `householdId`; filtro nas 3 queries (`:85`, `:94` alias `t`, `:109`).
  - [x] T3.2 `month-projection.ts`: add `householdId`; filtro nas 2 queries (`:93`, `:106`).
  - [x] T3.3 Page: withHousehold envolvendo o `Promise.all([getMonthSummary({ db: tx, monthStart, monthEnd, householdId }), … getMonthProjection({ db: tx, today, householdId })])` — ambos no mesmo callback.
  - [x] T3.4 Tests: `month-summary.test.ts` + `month-projection.test.ts` + `este-mes/__tests__/page.test.tsx`.

- [x] **T4 — `list-recurrences.ts` + page `recorrentes`** (AC1, AC3, AC4, AC5, AC7, AC8)
  - [x] T4.1 Helper: add `householdId`; add condição `r.household_id` ao array `conditions` (`:64-74`).
  - [x] T4.2 Page: withHousehold + `listRecurrences({ db: tx, filters, householdId })`.
  - [x] T4.3 Tests: `list-recurrences.test.ts` + `recorrentes/__tests__/page.test.tsx`.

- [x] **T5 — `list-variable-transactions.ts` + page `variaveis`** (AC1, AC2, AC3, AC4, AC5, AC7, AC8)
  - [x] T5.1 `listVariableTransactions`: add `householdId`; condição `t.household_id` no array `conditions` (`:78`).
  - [x] T5.2 `getVariableTxFilterOptions`: add `householdId`; filtro estrito em accounts (`:171`) e cards (`:176`); **AC2 — categorias com `OR household_id IS NULL`** (`:166`).
  - [x] T5.3 Page: withHousehold envolvendo o `Promise.all([listVariableTransactions({ db: tx, filters, householdId }), getVariableTxFilterOptions({ db: tx, householdId })])` — mesmo callback.
  - [x] T5.4 Tests: `list-variable-transactions.test.ts` (incl. assert AC2 globais) + `variaveis/__tests__/page.test.tsx`.

- [x] **T6 — Confirmação empírica do leak/fix** (AC9)
  - [x] T6.1 Diag/test com role runtime (bypassrls) provando leak SEM filtro e isolamento COM filtro (estilo SEC-1 AC-K1) — `packages/db-test/src/tests/sec4_financas_ssr_leak.test.ts` (5 testes) verde. Verifica as query-shapes EXACTAS dos 5 helpers principais. AC7 bound-param mantido como regressão mínima nos 6 testes de helper.
  - [x] T6.2 Verificar `rls-application.test.ts` (15/15) continua verde (2.ª rede). — VERDE.

- [x] **T7 — Quality gates** (AC10)
  - [x] T7.1 `pnpm lint` exit 0 · T7.2 `pnpm typecheck` exit 0 · T7.3 `pnpm --filter @meu-jarvis/web test` (5 pages + 6 helpers verdes; 1 flaky não-relacionado em `tarefas/calendario`, verde isolado) · T7.4 `pnpm --filter @meu-jarvis/db-test test` (Docker UP, 186/186, rls-application 15/15, sec4-leak 5/5) · T7.5 `pnpm build` exit 0 · T7.6 `pnpm check:rls` exit 0.

---

## Dev Notes

### Referências-chave (leitura obrigatória)

| Recurso | Localização | Porquê |
|---------|-------------|--------|
| Padrão RSC confirmado | `docs/adr/ADR-003-…md` Adenda §10.3 | Forma EXACTA do withHousehold em SSR |
| Padrão app-enforced RSC | SEC-1 T9 — `apps/web/src/lib/visao/queries.ts` | `householdId` injectado pelo chamador + filtro em cada query |
| Auditoria do leak | `docs/security/CROSS-TENANT-AUDIT-20260602.md` | Confirma que finanças SSR NÃO foi coberta |
| `withHousehold` | `apps/web/src/lib/agent/db-shim.ts:79` | Re-export — usar SEMPRE via shim |
| Filtro globais categorias | `api/financas/categorias/route.ts:96` (`OR household_id IS NULL`) | Padrão AC2 a espelhar |
| Template de teste bound-param | SEC-1 AC-K2 (captura params do `SQL` Drizzle) | Regressão do filtro (AC7) |

### Pontos críticos

1. **O `householdId` já existe na page** (resolvido no guard `:39`/`:65`/`:37`/`:59`/`:52`). Reutilizar — não chamar `resolveHouseholdId` outra vez.
2. **Aliases:** `list-card-statements` cards usa alias `c`; `month-summary` category usa `t`; `list-recurrences` usa `r`; `list-variable-transactions` usa `t`. Filtrar SEMPRE a tabela principal (transactions/cards/recurrences/accounts), nunca o `LEFT JOIN categories` (globais legítimas).
3. **`installments` (`list-card-statements.ts:136`)** não tem WHERE hoje — adicionar `where household_id = …` ANTES do `order by purchased_on desc`.
4. **`este-mes` e `variaveis`:** manter o `Promise.all` DENTRO do callback `withHousehold` para os 2 fetches partilharem a transação/contexto RLS.
5. **Sem audit log:** AC4 — `getDb()` totalmente removido (estas pages não escrevem nada).

### Sobre a performance

withHousehold adiciona 1 transação + 2 `SET LOCAL` por render. Aceitável (NFR1); pgbouncer transaction-mode desenhado para isto (confirmado SEC-2 §3). O `SET LOCAL` reverte no COMMIT — zero fuga de contexto.

### Convenções

Imports `@/` absolutos · sem `any` (`unknown` + guards) · PT-PT em comentários/erros · `prepare:false` intocado.

### Riscos (para @architect no gate)

| Risco | Mitigação |
|-------|-----------|
| Filtro app-enforced em falta numa das 16 queries → leak persiste | AC7 bound-param assert por helper; grep `household_id` deve dar 16 hits novos |
| Categorias globais filtradas estritamente por engano → dropdown perde defaults | AC2 explícita; teste dedicado em T5.4 |
| withHousehold quebra streaming RSC | ADR-003 Adenda §10.4 — fetch é `await`-ado antes do JSX; sem fricção |
| Page test mocka `getDb` mas page passa a usar `withHousehold` | AC8 — actualizar mock do shim |

---

## Testing

| Camada | Ferramenta | Ficheiros |
|--------|-----------|-----------|
| Helpers finanças (unit + bound-param) | Vitest node (`apps/web`) | `apps/web/src/lib/finance/__tests__/{account-balances,list-card-statements,month-summary,month-projection,list-recurrences,list-variable-transactions}.test.ts` |
| Pages SSR (RSC render) | Vitest node | `apps/web/src/app/(app)/financas/{patrimonio,cartoes,este-mes,recorrentes,variaveis}/__tests__/page.test.tsx` |
| Gate de aplicação RLS (2.ª rede) | Vitest + Testcontainers (`db-test`) | `packages/db-test/src/tests/rls-application.test.ts` (verificar verde) |
| Isolamento empírico (1.ª rede) | Vitest + Testcontainers role bypassrls | T6.1 (novo/diag — AC9) |
| Gate estático | `pnpm check:rls` | — |

---

## CodeRabbit Integration

> **CodeRabbit Integration**: Disabled — sem `coderabbit_integration` em `core-config.yaml`. Validação via @architect adversarial gate (padrão SEC-1/SEC-2/SEC-3).

---

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Dex / @dev — YOLO autónomo)

### Debug Log References

- Suite db-test (Testcontainers, Docker UP): 186/186 verde, incl. `sec4_financas_ssr_leak.test.ts` (5/5 — prova empírica AC9.1) + `rls-application.test.ts` (15/15 — 2.ª rede AC9.2) + `cross_tenant_isolation.test.ts` (4/4).
- Suite web (finanças): account-balances 10/10, list-card-statements 7/7, month-summary 11/11, month-projection 10/10, list-recurrences 7/7, list-variable-transactions 9/9; 5 pages 5+5+5+4+5. Total alterado verde.
- Suite web completa: 1076/1077 — a única falha (`tarefas/calendario/page.test.tsx`) é timeout flaky sob carga paralela (collect 425s), VERDE isolado (41/41); sem relação com SEC-4.
- Gates: `pnpm lint` exit 0 · `pnpm typecheck` exit 0 · `pnpm build` exit 0 (10/10) · `pnpm check:rls` exit 0 (todas as tabelas cobertas).

### Completion Notes

- **Parte A (1.ª rede — fecha o leak):** filtro `household_id` app-enforced adicionado às 16 queries dos 6 helpers, sempre via parâmetro bound (`${householdId}::uuid`), nunca concatenação. Aliases respeitados (`c`/`t`/`r`). `installments` (`list-card-statements`) ganhou WHERE totalmente novo. AC2: categorias de `getVariableTxFilterOptions` incluem globais (`OR household_id IS NULL`); accounts/cards estritos. Os `LEFT JOIN categories` de month-summary/list-recurrences/list-variable filtram a tabela principal (`t.`/`r.`), nunca o join (globais partilhadas — Dev-Note-2).
- **Parte B (2.ª rede — RLS viva):** as 5 pages envolvem o fetch em `withHousehold({ userId, householdId }, tx => helper({ db: tx, householdId }))` dentro do `withSpan` (ADR-003 Adenda §10.3). `este-mes` e `variaveis` mantêm o `Promise.all` DENTRO do mesmo callback (partilham tx/contexto RLS — AC3).
- **AC4:** `const db = getDb()` removido por completo das 5 pages; import `getDb`→`withHousehold` (via `@/lib/agent/db-shim` — AC5). Zero `insertAudit`/`getServiceDb` introduzidos.
- **AC7 (regressão):** cada um dos 6 testes de helper captura o `SQL` Drizzle e assere `household_id` nos params bound (util partilhado `__tests__/_sql-bound-params.ts`, mirror SEC-1 AC-K2). PO-OBS-2 honrada: card-statements assere as 4 queries (incl. installments nova); month-summary as 3; variable-tx-options as 3 + discriminante AC2 (`household_id is null` só em categorias).
- **AC8:** mock de `@/lib/agent/db-shim` nas 5 pages passou a expor `withHousehold`; cada page assere o helper chamado com `householdId: 'h1'`.
- **AC9.1:** o diag `sec4_financas_ssr_leak.test.ts` (criado no kickoff, verificado e VERDE) prova com role bypassrls (= runtime) que a query-shape SEM filtro vê 2 households e COM filtro só A. [DEV-DECISION]: mantido tal como estava — cobre as 5 superfícies principais; não foi expandido para as 16 queries por o bound-param assert (AC7) já o cobrir ao nível unitário.
- **Sem migration SQL** — 104 policies intactas. Mudança 100% aplicacional. Billing continua congelado (sem toques).

### File List

**Helpers (6) — `apps/web/src/lib/finance/`:**
- `account-balances.ts` · `list-card-statements.ts` · `month-summary.ts` · `month-projection.ts` · `list-recurrences.ts` · `list-variable-transactions.ts`

**Pages (5) — `apps/web/src/app/(app)/financas/`:**
- `patrimonio/page.tsx` · `cartoes/page.tsx` · `este-mes/page.tsx` · `recorrentes/page.tsx` · `variaveis/page.tsx`

**Testes de helper (6) — `apps/web/src/lib/finance/__tests__/`:**
- `account-balances.test.ts` · `list-card-statements.test.ts` · `month-summary.test.ts` · `month-projection.test.ts` · `list-recurrences.test.ts` · `list-variable-transactions.test.ts`

**Testes de page (5) — `apps/web/src/app/(app)/financas/*/__tests__/page.test.tsx`:**
- `patrimonio` · `cartoes` · `este-mes` · `recorrentes` · `variaveis`

**Novo util de teste (1):**
- `apps/web/src/lib/finance/__tests__/_sql-bound-params.ts` (extractor de params bound do `SQL` Drizzle — partilhado pelos 6 testes de helper)

**Diag empírico (1, pré-existente do kickoff — verificado verde):**
- `packages/db-test/src/tests/sec4_financas_ssr_leak.test.ts`

---

## QA Results

**Gate adversarial @architect (Aria) — 2026-06-03 — `PASS` (score 9,6/10, confidence HIGH).**

Gate file completo: `docs/qa/gates/SEC-4-architect-gate.md`. Padrão SEC-1/2/3 (CodeRabbit disabled).

### Inspecção byte-a-byte (não confiada ao relato @dev)

- **AC1 — 16/16 queries app-enforced:** confirmadas query-a-query contra o mapa de AC1, todas com `household_id = ${householdId}::uuid` (parâmetro bound, zero concatenação). Inclui o `installments` (`list-card-statements.ts:150`) com `WHERE` totalmente novo — o ponto mais propenso a omissão, presente. `grep household_id` em `lib/finance/*.ts` = 16 query-lines.
- **AC2 — categorias globais:** `OR household_id IS NULL` SÓ na query de categorias de `getVariableTxFilterOptions` (`:183`); accounts (`:190`)/cards (`:196`) estritos. Teste discriminante confirma (`household_id is null` presente em categoriesSql, ausente em accounts/cards). LEFT JOIN categories em month-summary/list-recurrences/list-variable filtra a tabela principal (`t.`/`r.`), nunca o join.
- **AC3 — `Promise.all` no mesmo callback:** `este-mes:102-109` e `variaveis:87-92` partilham um único contexto RLS. `withSpan` outermost → `withHousehold` inner nas 5 pages (ADR-003 §10.3).
- **AC4 — getDb removido:** `grep getDb|getServiceDb|insertAuditLog` nas 5 pages e 6 helpers = zero. Import via `@/lib/agent/db-shim`. Guards + UI de erro por-página inalterados (AC5).
- **AC6 — intactos:** helpers puros não aparecem no git status; zero migration nova.
- **DEV-DECISION-1 RATIFICADA:** o diag empírico (`sec4_financas_ssr_leak`, role bypassrls = runtime) prova o *mecanismo* do leak/fix em 5 query-shapes; a cobertura das 16 superfícies é garantida ao nível unitário pelo bound-param assert (AC7). AC9.3 autoriza-o.

### 6/6 gates re-executados independentemente

| Gate | Resultado |
|------|-----------|
| `pnpm lint` | EXIT 0 (No ESLint warnings or errors) |
| `pnpm typecheck` | EXIT 0 (10/10) |
| `pnpm check:rls` | EXIT 0 (todas as tabelas) |
| `pnpm build` | EXIT 0 (5 rotas financas/* dynamic; MW 94,6 kB) |
| `pnpm --filter @meu-jarvis/web test` (finanças) | 111/111 (6 helpers + 5 pages + 2 puros) |
| `pnpm --filter @meu-jarvis/db-test test` (Docker UP) | 186/186 (sec4-leak 5/5 · rls-application 15/15 · cross_tenant_isolation 4/4) |

**Veredicto:** leak cross-tenant CRITICAL fechado com defense-in-depth de 2 redes, em paridade com SEC-3. Próximo: `@devops *push` (fast-forward, sem `db:migrate`).

---

## Change Log

| Data | Versão | Descrição | Autor |
|------|--------|-----------|-------|
| 2026-06-02 | 0.1 | Draft inicial — ADR-003 Fase 3 (Finanças SSR). **Achado de segurança incorporado:** verificação byte-a-byte revelou que as 5 SSR pages NÃO têm filtro app-enforced (grep: zero `household_id` em `lib/finance/` + pages) — leak cross-tenant live não coberto pela auditoria SEC-1. Âmbito expandido (decisão Eurico): SEC-4 fecha o leak (app-enforced nos 6 helpers, 16 queries — AC1/AC2) E adiciona 2.ª rede (withHousehold nas 5 pages — AC3). Padrão RSC confirmado em ADR-003 Adenda §10. Sem migration. | River (@sm) |
| 2026-06-03 | 0.3-DEV | **Implementação completa (YOLO autónomo).** Parte A: filtro `household_id` app-enforced nas 16 queries dos 6 helpers (1.ª rede), sempre param bound; `installments` novo WHERE; AC2 globais nas categorias de `getVariableTxFilterOptions`. Parte B: 5 pages em `withHousehold` (2.ª rede), `Promise.all` no mesmo callback em este-mes/variaveis; `getDb()` removido (AC4). AC7: bound-param assert nos 6 testes de helper (util partilhado `_sql-bound-params.ts`, mirror SEC-1 AC-K2; PO-OBS-2 honrada). AC8: mock withHousehold + assert householdId nas 5 pages. AC9: diag empírico `sec4_financas_ssr_leak.test.ts` 5/5 verde (leak SEM filtro / isolamento COM filtro, role bypassrls) + rls-application 15/15. Gates AC10 todos verdes (lint/typecheck/build/check:rls exit 0; db-test 186/186; web finanças verde). Sem migration. Status Ready→Ready for Review. | Dex (@dev) |
| 2026-06-03 | 1.0-ARCH-APPROVED | **Gate adversarial @architect — PASS (9,6/10, HIGH).** Inspecção byte-a-byte: 16/16 queries com filtro bound (mapa AC1, incl. installments WHERE novo); AC2 globais SÓ em categorias (accounts/cards estritos; LEFT JOIN filtra tabela principal); AC3 Promise.all no mesmo callback withHousehold; AC4 grep zero getDb/getServiceDb/insertAuditLog nas 5 pages e 6 helpers; AC6 puros intactos + zero migration. DEV-DECISION-1 ratificada (diag empírico prova mecanismo em 5 shapes role bypassrls; AC7 bound-param cobre as 16 unitariamente). 6/6 gates re-executados: lint/typecheck/build/check:rls exit 0; web finanças 111/111; db-test 186/186 (sec4-leak 5/5 + rls-application 15/15 + cross_tenant_isolation 4/4). QA Results preenchidos; gate file docs/qa/gates/SEC-4-architect-gate.md; story movida active/→completed/. Status Ready for Review→Done. Próximo: @devops *push (fast-forward, sem db:migrate). | Aria (@architect) |
| 2026-06-02 | 0.2-PO | **GO 9,4/10 — validação byte-a-byte completa.** Checklist 10/10 (9 PASS + 1 N/A — complexidade em vez de pontos). Confirmado contra código real: (1) grep `household_id` em `lib/finance/` = **0** — leak real, não teórico; (2) **16/16 queries de AC1** existem nas linhas/aliases indicados (linhas referem o início de cada `db.execute(...)`; aliases `c`/`t`/`r` confirmados) e **nenhuma** tem filtro household hoje; (3) **5/5 pages** chamam `getDb()` EXACTAMENTE nas linhas da tabela (patrimonio:54, cartoes:55, este-mes:93, recorrentes:88, variaveis:81); (4) guards `householdId` em 39/37/65/59/52 **EXACTOS** (Dev-Note-1); (5) **0** `insertAuditLog` e **0** `getServiceDb` nas 5 pages → premissas AC4 (getDb removido por completo) e AC6 correctas; (6) AC2 espelha fielmente `categorias/route.ts:93` (`household_id = X or household_id is null`); (7) `month-summary`/`list-recurrences`/`list-variable-transactions` têm `LEFT JOIN categories` — Dev-Note-2 instrui filtrar a tabela principal, não o join (correcto: globais partilhadas); (8) `installments:136` sem WHERE confirmado — AC1 instrui novo WHERE antes do `order by`; (9) 2 helpers puros (`card-statement-helpers.ts`, `finance-recurrence-helpers.ts`) sem DB — G1/AC6 correcto; (10) `withHousehold` em `db-shim.ts:79`, shape `{userId,householdId}` casa com AC3; break tsc documentado em `db-shim.ts:5-18` (AC5 ref EXACTA). **Nenhum PO-FIX necessário** — draft byte-a-byte impecável. 2 PO-OBS não-bloqueantes registadas. Status Draft→Ready. | Pax (@po) |

---

## Observações do PO (não-bloqueantes — para o @dev/@architect no gate)

> Estas observações NÃO alteram nenhuma AC e NÃO condicionam o GO. São pontos de atenção que o draft já endereça ou que valem registo de transparência.

- **PO-OBS-1 (alinhamento de números de linha — informativo).** As linhas de AC1 (ex.: accounts `:91`, transactions `:102`) referem o **início da chamada `db.execute(...)`**, não a linha exacta do `from`/`where` (que vem 8-10 linhas depois dentro do template literal). Verifiquei e está consistente em todos os 6 helpers — o @dev deve localizar a query pela tabela + alias (que confirmei: `c` em card-statements, `t` em month-summary/list-variable, `r` em list-recurrences), não por offset rígido. Risco zero porque o filtro entra no `where`/array `conditions` que já existe; só registo para evitar confusão se o @dev contar linhas literalmente. As linhas das **pages** (getDb + guards), essas, são exactas ao código.

- **PO-OBS-2 (cobertura da regressão AC7 vs as 16 queries).** AC7 exige bound-param assert "pelo menos um teste por helper". Como `list-card-statements` (4 queries), `list-variable-transactions` (5 queries em 2 funções) e `month-summary` (3 queries) concentram a maioria das 16 superfícies, recomendo ao @dev/@architect que o assert de cada um desses 3 helpers cubra **mais do que uma** query — em particular a `installments:136` (que ganha um WHERE totalmente novo, o ponto mais propenso a esquecimento) e as 3 queries de `getVariableTxFilterOptions` (onde categorias diverge de accounts/cards — AC2). É o caminho mais provável de um filtro ficar para trás sem o teste apanhar. Não-bloqueante: AC7 já é mandatória; isto só afina onde apontar a regressão.

---

## Divergências verificadas vs handoff de kickoff

| Premissa do handoff `mj-handoff-sec4-kickoff-…` | Estado real (verificado byte-a-byte) |
|--------------------------------------------------|--------------------------------------|
| "5 SSR pages + 4 lib helpers (9 ficheiros)" | 5 pages + **6** helpers de query (8 ficheiros em `lib/finance`, 2 são puros sem DB). Superfície real: 5 pages + 6 helpers. |
| "Todo o resto continua protegido SÓ pelo app-enforced (1.ª rede) — seguro" | **FALSO para estas 5 pages.** Não têm filtro `household_id` nenhum (grep: zero). Dependem de RLS inerte. |
| "Sem janela de vulnerabilidade aberta enquanto SEC-4 não corre" | **FALSO.** Há leak cross-tenant live (dados bancários) até esta story correr. Origem do âmbito expandido (2 redes). |
| "Invariante: app-enforced MANTIDO" | Não há app-enforced a *manter* aqui — há app-enforced a *adicionar* (1.ª rede inexistente nesta superfície). SEC-4 cria-a (mirror SEC-1 `lib/visao`). |
| "Sem migration esperada" | CONFIRMADO. 104 policies intactas; mudança 100% aplicacional. |
| "withHousehold é trivialmente o mesmo padrão" | CONFIRMADO (ADR-003 Adenda §10) — mas insuficiente sozinho: sem a Parte A (app-enforced), a 2.ª rede seria a única rede, violando o invariante das duas redes. |
