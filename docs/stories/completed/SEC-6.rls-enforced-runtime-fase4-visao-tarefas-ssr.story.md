# Story SEC-6: Visão + SSR Tarefas — RLS enforced em runtime (2.ª rede, ADR-003 Fatia B + carve-out SSR tarefas)

> **ID:** `SEC-6` (segurança transversal — Fase 4 do ADR-003, Fatia B + as 3 SSR pages `tarefas/*` carved out de Fatia A por `[SM-DECISION-1]` de SEC-5). Story cross-epic, não pertence a epic numerado.
> **Depende de:** SEC-2 (Done, `98c8176`) — wrapper `withHousehold` + gate de aplicação; SEC-4 (Done, `298a122`) — padrão de migração de **SSR pages/RSC** (`withHousehold` agnóstico a Route Handler vs RSC, ADR §10) **e** padrão de remediação de leak SSR (adicionar 1.ª rede app-enforced antes de migrar a 2.ª); SEC-5 (Done, `d27d9c8`) — domínio Tarefas (API handlers) fechado.
> **Scoping prévio:** ADR-003 Adenda §11 (@architect Aria, 03/06/2026) — Fatia B (Visão) = GO mecânico read-only; §11.2 nota de perf (6 widgets → 6 txs).
> **Handoff consumido:** `mj-handoff-session-sec5-shipped-next-sec6-20260603` (devops → any).

## Status

**Done — shipped em produção (`@devops *push`, 03/06/2026).** Push concluído no commit `18220b6` (`feat(security): RLS enforced em runtime + leak SSR cross-household fix na Visão e 3 SSR tarefas/* — Fase 4 Fatia B [Story SEC-6]`), ancestral de `origin/main`. Housekeeping/handoff session-end em `6215cfe` (`SEC-6 shipped`) e arquivamento em `60e4b69`. Sem db:migrate; CodeRabbit skip padrão SEC-1→5. _(Reconciliação 17/06/2026: o bloco Status tinha ficado stale em "InReview — aguarda @devops \*push"; a Fase 5 DEVOPS já estava executada desde 03/06.)_

> **Histórico:** **InReview — QA Gate PASS v1.2-ARCH-APPROVED (@architect Orion, 03/06/2026, 9,4/10).** Gate adversarial completo; leak fix validado ([PO-DECISION-1]). Aguardava `@devops *push` (sem db:migrate; CodeRabbit skip padrão SEC-1→5). Detalhe em QA Results §abaixo.

**Ready for Review v1.1-DEV (@dev Dex, 03/06/2026)** — implementação completa. 22 ficheiros modificados (6 routes + 9 widgets/grid/page + 3 SSR tarefas + 11 tests, –1 sobreposição). Leak fechado (4 queries com `household_id` bound + regressão AC9.2). Todos os gates verdes: lint, typecheck, web (1079 ✓, calendario flaky isolado-verde AC11), db-test (196 ✓ incl. gate aplicação 25/25), build, check:rls. Sem migration. Aguarda `@architect` qa-gate (atenção adversarial dedicada ao leak fix — [PO-DECISION-1]).

> **Histórico:** Approved v1.0 (@po Pax, 03/06/2026) — GO. Implementation Readiness **9,5/10**, confiança **Alta**. Validação byte-a-byte independente: o @po reconfirmou pessoalmente as 4 queries com leak, a assinatura `withHousehold`, a pureza do `queries.ts` e o tipo `WithHouseholdAuth`. Ver "Decisão de validação do PO" no fim do ficheiro.

> **Histórico:** Draft v0.1 (@sm River, 03/06/2026) — verificação byte-a-byte das duas superfícies. **ACHADO CRÍTICO confirmado (SM-OBS-3 de SEC-5 honrado):** ao contrário do domínio Visão (que tem 1.ª rede em todas as queries via `queries.ts` puro), as SSR pages `tarefas/kanban` e `tarefas/calendario` têm **4 queries inline sem filtro `household_id`** (leak cross-household SEC-4-style, RLS inerte em runtime). SEC-6 é por isso **híbrida**: mecânica (Visão + `tarefas/lista`) **+** correctiva (kanban + calendario, espelhando SEC-4).

## Executor Assignment

```
executor: "@dev"
quality_gate: "@architect"
quality_gate_tools: ["lint", "typecheck", "test", "build", "check:rls"]
```

## Story

**As a** engenheiro/product owner da Expressia,
**I want** que (a) o domínio Visão (6 routes `api/visao/*` + 6 widgets RSC + a decisão de empty-state da `visao/page.tsx`) e (b) as 3 SSR pages `tarefas/*` corram as suas leituras de domínio dentro de `withHousehold(auth, fn)` — activando a RLS viva em runtime (2.ª rede) — **e** que as 4 queries inline de `tarefas/kanban` e `tarefas/calendario` que hoje **não têm** filtro `household_id` recebam esse filtro (1.ª rede em falta),
**so that** estas superfícies de leitura tenham a mesma defense-in-depth de duas redes que os domínios Finanças (SEC-3/SEC-4) e Tarefas-API (SEC-5) já têm — fechando, no caminho, um vazamento cross-tenant real de colunas Kanban e de **todas** as tarefas (via `/tarefas/calendario`) que existe hoje em produção.

---

## Contexto e âmbito

### Duas naturezas numa só story (ler primeiro)

SEC-6 cobre duas superfícies que partilham o mesmo padrão de migração mas diferem no ponto de partida:

| Superfície | 1.ª rede (app-enforced) hoje? | Natureza da migração |
|-----------|-------------------------------|----------------------|
| **A — Visão** (routes + widgets + `visao/page.tsx`) | **SIM** — `lib/visao/queries.ts` é puro e filtra `household_id` em todas as 6 funções | **Mecânica** — réplica SEC-4 (só adicionar 2.ª rede `withHousehold`) |
| **B1 — `tarefas/page.tsx` (lista)** | **SIM** — via `listTasksHelper` (filtra `household_id`) | **Mecânica** — réplica SEC-4 |
| **B2 — `tarefas/kanban/page.tsx`** | **NÃO** (1 query: `kanban_columns`) | **Correctiva** — adicionar 1.ª rede **+** 2.ª rede |
| **B3 — `tarefas/calendario/page.tsx`** | **NÃO** (3 queries: `tasks` scheduled/unscheduled/count) | **Correctiva** — adicionar 1.ª rede **+** 2.ª rede |

> **Porquê o leak existe:** SEC-1 (`6f56e32`) adicionou 1.ª rede a ~42 queries de **API handlers**, mas as SSR pages/RSC ficaram de fora — exactamente como as 5 SSR pages de finanças que SEC-4 remediou. As pages `tarefas/kanban` (Story 3.4) e `tarefas/calendario` (Story 3.5) usam queries **inline** (não via helper) que nunca receberam o filtro. Com a RLS inerte em runtime (`getDb()` liga como role `rolbypassrls` — root-cause do ADR-003), estas queries devolvem hoje dados de **todos** os households a qualquer utilizador autenticado. A `tarefas/lista` escapou porque delega ao `listTasksHelper` (que já filtra, partilhado com a API).

### O que já existe (não reimplementar)

- `withHousehold<T>(auth, fn)` em `packages/db/src/client.ts:119` (`pgSql.begin` → transação real, rollback no throw; injecta `sub`+`household_id`+`role` nos claims JWT via `SET LOCAL`), re-exportado por `apps/web/src/lib/agent/db-shim.ts:79`. Produção desde SEC-2. **Assinatura: `withHousehold({ userId, householdId }, (tx) => …)` — precisa de `userId` E `householdId`.**
- Padrão de migração de **RSC/SSR read-only** provado em SEC-4 (5 SSR pages de finanças): `withHousehold(auth, tx => helper({ db: tx }))`, `getDb()` removido se o handler ficar sem outro uso.
- Padrão de migração de **route handler read-only** provado em SEC-2 (`GET /api/tasks`): wrapper fino `withHousehold(auth, tx => helper(tx, …))`.
- Padrão de **remediação de leak SSR** provado em SEC-4: adicionar `and <tabela>.household_id = ${householdId}::uuid` (parâmetro bound) à query, **antes/em conjunto** com a migração para `withHousehold`.
- Helper **puro** `lib/visao/queries.ts` (6 funções `getX(db: DbShim, householdId)` — todas com `where household_id = ${householdId}::uuid`) — **intacto (G1)**, exactamente como os 8 helpers `lib/finance/*` em SEC-4.
- Helper **puro** `lib/api-helpers/list-tasks.ts` (`listTasksHelper({ db, householdId, … })`) — intacto (G1), já usado por SEC-5.
- `requireAuth(span)` (`api/visao/*`) e `resolveHouseholdId(user.id)` + `user.id` (SSR pages) — fonte de `{ userId, householdId }` para `withHousehold`.

### Superfície A — Domínio Visão

> Linhas verificadas (grep + leitura 03/06/2026). O `@dev` localiza cada call-site pelo handler/função (SM-OBS-2), não por offset rígido.

**A1 — 6 route handlers `api/visao/*` (read-only, wrapper fino):**

| # | Ficheiro | Helper chamado | Padrão actual | `getServiceDb`? |
|---|----------|----------------|---------------|-----------------|
| 1 | `api/visao/tarefas-hoje/route.ts` | `getTasksToday(getDb(), auth.householdId)` (:52) | `getX(getDb(), auth.householdId)` | não |
| 2 | `api/visao/tarefas-atrasadas/route.ts` | `getTasksOverdue` | idem | não |
| 3 | `api/visao/financas-mes/route.ts` | `getFinancesMonth` | idem | não |
| 4 | `api/visao/saldo-contas/route.ts` | `getAccountsBalance` | idem | não |
| 5 | `api/visao/recorrencias-proximas/route.ts` | `getRecurrencesNext` | idem | não |
| 6 | `api/visao/calendario-semana/route.ts` | `getCalendarWeek` | idem | não |

- `api/visao/briefing/route.ts` — **stub sem DB** (`getBriefing()` síncrono, 0 `getDb`). **NÃO tocar.**

**A2 — 6 widgets RSC** (`apps/web/src/app/(app)/visao/_components/widgets/`): `TasksTodayWidget`, `TasksOverdueWidget`, `FinanceMonthWidget`, `AccountsBalanceWidget`, `RecurrencesNextWidget`, `CalendarWeekWidget`. Cada um chama `getX(getDb(), householdId)` (padrão `const data = await getTasksToday(getDb(), householdId)`). **Recebem hoje só `householdId` por prop** → ver Ponto Crítico 1 (precisam de `userId`). `BriefingWidget` é stub (0 `getDb`) → **NÃO tocar**.

**A3 — `visao/page.tsx`** — 3 usos de `getDb()`:
- `isVisaoEmpty(widgetsEnabled, householdId)` (:124) — cria 1 `getDb()` e passa-o às 6 funções household-scoped de `queries.ts` → **MIGRA** (envolver as 6 chamadas num único `withHousehold`).
- `readWidgetsEnabled(userId)` (:50) e `hasCompletedOnboarding(userId)` (:85) — leituras **user-scoped** (`user_prefs where user_id = ${userId}`) → **FORA de âmbito (carve-out — `[SM-DECISION-2]`)**: ver Fora de âmbito.

### Superfície B — SSR pages `tarefas/*`

| # | Ficheiro | Query/Helper | 1.ª rede hoje | Acção |
|---|----------|--------------|---------------|-------|
| B1 | `(app)/tarefas/page.tsx` | `listTasksHelper({ db: getDb(), householdId, … })` (:84-90) | **SIM** (helper) | Mecânica — `db: getDb()` → `withHousehold` |
| B2 | `(app)/tarefas/kanban/page.tsx` | `kanban_columns` inline (:83-87) **+** `listTasksHelper` (:88-94), ambos no mesmo `Promise.all` com 1 `getDb()` (:81) | `kanban_columns` **NÃO**; helper SIM | **Correctiva** — adicionar `where household_id` à query `kanban_columns` **+** migrar ambas para `withHousehold` |
| B3 | `(app)/tarefas/calendario/page.tsx` | 3 queries `tasks` inline: scheduled (:89-111), unscheduled (:112-134), count (:135-141), 1 `getDb()` (:81) | **NÃO** (as 3) | **Correctiva** — adicionar `and tasks.household_id = ${householdId}::uuid` às 3 **+** migrar para `withHousehold` |

> **Leak B2 (verificado byte-a-byte):** `select id, name, sort_order, color, is_done_column from public.kanban_columns order by sort_order asc` — sem `where household_id`. `kanban_columns` tem coluna `household_id`. Fix: `where household_id = ${householdId}::uuid`.
> **Leak B3 (verificado byte-a-byte):** as 3 queries sobre `public.tasks` filtram só por `due_date`/`status` (o `householdId` está resolvido na :55 mas **nunca é usado**). Fix: `and tasks.household_id = ${householdId}::uuid` (e `and household_id = …` na count, que não tem alias).

### Fora de âmbito (NÃO tocar nesta story)

- **Leituras `user_prefs` user-scoped** em `visao/page.tsx` (`readWidgetsEnabled` :50, `hasCompletedOnboarding` :85) → **SEC-7** (`[SM-DECISION-2]`). Racional: são `where user_id = auth.uid()`, não household-scoped; tocam `user_prefs`, a tabela que a Adenda §11.3 (Fatia C) **explicitamente** condiciona à confirmação @data-engineer de que as policies usam `auth.uid()`/`is_household_member`. Migrá-las agora, sem essa confirmação, arriscaria uma 2.ª rede **inerte** sem ninguém reparar. Ficam em `getDb()` (o import `getDb` mantém-se no ficheiro — handler misto). O bloco SEC-7 trata `user_prefs`/`api/me`/`household` em conjunto e com a Fase 0 leve do @data-engineer.
- `api/visao/briefing/route.ts` + `BriefingWidget` — stubs sem DB.
- Helpers puros `lib/visao/queries.ts` e `lib/api-helpers/list-tasks.ts` — `db`-injectáveis, intactos (G1).
- `getServiceDb()` / jobs Inngest — intocáveis por design.
- Outros domínios: Household/conta → SEC-7; Cérebro AI → SEC-8 (HOLD, Adenda §12).

---

## Acceptance Criteria

### AC1 — Visão: as 6 routes `api/visao/*` correm a leitura dentro de `withHousehold` (2.ª rede)

Cada uma das 6 routes (A1) migra a chamada ao helper para dentro de `withHousehold`. `auth = requireAuth(span)` já dá `{ userId, householdId }`:

```typescript
const body = await withHousehold(
  { userId: auth.userId, householdId: auth.householdId },
  (tx) => getTasksToday(tx, auth.householdId),     // 1.ª rede MANTIDA dentro do helper
);
```

`getDb()` é **removido** de cada route (sem outro uso); o import passa de `getDb`→`withHousehold` (via `@/lib/agent/db-shim`). `requireAuth`, `withSpan`, `apiError`, validação Zod (`…ResponseSchema.parse`), status codes e mensagens PT-PT **inalterados**. `briefing/route.ts` NÃO é tocado.

### AC2 — Visão: os 6 widgets RSC correm a leitura dentro de `withHousehold` (2.ª rede) e recebem `userId`

Cada widget (A2) migra `getX(getDb(), householdId)` → `withHousehold({ userId, householdId }, (tx) => getX(tx, householdId))`. Como `withHousehold` exige `userId` (Ponto Crítico 1) e os widgets só recebem `householdId`, a assinatura dos widgets passa a receber **também** `userId` (prop), propagado por `WidgetGrid` (que já recebe `householdId` da `visao/page.tsx`, onde `user.id` está disponível). O try/catch defensivo de cada widget e o fallback inline ficam **inalterados** (o `withHousehold` fica dentro do `try`). `BriefingWidget` NÃO é tocado.

### AC3 — Visão: `isVisaoEmpty` corre os 6 agregados num único `withHousehold`

Em `visao/page.tsx`, `isVisaoEmpty` substitui `const db = getDb()` por um único `withHousehold({ userId: user.id, householdId }, async (tx) => { … })` que envolve as ≤6 chamadas household-scoped (`getTasksToday`/`getTasksOverdue`/`getFinancesMonth`/`getRecurrencesNext`/`getAccountsBalance`/`getCalendarWeek`) usando `tx`. O `Promise.all` interno e a heurística de empty-state ficam **inalterados** (só muda o cliente: `db`→`tx`). O try/catch e o fallback `return false` em erro ficam iguais.

### AC4 — Tarefas-lista: migração mecânica (`tarefas/page.tsx`)

`listTasksHelper({ …, db: getDb() })` → corre dentro de `withHousehold`:

```typescript
const result = await withHousehold(
  { userId: user.id, householdId },
  (tx) => listTasksHelper({ filters, cursorPayload, householdId, userId: user.id, db: tx }),
);
```

`getDb()` removido; `getDb`→`withHousehold` no import. Resto do handler (Zod, EmptyState, redirects) inalterado.

### AC5 — Tarefas-kanban: 1.ª rede ADICIONADA à query `kanban_columns` + migração para `withHousehold`

1. A query `kanban_columns` (B2) recebe `where household_id = ${householdId}::uuid` (parâmetro bound — 1.ª rede em falta).
2. O `Promise.all` (query `kanban_columns` + `listTasksHelper`) corre dentro de **um único** `withHousehold({ userId: user.id, householdId }, async (tx) => { … })`, ambos usando `tx`. `getDb()` removido.
3. Comportamento, mapeamento de `columns`, `EmptyState`/`columns.length === 0`, try/catch e respostas **inalterados**.

### AC6 — Tarefas-calendario: 1.ª rede ADICIONADA às 3 queries `tasks` + migração para `withHousehold`

1. As 3 queries (B3 — scheduled, unscheduled, count) recebem o filtro app-enforced: `and tasks.household_id = ${householdId}::uuid` (scheduled/unscheduled, que têm alias `tasks`) e `and household_id = ${householdId}::uuid` (count, sem alias). Parâmetro bound. **Posicionar o filtro respeitando a interação com o `tagIdSql`/`tagIdFilter` existente** (combinar com `and`, não quebrar o SQL fragment opcional).
2. O `Promise.all` das 3 queries corre dentro de **um único** `withHousehold({ userId: user.id, householdId }, async (tx) => { … })`. `getDb()` removido.
3. Lógica de semana (`resolveWeekStart`/`buildWeekDays`/`toDayIso`), mapeamento de resultados, `hasNothing`, try/catch e respostas **inalterados**.

### AC7 — 1.ª rede MANTIDA onde já existia; `getServiceDb()`/helpers puros/stubs NÃO tocados

- Onde a 1.ª rede já existe (Visão via `queries.ts`; `tarefas/lista` e o `listTasksHelper` do kanban via helper), o filtro `household_id` **mantém-se** — `withHousehold` é aditivo. Nenhum filtro removido.
- Onde a 1.ª rede foi **adicionada** (AC5, AC6), o filtro usa parâmetro bound (`${householdId}::uuid`), nunca concatenação.
- `lib/visao/queries.ts` e `lib/api-helpers/list-tasks.ts` (puros) **intactos**.
- Nenhum ficheiro passa a usar `getServiceDb()` (grep: zero introduções).
- `briefing/route.ts` e `BriefingWidget` intactos.

### AC8 — Import via `db-shim.ts`; auth/guards/erros/redirects INALTERADOS

- `withHousehold` importado de `@/lib/agent/db-shim` (nunca directo de `@meu-jarvis/db/client`).
- `requireAuth` (routes) / `createServerSupabaseClient`+`getUser`+`resolveHouseholdId` (SSR) e todos os early-returns/redirects (`/entrar`, `EmptyState variant="error"`, `/bem-vindo`) ficam **exactamente como estão**.
- Nenhum `return <JSX>` / `return NextResponse` / `redirect()` dentro de um callback `withHousehold` (read-only → não há early-returns de domínio; mas a regra vale por disciplina — toda a decisão de UI/HTTP fica fora do callback).

### AC9 — Testes: mock `withHousehold` + regressão bound-param (incl. leaks fechados)

Para cada ficheiro migrado com teste existente, o mock de `@/lib/agent/db-shim` passa a incluir `withHousehold` (padrão SEC-2/4/5):

```typescript
vi.mock('@/lib/agent/db-shim', () => ({
  getDb: () => fakeDb,                                       // mantido se o ficheiro ainda usa getDb (ex.: visao/page.tsx user_prefs)
  withHousehold: (_auth: unknown, fn: (tx: unknown) => unknown) => fn(fakeDb),
}));
```

1. Testes existentes das routes `api/visao/*` e das SSR pages mantêm-se verdes (com o mock `withHousehold` adicionado).
2. **Regressão de leak (mandatória):** ≥1 teste novo/estendido por leak fechado que asserte o filtro `household_id` nos params bound — um para `tarefas/kanban` (query `kanban_columns`), um para `tarefas/calendario` (as 3 queries `tasks`). Espelha o util `_sql-bound-params.ts` de SEC-4. Sem este teste, uma regressão futura reabriria o leak silenciosamente.
3. Os testes dos widgets (se existirem) actualizam a prop para incluir `userId`.

### AC9b — `briefing` e stubs: cobertura intacta

Os testes de `api/visao/briefing` e de `BriefingWidget` (se existirem) permanecem verdes sem alteração (não foram tocados).

### AC10 — Gate de aplicação cobre as tabelas tocadas

O gate de aplicação real `packages/db-test/src/tests/rls-application.test.ts` prova a 2.ª rede com role runtime. As tabelas lidas por SEC-6 são `tasks`, `kanban_columns`, `tags`, `task_tags`, `recurrences`, `accounts`, `transactions`, `categories` — **todas já cobertas** por SEC-3 (finanças) e SEC-5 (tarefas). Verificar que continuam VERDES. Se a verificação revelar uma tabela tocada **não** coberta, estender o gate com ≥1 caso de isolamento cross-household (mirror SEC-3/SEC-5). **Não é esperada extensão** (cobertura herdada completa) — confirmar e documentar.

### AC11 — Gates de qualidade TODOS VERDES; sem migration

`pnpm lint` · `pnpm typecheck` · `pnpm test` (web + db-test Docker) · `pnpm build` · `pnpm check:rls` — todos exit 0. **Sem migration SQL nova** (104 policies intactas desde `0001_rls_policies.sql` — NÃO correr `db:migrate`). Nota: a SSR page `tarefas/calendario/page.test.tsx` é flaky por timeout sob carga paralela (passa isolada — observado em SEC-5); re-correr isolada se falhar em paralelo.

---

## Tasks / Subtasks

- [x] **T1 — Visão: 6 routes `api/visao/*`** (AC1, AC7, AC8, AC9)
  - [x] T1.1 Migrar `tarefas-hoje`, `tarefas-atrasadas`, `financas-mes`, `saldo-contas`, `recorrencias-proximas`, `calendario-semana`: `getX(getDb(), auth.householdId)` → `withHousehold(auth, tx => getX(tx, auth.householdId))`; `getDb` removido; import `getDb`→`withHousehold`. `briefing` intacto.
  - [x] T1.2 Tests das routes (`api/visao/__tests__/*`): mock `withHousehold`; assertions de contrato/Zod mantidas verdes.

- [x] **T2 — Visão: 6 widgets RSC + `WidgetGrid` (propagação `userId`)** (AC2, AC8, AC9)
  - [x] T2.1 `WidgetGrid` passa a receber e propagar `userId` aos widgets (já recebe `householdId`); `visao/page.tsx` passa `userId={user.id}` ao `<WidgetGrid>`.
  - [x] T2.2 Migrar os 6 widgets: assinatura `{ householdId, userId }`; `getX(getDb(), householdId)` → `withHousehold({ userId, householdId }, tx => getX(tx, householdId))` dentro do try existente. `BriefingWidget` intacto (props ajustadas, sem DB).
  - [x] T2.3 Tests dos widgets: prop `userId` (15 invocações) + mock `withHousehold` (`widgets.test.tsx` + `WidgetGrid.test.tsx`).

- [x] **T3 — Visão: `visao/page.tsx` `isVisaoEmpty`** (AC3, AC8)
  - [x] T3.1 `isVisaoEmpty`: `const db = getDb()` → `withHousehold({ userId: user.id, householdId }, async (tx) => { … Promise.all com tx … })`. `readWidgetsEnabled`/`hasCompletedOnboarding` (user_prefs) **inalterados** (`getDb` mantido — handler misto). Passa `user.id` a `isVisaoEmpty` (assinatura).
  - [x] T3.2 Test de `visao/page.tsx`: mock `withHousehold` + `getDb` (ambos, pelo handler misto).

- [x] **T4 — Tarefas: `tarefas/page.tsx` (lista)** (AC4, AC8, AC9)
  - [x] T4.1 `listTasksHelper({ db: getDb() })` → dentro de `withHousehold`. `getDb` removido.
  - [x] T4.2 Test `tarefas/__tests__/page.test.tsx`: mock `withHousehold`.

- [x] **T5 — Tarefas: `tarefas/kanban/page.tsx` (LEAK FIX + migração)** (AC5, AC7, AC8, AC9)
  - [x] T5.1 Adicionar `where household_id = ${householdId}::uuid` à query `kanban_columns`.
  - [x] T5.2 Envolver o `Promise.all` (kanban_columns + `listTasksHelper`) num único `withHousehold`; `getDb` removido.
  - [x] T5.3 Test: assert `household_id` bound na query `kanban_columns` (regressão de leak — AC9.2) + mock `withHousehold`.

- [x] **T6 — Tarefas: `tarefas/calendario/page.tsx` (LEAK FIX + migração)** (AC6, AC7, AC8, AC9)
  - [x] T6.1 Adicionar filtro `household_id` às 3 queries (scheduled/unscheduled com alias `tasks.`; count sem alias), respeitando a combinação com `tagIdSql`/`tagIdFilter`.
  - [x] T6.2 Envolver o `Promise.all` das 3 queries num único `withHousehold`; `getDb` removido.
  - [x] T6.3 Test: assert `household_id` bound nas 3 queries (regressão de leak — AC9.2), com e sem `tag_id` + mock `withHousehold` (flaky timeout confirmado isolado — AC11).

- [x] **T7 — Gate de aplicação** (AC10)
  - [x] T7.1 Confirmado `rls-application.test.ts` verde (25 testes) para `tasks`/`kanban_columns`/`tags`/`task_tags`/`recurrences` (SEC-5) + `accounts`/`transactions`/`categories` (SEC-3). Sem extensão necessária (cobertura herdada completa).

- [x] **T8 — Quality gates** (AC11)
  - [x] T8.1 `pnpm lint` ✓ · T8.2 `pnpm typecheck` ✓ · T8.3 `pnpm --filter @meu-jarvis/web test` (1079 ✓; calendario flaky timeout passa isolado — AC11) · T8.4 `pnpm --filter @meu-jarvis/db-test test` (196 ✓, Docker) · T8.5 `pnpm build` ✓ · T8.6 `pnpm check:rls` ✓ — todos exit 0. Sem `db:migrate`.

---

## Dev Notes

### Referências-chave (leitura obrigatória)

| Recurso | Localização | Porquê |
|---------|-------------|--------|
| Padrão RSC/SSR read-only + remediação de leak | SEC-4 — `completed/SEC-4.…story.md` + qualquer `(app)/financas/*/page.tsx` | Forma EXACTA: adicionar 1.ª rede + `withHousehold(auth, tx => helper({ db: tx }))` |
| Padrão route read-only | `api/visao/tarefas-hoje/route.ts` (wrapper fino actual) + `api/tasks/route.ts:89` (GET migrado SEC-2) | `withHousehold(auth, tx => getX(tx, householdId))` |
| `withHousehold` (assinatura + mecânica) | `db-shim.ts:79` (re-export) · `client.ts:119` (`pgSql.begin`, claims `sub`+`household_id`) | **Precisa de `userId` E `householdId`** |
| Helper puro Visão | `lib/visao/queries.ts` | 6 funções `getX(db, householdId)` — todas filtram `household_id`. Intacto (G1) |
| Util de regressão bound-param | SEC-4 `_sql-bound-params.ts` (db-test/web tests) | Espelhar para os testes de leak (AC9.2) |
| Gate de aplicação | `packages/db-test/src/tests/rls-application.test.ts` | 2.ª rede provada (tabelas já cobertas SEC-3/5) |
| ADR | `docs/adr/ADR-003-…md` Adenda §11 (esp. §11.2 nota perf) | Scoping Fatia B + nota dos 6 widgets |

### Pontos críticos

1. **`withHousehold` exige `userId` E `householdId`.** As routes têm-no via `requireAuth` (`auth.userId`/`auth.householdId`). As SSR pages têm `user.id` + `householdId` (resolveHouseholdId). **Os 6 widgets só recebem `householdId` hoje → T2.1 propaga `userId` via `WidgetGrid`** (mudança de assinatura — não esquecer os testes dos widgets).
2. **O leak (T5/T6) é o foco de risco da story.** As 4 queries de `kanban`/`calendario` devolvem hoje dados cross-household em produção (RLS inerte). A 1.ª rede (filtro `household_id`) é a correcção que **realmente fecha** o vazamento; a 2.ª rede (`withHousehold`) é defense-in-depth. Ambas nesta story. Atenção adversarial dedicada no gate.
3. **1.ª rede NÃO se remove** onde já existe (Visão, lista). `withHousehold` é aditivo.
4. **Handler misto `visao/page.tsx`:** mantém `getDb` (user_prefs user-scoped — fora de âmbito, `[SM-DECISION-2]`) **e** ganha `withHousehold` (isVisaoEmpty). O import mantém os dois.
5. **`calendario` — combinação com `tagIdSql`:** o filtro `household_id` tem de coexistir com o fragment opcional `${tagIdSql}`/`${tagIdFilter ? … : sql\`\`}`. Combinar com `and`, sem quebrar o caso "sem tag". Testar ambos os caminhos (com e sem `tag_id`).
6. **Read-only → sem retorno discriminado complexo:** ao contrário de SEC-5 (mutações com early-returns 404/409), aqui as leituras devolvem dados directamente do callback. Manter as decisões de UI (EmptyState, redirects) **fora** do `withHousehold`.

### Sobre performance (Adenda §11.2 — documentar, não optimizar)

`/visao` renderiza 6 widgets RSC independentes → **6 transações `withHousehold` curtas por render** (+ 1 para `isVisaoEmpty` = 7) em vez de partilhar 1 `getDb()`. Aceitável: mesma pool pgbouncer transaction-mode, txs curtas read-only, render paralelo preservado (NFR1). **Decisão deliberada de não optimizar** (partilha de cache/tx fica para a Story 5.10 perf sweep, já referida em `visao/page.tsx:118`). Idem `tarefas/kanban` (1 tx com 2 reads) e `calendario` (1 tx com 3 reads) — uma tx por page, sem regressão material.

### Convenções

Imports `@/` absolutos · sem `any` (`unknown` + guards) · PT-PT em comentários/erros · `prepare:false` intocado · REQ-INLINE-1 (`sql` de `drizzle-orm`, cliente do shim) · parâmetros bound sempre (`${householdId}::uuid`), nunca concatenação.

### Riscos (para @architect no gate)

| Risco | Mitigação |
|-------|-----------|
| Leak fix incompleto — uma das 4 queries fica sem `household_id` | AC5/AC6 enumeram as 4; T5.3/T6.3 testam bound-param por query; gate confirma por grep |
| `calendario` — filtro `household_id` quebra o caminho `tagIdSql` (com/sem tag) | Ponto Crítico 5; T6.3 testa ambos os caminhos |
| Widget migrado sem `userId` → `withHousehold` recebe `userId` undefined → claims inválidos | AC2 + Ponto Crítico 1; typecheck apanha se a prop for required |
| 1.ª rede removida por engano na Visão/lista ao mexer | AC7 — grep `household_id` antes/depois (≥); helpers puros intactos |
| `withHousehold` envolve decisão de UI/redirect | AC8 — toda a decisão HTTP/JSX fora do callback |
| Perf: 7 txs por render de /visao | Aceite e documentado (Adenda §11.2); não optimizar |

---

## Testing

| Camada | Ferramenta | Ficheiros |
|--------|-----------|-----------|
| Routes Visão (unit + contrato Zod) | Vitest node (`apps/web`) | `api/visao/{tarefas-hoje,tarefas-atrasadas,financas-mes,saldo-contas,recorrencias-proximas,calendario-semana}/__tests__/*` |
| Widgets + page Visão (RSC) | Vitest jsdom (`apps/web`) | `(app)/visao/**/__tests__/*` (se existirem) |
| SSR Tarefas (incl. regressão de leak bound-param) | Vitest (`apps/web`) | `(app)/tarefas/{,kanban,calendario}/__tests__/*` |
| Gate de aplicação RLS (2.ª rede) | Vitest + Testcontainers (`db-test`) | `packages/db-test/src/tests/rls-application.test.ts` (verde; tabelas já cobertas) |
| Gate estático | `pnpm check:rls` | — |

---

## CodeRabbit Integration

> **CodeRabbit Integration**: Disabled — sem `coderabbit_integration` em `core-config.yaml`. Validação via @architect adversarial gate (padrão SEC-1/2/3/4/5).

---

## Change Log

| Data | Versão | Descrição | Autor |
|------|--------|-----------|-------|
| 2026-06-03 | 0.1 | Draft inicial — ADR-003 Fase 4 Fatia B (Visão) + carve-out das 3 SSR pages `tarefas/*` (de Fatia A, `[SM-DECISION-1]` SEC-5). Verificação byte-a-byte das 2 superfícies. **Achado de segurança confirmado pessoalmente (SM-OBS-3 honrado):** 4 queries inline sem `household_id` em `tarefas/kanban` (1: kanban_columns) e `tarefas/calendario` (3: tasks) → leak cross-household SEC-4-style, RLS inerte em runtime. SEC-6 híbrida: mecânica (Visão + lista) + correctiva (kanban + calendario). `queries.ts` confirmado puro/intacto (G1). `withHousehold` exige `userId` → widgets precisam de nova prop. `[SM-DECISION-2]`: leituras `user_prefs` user-scoped de `visao/page.tsx` carved out p/ SEC-7 (tocam tabela da confirmação @data-engineer da Fatia C). Sem migration. | River (@sm) |
| 2026-06-03 | 1.0 | **GO** (Readiness 9,5/10, confiança Alta). @po reconfirmou byte-a-byte os 4 leaks + assinatura/tipo `withHousehold` + pureza `queries.ts`. 4 decisões formais: [PO-DECISION-1] leak fix HIGH com gate adversarial dedicado; [PO-DECISION-2] manter unificada (precedente SEC-4, contra split); [PO-DECISION-3] ratificar carve-out `user_prefs`→SEC-7; [PO-DECISION-4] ratificar assignment @dev/@architect. Status Draft→Approved. | Pax (@po) |
| 2026-06-03 | 1.1-DEV | **Implementação completa.** T1-T8 done. Leak fechado: `household_id` bound nas 4 queries (`kanban_columns` + 3× `tasks`) + regressão AC9.2 (bound-param, com/sem `tag_id`). 2.ª rede `withHousehold` aditiva em 6 routes + 6 widgets + `isVisaoEmpty` + lista + 2 SSR leak. `WidgetGrid` propaga `userId` (SM-OBS-4). `visao/page.tsx` handler misto (getDb p/ user_prefs + withHousehold). Stubs/helpers puros intactos. Gates: lint ✓ typecheck ✓ web 1079 ✓ (calendario flaky isolado-verde AC11) db-test 196 ✓ (gate aplicação 25/25) build ✓ check:rls ✓. Sem migration. Status Approved→Ready for Review. | Dex (@dev) |
| 2026-06-03 | 1.2-ARCH-APPROVED | **QA Gate PASS (9,4/10, confiança Alta).** @architect gate adversarial com foco dedicado ao leak fix ([PO-DECISION-1]). Confirmado por leitura+grep: 4 queries com `household_id` **parâmetro bound** (`${householdId}::uuid`, zero concatenação) no WHERE correcto; testes AC9.2 (`boundParamValues`) falhariam se removido — mecânica prova-o (param só aparece se bound, e teste `tag_id` prova coexistência sem concatenação). 1.ª rede mantida na Visão (`queries.ts` 7 filtros, puro G1) + lista. `withHousehold({ userId, householdId })` em todos os call-sites. `getServiceDb`/stubs/helpers puros intactos; sem migration. Gates re-corridos fresh: check:rls ✓ · typecheck ✓ · lint ✓ (0 warn) · testes-alvo 159✓ + 3 timeouts flaky AC11 → isolados 9/9 verde. Status Ready for Review→**InReview (PASS)**. Próximo: `@devops *push`. | Orion (@architect) |

---

## QA Results (Gate Decision — @architect Orion, 03/06/2026)

**Gate: PASS · Score 9,4/10 · Confiança Alta**

Gate adversarial padrão SEC-3/SEC-4/SEC-5, com **atenção dedicada ao leak fix** conforme [PO-DECISION-1].

### Foco crítico — leak fix (HIGH) verificado

| # | Verificação | Resultado | Evidência |
|---|-------------|-----------|-----------|
| 1 | 4 queries com `household_id` **parâmetro bound** (nunca concatenação) | ✓ PASS | `tarefas/kanban/page.tsx:92` (`where household_id = ${householdId}::uuid`); `tarefas/calendario/page.tsx:115,139,150` (`and (tasks.)?household_id = ${householdId}::uuid`). Todas tagged-`sql`. |
| 2 | Testes AC9.2 existem e falhariam se removido | ✓ PASS | kanban 1 teste (`page.test.tsx:167`) + calendario 2 (`:198` sem tag, `:214` com tag). Asserção `boundParamValues(sql).toContain(HOUSEHOLD_UUID)` — mecanicamente só passa se o param estiver bound; teste `tag_id` prova coexistência (ambos bound, sem concatenação). |
| 3 | 1.ª rede MANTIDA na Visão (`queries.ts`) + lista — nenhum filtro removido (AC7) | ✓ PASS | `queries.ts` 7 filtros `household_id`, puro (zero `getDb`/`getServiceDb`/`withHousehold` — recebe `tx`, G1). `listTasksHelper` via `withHousehold`. |
| 4 | `withHousehold({ userId, householdId })` em TODOS os call-sites (SM-OBS-4) | ✓ PASS | Assinatura `db-shim.ts:63-64`; 5 widgets household-scoped + 2 SSR + `visao/page.tsx` passam o par. `WidgetGrid` propaga `userId` (required, apanhado por typecheck). |
| 5 | `getServiceDb()`/stubs/helpers puros intactos; sem migration | ✓ PASS | Zero `getServiceDb`/`service_role` na Visão; BriefingWidget stub não migra; 104 policies intactas (db:migrate não corrido). |

### Gates re-corridos (evidência fresca, não confiando no handoff)

| Gate | Resultado |
|------|-----------|
| `pnpm check:rls` | ✓ todas as tabelas cobertas (incl. `kanban_columns`/`tasks`/`tags`/`task_tags`) |
| `pnpm --filter web typecheck` | ✓ `tsc --noEmit` limpo |
| `pnpm --filter web lint` | ✓ 0 warnings/errors (aviso lockfile pré-existente, não bloqueante) |
| Testes-alvo (kanban/calendario/visao/api·visao) | 159 ✓ + 3 timeouts → **flaky AC11** (collect 482s sob carga); isolados single-thread **9/9 verde** (kanban 4 + calendario 5, incl. os 3 de render) |

### Decisão

PASS. Leak cross-household HIGH fechado e provado adversarialmente; 2.ª rede `withHousehold` aditiva sem regressão da 1.ª rede; sem migration. O flaky AC11 (timeout sob paralelismo, verde isolado) é pré-existente desde SEC-2/3 e não é regressão — recomendação não-bloqueante: rever `testTimeout` global ou pool em iteração futura de DX (não SEC).

**Next:** `@devops *push SEC-6` (sem `db:migrate`; CodeRabbit skip padrão SEC-1→5).

---

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (@dev Dex) — 03/06/2026.

### Debug Log References

- Typecheck: 10/10 packages verde (`pnpm typecheck`).
- Lint: 10/10 verde, 0 warnings/errors (`pnpm lint --max-warnings=0`).
- Web tests: 1079 passed / 1 flaky (`tarefas/calendario` "renderiza WeekViewClient" — timeout 5000ms sob carga paralela, collect 339s). Confirmado **verde isolado** (5/5, 1715ms) — comportamento documentado na AC11/SEC-5, NÃO regressão.
- db-test (gate de aplicação, Docker): 196 passed; `rls-application.test.ts` 25/25 verde isolado.
- Build Next.js: sucesso (`/visao` 2,93 kB, `/tarefas/calendario` 8,38 kB, `/tarefas/kanban` 7,26 kB).
- `check:rls`: todas as tabelas cobertas (incl. `kanban_columns`, `tasks`, `tags`, `task_tags`).

### Completion Notes

1. **Leak fechado (foco de risco — SM-OBS-1 / [PO-DECISION-1]).** As 4 queries inline receberam 1.ª rede (`household_id` bound):
   - `tarefas/kanban/page.tsx` — `kanban_columns` (`where household_id = ${householdId}::uuid`).
   - `tarefas/calendario/page.tsx` — 3 queries `tasks` (scheduled/unscheduled com alias `tasks.household_id`; count sem alias `household_id`), combinadas com `and` respeitando o fragment opcional `tagIdSql`/`tagIdFilter`.
   - Regressão mandatória (AC9.2): testes bound-param via util SEC-4 `boundParamValues` — 1 para kanban, 2 para calendario (sem e **com** `tag_id`, provando a coexistência household_id + tag — Ponto Crítico 5).
2. **2.ª rede aditiva.** 6 routes + 6 widgets + `isVisaoEmpty` + `tarefas/lista` + as 2 SSR com leak migrados para `withHousehold`. 1.ª rede MANTIDA onde já existia (Visão via `queries.ts`, lista via helper) — `withHousehold` é aditivo, nenhum filtro removido.
3. **`userId` propagado (SM-OBS-4).** `WidgetGrid` ganhou prop `userId` (required) → 6 widgets recebem `{ householdId, userId }`; `visao/page.tsx` passa `userId={user.id}`. `BriefingWidget` aceita ambas as props mas ignora-as (stub sem DB). Typecheck confirma que nenhuma migração ficou sem `userId`.
4. **Handler misto `visao/page.tsx` ([PO-DECISION-3] / `[SM-DECISION-2]`).** Mantém `getDb` (leituras `user_prefs` user-scoped → SEC-7) **e** ganha `withHousehold` (isVisaoEmpty household-scoped). Import expõe os dois.
5. **Intocados conforme âmbito:** `briefing/route.ts` + `BriefingWidget` (stubs), helpers puros `queries.ts`/`list-tasks.ts` (G1), `getServiceDb()` (grep: zero introduções). Sem migration (104 policies intactas — `db:migrate` NÃO corrido).
6. **Perf (Adenda §11.2):** decisão deliberada de não optimizar — 7 txs por render `/visao`, 1 tx/page no kanban/calendario. Documentado, deferido para Story 5.10.

### File List

**Modificados — Visão routes (6):**
- `apps/web/src/app/api/visao/tarefas-hoje/route.ts`
- `apps/web/src/app/api/visao/tarefas-atrasadas/route.ts`
- `apps/web/src/app/api/visao/financas-mes/route.ts`
- `apps/web/src/app/api/visao/saldo-contas/route.ts`
- `apps/web/src/app/api/visao/recorrencias-proximas/route.ts`
- `apps/web/src/app/api/visao/calendario-semana/route.ts`

**Modificados — Visão widgets + grid + page (8):**
- `apps/web/src/app/(app)/visao/_components/WidgetGrid.tsx`
- `apps/web/src/app/(app)/visao/_components/widgets/TasksTodayWidget.tsx`
- `apps/web/src/app/(app)/visao/_components/widgets/TasksOverdueWidget.tsx`
- `apps/web/src/app/(app)/visao/_components/widgets/FinanceMonthWidget.tsx`
- `apps/web/src/app/(app)/visao/_components/widgets/AccountsBalanceWidget.tsx`
- `apps/web/src/app/(app)/visao/_components/widgets/RecurrencesNextWidget.tsx`
- `apps/web/src/app/(app)/visao/_components/widgets/CalendarWeekWidget.tsx`
- `apps/web/src/app/(app)/visao/_components/widgets/BriefingWidget.tsx`
- `apps/web/src/app/(app)/visao/page.tsx`

**Modificados — Tarefas SSR (3, 2 com leak fix):**
- `apps/web/src/app/(app)/tarefas/page.tsx`
- `apps/web/src/app/(app)/tarefas/kanban/page.tsx` (LEAK FIX)
- `apps/web/src/app/(app)/tarefas/calendario/page.tsx` (LEAK FIX)

**Modificados — Tests (11):**
- `apps/web/src/app/api/visao/__tests__/tarefas-hoje.test.ts`
- `apps/web/src/app/api/visao/__tests__/tarefas-atrasadas.test.ts`
- `apps/web/src/app/api/visao/__tests__/financas-mes.test.ts`
- `apps/web/src/app/api/visao/__tests__/saldo-contas.test.ts`
- `apps/web/src/app/api/visao/__tests__/recorrencias-proximas.test.ts`
- `apps/web/src/app/api/visao/__tests__/calendario-semana.test.ts`
- `apps/web/src/app/(app)/visao/_components/__tests__/widgets.test.tsx`
- `apps/web/src/app/(app)/visao/_components/__tests__/WidgetGrid.test.tsx`
- `apps/web/src/app/(app)/visao/__tests__/page.test.tsx`
- `apps/web/src/app/(app)/tarefas/__tests__/page.test.tsx`
- `apps/web/src/app/(app)/tarefas/kanban/__tests__/page.test.tsx` (+regressão leak)
- `apps/web/src/app/(app)/tarefas/calendario/__tests__/page.test.tsx` (+regressão leak ×2)

> Nota: `briefing/route.ts`, `briefing.test.ts`, `lib/visao/queries.ts`, `lib/api-helpers/list-tasks.ts` **NÃO** foram modificados (intactos por âmbito).

---

## Observações do SM (para @po na validação)

- **SM-OBS-1 (achado de segurança — ESCALAR/RATIFICAR).** Esta é a observação mais importante. Honrando o protocolo SM-OBS-3 de SEC-5 ("se encontrares UMA query sem filtro `household_id`, é achado SEC-4-style e deve ser escalado, não silenciosamente adicionado"), **encontrei 4** e li-as byte-a-byte: `tarefas/kanban/page.tsx:83-87` (`kanban_columns` sem `where household_id`) e `tarefas/calendario/page.tsx:89-141` (3 queries `tasks` sem `household_id`, apesar de `householdId` estar resolvido na :55). Com a RLS inerte em runtime (root-cause ADR-003), estas devolvem hoje dados cross-household em produção a qualquer utilizador autenticado. Recomendo ao @po: tratar a remediação (AC5/AC6) como **HIGH** e exigir atenção adversarial dedicada do @architect ao leak fix (espelhando o que SEC-4 fez para finanças e [PO-DECISION-1] de SEC-5 para batch/recurrences). A 1.ª rede é a correcção que fecha o leak; a 2.ª (`withHousehold`) é defesa adicional.
- **SM-OBS-2 (granularidade — decisão a ratificar).** SEC-6 = Visão (mecânica) + 3 SSR tarefas (1 mecânica + 2 correctivas). Total ≈ 13-15 call-sites `getDb()` + 4 leak-fix queries — comparável a SEC-3/SEC-5. O sub-split natural seria SEC-6a (Visão, puramente mecânica) / SEC-6b (SSR tarefas, com o leak fix). **Recomendo manter junto:** o padrão é uniforme (réplica SEC-4 provada), os domínios são read-only, e o leak fix está contido em 2 ficheiros (atenção dedicada via T5/T6 e SM-OBS-1). Mas é decisão do @po — se julgar que o leak HIGH merece isolamento, SEC-6b isolaria o risco correctivo da migração mecânica da Visão.
- **SM-OBS-3 (alinhamento de linhas — informativo).** As linhas citadas são do grep/leitura de 03/06. O @dev localiza cada call-site pelo handler/função (não por offset rígido); a tabela byte-a-byte é guia, não contrato de linha.
- **SM-OBS-4 (`userId` nos widgets — risco de implementação).** A migração dos widgets exige propagar `userId` (prop nova) porque `withHousehold` precisa dele para os claims. Não é um detalhe cosmético — um widget migrado sem `userId` produz claims JWT inválidos. Sinalizado no AC2/T2.1 e Ponto Crítico 1; o typecheck deve apanhar se a prop for `required`.
- **SM-OBS-5 (carve-out `user_prefs`).** `[SM-DECISION-2]` deixa as 2 leituras `user_prefs` user-scoped de `visao/page.tsx` para SEC-7. Se o @po preferir incluí-las aqui, isso **obriga** a antecipar a confirmação @data-engineer da Adenda §11.3 (policies `user_prefs` usam `auth.uid()`?) — caso contrário a 2.ª rede dessas leituras ficaria inerte. Recomendo manter o carve-out (SEC-6 fica homogéneo household-scoped; SEC-7 trata user-scoped com a Fase 0 do @data-engineer).

---

## Decisão de validação do PO (@po Pax, 03/06/2026)

**Veredicto: GO.** Implementation Readiness **9,5/10** · Confiança **Alta**.

### Verificação independente (anti-alucinação — não confiei só no SM)

O @po reconfirmou byte-a-byte os claims de maior risco antes de ratificar:

| Claim | Verificação | Resultado |
|-------|-------------|-----------|
| Leak `kanban_columns` | `kanban/page.tsx:83-87` — `select … from public.kanban_columns order by sort_order` sem `where household_id` | **CONFIRMADO** |
| Leak 3× `tasks` | `calendario/page.tsx:89-111/112-134/135-141` — filtram só `due_date`/`status`; `householdId` resolvido na `:55` nunca usado | **CONFIRMADO** |
| `withHousehold(auth, fn)` re-exportado | `db-shim.ts:79` | **CONFIRMADO** |
| `WithHouseholdAuth` exige `userId` E `householdId` | `db-shim.ts:62-65` — ambos `readonly string` não-opcionais | **CONFIRMADO** (valida Ponto Crítico 1 + SM-OBS-4) |
| `queries.ts` puro/intacto (G1) | `db` injectado pelo chamador, nunca instanciado (`:14-15`) | **CONFIRMADO** |
| `tarefas/lista` 1.ª rede via helper | `tarefas/page.tsx:84-90` — `listTasksHelper({ db: getDb() })` | **CONFIRMADO** |

### Decisões formais

- **[PO-DECISION-1] — RATIFICO SM-OBS-1: leak fix é HIGH com gate adversarial dedicado.** As 4 queries devolvem dados cross-household em produção (RLS inerte). A remediação (AC5/AC6/T5/T6) é tratada como prioridade HIGH. **O @architect, no qa-gate, dá atenção adversarial dedicada ao leak fix** — confirmando por grep que as 4 queries passam a ter `household_id` com parâmetro bound, e que os testes de regressão AC9.2 existem e falhariam se o filtro fosse removido. Espelha o que SEC-4 fez para finanças e o `[PO-DECISION-1]` de SEC-5 para batch/recurrences.

- **[PO-DECISION-2] — MANTER SEC-6 unificada (não split SEC-6a/6b).** Decido contra o split sugerido em SM-OBS-2. Racional: (1) **precedente directo SEC-4** — fez migração mecânica + remediação de leak SSR numa só story sem incidente; (2) o leak está **contido em 2 ficheiros** com tasks dedicadas (T5/T6) e atenção de gate via [PO-DECISION-1]; (3) o padrão é uniforme (réplica SEC-4 provada 5×); (4) ambas as superfícies são read-only homogéneas. O isolamento de risco que o split daria já é alcançado pela atenção adversarial dedicada do gate. Granularidade (~13-15 call-sites + 4 leak-fix) é comparável a SEC-3/SEC-5 — DoD humano gerível.

- **[PO-DECISION-3] — RATIFICO o carve-out `user_prefs` para SEC-7 (SM-OBS-5 / `[SM-DECISION-2]`).** As 2 leituras user-scoped de `visao/page.tsx` ficam fora. Incluí-las agora obrigaria a antecipar a confirmação @data-engineer da Adenda §11.3 (policies `user_prefs` usam `auth.uid()`/`is_household_member`?); sem ela, a 2.ª rede ficaria **inerte sem ninguém reparar** — pior que não a ter. SEC-6 fica homogéneo household-scoped; SEC-7 trata user-scoped com a Fase 0 leve do @data-engineer. `visao/page.tsx` permanece handler misto (`getDb` + `withHousehold`) — explícito no AC3/T3/Ponto Crítico 4.

- **[PO-DECISION-4] — RATIFICO assignment.** `executor: @dev` / `quality_gate: @architect` (≠ executor ✓); tools `[lint, typecheck, test, build, check:rls]` adequados a story de código/segurança. CodeRabbit disabled com skip notice presente — validação via gate adversarial @architect (padrão SEC-1→5).

### Notas para o @dev (zero-bloqueio, reforço)

1. **`withHousehold` exige `userId`** — typecheck apanha se faltar, mas confirma a propagação `WidgetGrid → 6 widgets` (T2.1) e o `user.id` em `isVisaoEmpty`/SSR pages antes de assumir verde.
2. **Parâmetro bound sempre** — `${householdId}::uuid`, nunca concatenação (REQ-INLINE-1 + convenção SEC).
3. **`calendario` + `tagIdSql`** — testar ambos os caminhos (com/sem `tag_id`); o `household_id` combina com `and`, não quebra o fragment opcional (Ponto Crítico 5 / T6.3).
4. **Sem `db:migrate`** — AC11 é explícito: 104 policies intactas, nenhuma migration nova.
5. **`briefing/route.ts` + `BriefingWidget`** — stubs sem DB, NÃO tocar.

— Pax, equilibrando prioridades 🎯
