# Story SEC-8: Cérebro AI — RLS enforced em runtime no `executeAtomic` (2.ª rede, ADR-003 Fatia D)

> **ID:** `SEC-8` (segurança transversal — Fase 4 do ADR-003, Fatia D — Cérebro AI). Story cross-epic, não pertence a epic numerado.
> **Depende de:** SEC-2 (Done) — wrapper `withHousehold` + gate de aplicação; SEC-3/4/5/6/7 (Done) — domínios Finanças, Tarefas, Visão/SSR e Household já RLS-enforced. SEC-8 é a **última fatia** que fecha a Fase 4 do ADR-003.
> **Contrato de design:** ADR-003 **Adenda §12** (@architect Aria, 09/06/2026) — ACs canónicos em §12.8; mapa de fronteiras em §12.3. **Ler a §12 na íntegra antes de implementar — é o contrato.**
> **Gate Fase 0 (DURO, §12.7):** @data-engineer (Dara) executou e deu **GO GLOBAL** — `docs/db-specialist-review-sec8-fase0-20260609.md`. As 6 tabelas de escrita do `executeAtomic` têm cobertura write completa; **sem migration nova**.
> **Handoff de origem (consumido):** `docs/handoffs/archive/mj-handoff-sec8-adenda12-kickoff-20260609.yaml`.

## Status

**Done v1.1-ARCH-APPROVED (@architect Aria, 10/06/2026 — gate adversarial PASS 9,6/10).** Os 7 focos MET por verificação byte-a-byte independente; AC9 **empiricamente provado** (db-test 206/206 contra Postgres real, `PostgresError` real no log, contra-prova admin não-tautológica). Ponto crítico 2 confirmado (`TX_RUNNER_DB_PLACEHOLDER` → `defaultDbResolver` nunca dispara em produção). Salto aditivo confirmado por git diff (loop byte-idêntico). Fronteira de packages intacta (zero `import @meu-jarvis/db` em tools/planner-executor). Par de auth idêntico nos 2 routes (sessão RLS scopa o household dos inserts). Diff-zero em undo/incrementQuota/orquestração. **Fecha a Fase 4 do ADR-003** (cérebro AI = última fatia). Gate file: `docs/qa/gates/SEC-8-architect-gate.md`. Próximo: `@devops *push` (commit de fecho com Adenda §12 + nota Fase 0 + INDEX + housekeeping handoffs — ver `mj-handoff-sec8-architect-to-devops-20260610.yaml`). **Sem `db:migrate`.**

> _Implementação @dev Dex (09/06/2026, v1.0-DEV): `TxRunner` injectado abre a tx de `executeAtomic`; produção monta `withHousehold` nos 2 instanciadores de `Executor`. Salto aditivo (D-12A) — testes existentes verdes sem reescrita. Sem migration._

> _Validação @po Pax (09/06/2026 — GO 10/10): byte-a-byte contra código real + ADR-003 §12 + nota Fase 0; nenhum PO-FIX._

> _Mudança package-level (≠ SEC-3..7 que eram migrações de route em apps/web). Salto puramente aditivo (D-12A: `txRunner` opcional com default backward-compat) → testes existentes de `executeAtomic`/`Executor` passam sem reescrita. Provável QA Loop próprio (§12.10 passo 3)._

---

## Executor Assignment

```
executor: "@dev"
quality_gate: "@architect"
quality_gate_tools: ["lint", "typecheck", "test", "build", "check:rls"]
```

## Story

**As a** engenheiro/product owner da Expressia,
**I want** que a transação de escrita de domínio do cérebro AI — o loop de `executeAtomic` (`packages/tools/src/atomic.ts`), por onde passam **todas** as mutações das tools (`tasks`, `transactions`, `recurrences`, `cards`, `installments`) e o INSERT de `agent_reverse_ops` — seja aberta por um **`txRunner` injectado** que, em produção, é `(fn) => withHousehold({ userId, householdId }, fn)`, activando a RLS viva em runtime (2.ª rede) **exactamente no ponto de escrita mais sensível do sistema**, mantendo o filtro `household_id` app-enforced (1.ª rede, SEC-1) intacto,
**so that** o cérebro AI passe a ter a mesma defense-in-depth de duas redes que os domínios Finanças (SEC-3/4), Tarefas (SEC-5), Visão/SSR (SEC-6) e Household (SEC-7) já têm — **completando a Fase 4 do ADR-003** — sem transação-sobre-LLM, sem migration SQL (104 policies intactas) e sem tocar em billing (CONGELADO).

---

## Contexto e âmbito

### O problema (ADR-003 §12.1, lido no código)

Toda a escrita de domínio do cérebro é **canalizada por `executeAtomic`** (`atomic.ts:118-326`), que hoje abre a transação via `ctx.db.transaction(...)` (`atomic.ts:124`), onde `ctx.db` é o `getDb()` resolvido no route (role `rolbypassrls`). **Logo as 104 policies estão inertes exactamente no ponto de escrita mais sensível** — e o cabeçalho `atomic.ts:19-26` afirma falsamente que "RLS continua activa dentro da transacção". A correcção é cirúrgica e **package-level**: trocar *quem abre a transação*, não o corpo do loop.

### Três factos que moldam o desenho (§12.1, não assumidos)

1. **Transação-sobre-LLM é proibida.** `POST /api/agent/prompt` encadeia idempotency → rate-limit → quota → `insertAgentRun` → Classifier (OpenAI) → Planner (Anthropic) → Executor no mesmo `db`. Envolver o route inteiro em `withHousehold` seguraria uma transação Postgres aberta durante segundos de round-trips LLM, esgotando a pool pgbouncer transaction-mode. **A transação tem de nascer e morrer dentro do `executeAtomic`, depois das chamadas LLM.**
2. **A injecção de DB já existe — é o ponto de entrada do fix.** O `Executor` recebe `dbResolver: () => DrizzleDbClient` no constructor (`executor.ts:65-89`) e o route passa `() => db` (`prompt/route.ts:550`, `confirm/route.ts:215`). É aqui que se troca um *resolver de cliente* por um *runner de transação RLS-enforced*.
3. **`apps/web` já tem `withHousehold` ao alcance.** `db-shim.ts:79-88` exporta `withHousehold({ userId, householdId }, fn)` via require lazy. O package `@meu-jarvis/tools`/`@meu-jarvis/planner-executor` **continua a NÃO importar `@meu-jarvis/db`** (fronteira intacta) — a ligação faz-se por **injecção de dependência a partir do route**.

### O que já existe (não reimplementar)

- `withHousehold<T>(auth, fn)` em `packages/db/src/client.ts:119-153` (`pgSql.begin` → `SET LOCAL ROLE authenticated` + `set_config('request.jwt.claims', {sub,household_id,role}, true)` + GUC). Re-exportado por `db-shim.ts:79`. **Assinatura: `withHousehold({ userId, householdId }, (tx) => …)`.**
- `Executor` (`packages/planner-executor/src/executor.ts:82-160`) — `ExecutorOpts.dbResolver`; constrói `ctx.db = this.dbResolver()` (L145) e chama `executeAtomic(atomicInputs, ctx)` (L151).
- `executeAtomic(tools, ctx)` (`atomic.ts:118`) — abre tx em `ctx.db.transaction(...)` (L124); `ctxWithTx` (L127-133) substitui só `db: tx`; loop validar→execute→reverse→INSERT `agent_reverse_ops` (L137-261).
- Harness RLS real `asUser(userId, householdId, fn)` (`packages/db-test/src/rls-harness.ts:322`) — replica **exactamente** a mecânica do `withHousehold` (mesmo `SET LOCAL ROLE` + claims). É a base do teste AC9.

### Superfície SEC-8 — o que muda

| # | Ficheiro | Mudança | Notas |
|---|----------|---------|-------|
| 1 | `packages/tools/src/atomic.ts` | Novo tipo `TxRunner`; `executeAtomic` abre a tx via `txRunner` em vez de `ctx.db.transaction`; **corrigir comentário falso L19-26** | Corpo do loop e `ctxWithTx` **inalterados** (§12.2). Default backward-compat `(fn) => ctx.db.transaction(fn)` (D-12A) |
| 2 | `packages/planner-executor/src/executor.ts` | `ExecutorOpts` ganha `txRunner?`; `Executor` propaga-o a `executeAtomic`; `dbResolver` mantido como fallback ou removido (decisão @dev) | Nunca resolver `getServiceDb()` (NFR5) |
| 3 | `apps/web/src/app/api/agent/prompt/route.ts` | `new Executor({ dbResolver: () => db })` (L550) → injectar `txRunner: (fn) => withHousehold({ userId: user.id, householdId }, fn)` | `user.id` (L233/L554) + `householdId` (var local, L239/L553) |
| 4 | `apps/web/src/app/api/agent/prompt/[runId]/confirm/route.ts` | `new Executor({ dbResolver: () => db })` (L215) → injectar `txRunner: (fn) => withHousehold({ userId: run.user_id, householdId: run.household_id }, fn)` | auth vem da **run persistida** (L218-219) — **o MESMO par que `executor.execute` já recebe** |

> O @dev localiza cada call-site pela função/símbolo, não por offset rígido. Os offsets são guia de navegação, não contrato de linha.

### Excepções permanentes — NÃO migrar (§12.3, §12.5)

| Bloco | Cliente que MANTÉM | Razão |
|-------|--------------------|-------|
| `incrementQuota` (`audit-log.ts`) | **`getServiceDb()`** | D50 — RLS bloqueia `agent_quotas` a authenticated. Excepção permanente. |
| `undo/route.ts:182-200` (aplica reverse_ops + `agent_runs.status='reverted'`) | **`getServiceDb()`** | D-12C — trigger de imutabilidade `trg_agent_runs_immutability` bloqueia a transição terminal a authenticated. `withHousehold` aqui seria errado e inútil. **NÃO reescrever a atomicidade do undo nesta story.** |
| idempotency / rate-limit / quota check (`prompt/route.ts:239-296`) | `getDb()` app-enforced | Leituras curtas de orquestração, fora da tx longa. Diff zero. |
| `insertAgentRun` / `updateAfter*` (audit, `audit-log.ts`) | `getDb()` app-enforced | Audit log; INSERT permitido a authenticated. Não é escrita de domínio. Diff zero. |
| `buildAccountContext`, `user_prefs`, `households.plan` (`prompt/route.ts:129-164,316-341`) | `getDb()` app-enforced | Leituras de metadados com filtro explícito. Diff zero. |
| `executeDirectQuery` (cost-router, read-only) | `getDb()` app-enforced | Read-only `consultar_dados`; sem escrita, sem reverse_op. Fora de âmbito. |

**Regra de ouro de SEC-8:** o `withHousehold` entra **só** à volta do loop de `executeAtomic`. Tudo o resto mantém o cliente que tem hoje. App-enforced (filtro `household_id`, SEC-1) **permanece em todo o lado**.

### Nota Fase 0 @data-engineer (informativa — incorporada nos ACs/testes)

- **Predicado real corrigido:** o WITH CHECK de `agent_reverse_ops` é **`is_household_member(household_id)`**, NÃO `household_id = current_household_id()` (o pressuposto §12.7-2 estava errado). Mais robusto; passa na mesma sob os claims do `withHousehold`. **Qualquer AC/teste deve assumir `is_household_member(household_id)`.**
- As 6 tabelas (`tasks`, `transactions`, `recurrences`, `cards`, `installments`, `agent_reverse_ops`) têm cobertura write completa ancorada em `is_household_member(household_id)`.
- **Nota A:** `cards` DELETE é owner/admin (`is_household_owner_or_admin`); irrelevante para SEC-8 (caminho forward de `create_card` é INSERT `is_household_member` ✓; o undo de cards corre service_role).
- Nenhum trigger de imutabilidade e nenhuma SECURITY DEFINER no caminho do `executeAtomic` mascara a RLS.

---

## Acceptance Criteria

> Sementes canónicas em ADR-003 §12.8. Numeração 1:1 com a Adenda.

### AC1 — `executeAtomic` abre a transação via `txRunner` injectado (default backward-compat)

`packages/tools/src/atomic.ts`: novo tipo exportado `export type TxRunner = <T>(fn: (tx: DrizzleDbClient) => Promise<T>) => Promise<T>;`. `executeAtomic` deixa de chamar `ctx.db.transaction(...)` (L124) e passa a abrir a tx via um `txRunner`. **D-12A:** o `txRunner` é opcional; o **default preserva o comportamento actual** — `(fn) => ctx.db.transaction(fn)`. O `ctxWithTx` (L127-133, `db: tx`) e o corpo do loop (L137-261, incl. o INSERT `agent_reverse_ops` L244-250) **não mudam uma linha** — muda só quem abre a transação. **NUNCA** resolve para `getServiceDb()` (NFR5).

### AC2 — `Executor` aceita `txRunner` no `ExecutorOpts` e propaga-o a `executeAtomic`

`ExecutorOpts` (`executor.ts:65-76`) ganha `readonly txRunner?: TxRunner`. O `Executor` guarda-o e passa-o a `executeAtomic`. **D-12B:** o `auth` que o `withHousehold` precisa vive no **closure do `txRunner`** montado no route — **não** se adiciona `auth` ao `ToolExecutionContext` (o `householdId`/`userId` já lá estão para as colunas dos inserts). O `dbResolver` mantém-se como fallback do default **ou** é removido (decisão de implementação @dev), **nunca** resolvendo `getServiceDb()`. Se `txRunner` for fornecido, o `Executor` não deve disparar o `defaultDbResolver` que lança erro (`executor.ts:236`) — ver Dev Notes ponto 2.

### AC3 — `prompt/route.ts` **e** `confirm/route.ts` instanciam `Executor` com `txRunner` via `db-shim`

Os **dois** instanciadores de `Executor` (e só os dois — confirmado por grep: `prompt/route.ts:550` + `confirm/route.ts:215`; @dev re-confirma que não há 3.º) migram de `new Executor({ dbResolver: () => db })` para:

```typescript
// prompt/route.ts
const executor = new Executor({
  txRunner: (fn) => withHousehold({ userId: user.id, householdId }, fn),
});
// confirm/route.ts — auth vem da run persistida (o MESMO par já passado a executor.execute)
const executor = new Executor({
  txRunner: (fn) => withHousehold({ userId: run.user_id, householdId: run.household_id }, fn),
});
```

`withHousehold` importado de `@/lib/agent/db-shim` (REQ-INLINE-1 — nunca directo de `@meu-jarvis/db`). O par `{ userId, householdId }` do `txRunner` **tem de ser idêntico** ao que `executor.execute({ householdId, userId, … })` já recebe no mesmo route (prompt: `user.id`/`householdId`; confirm: `run.user_id`/`run.household_id`) — sob pena de a sessão RLS scopar um household diferente do dos inserts.

### AC4 — Orquestração permanece `getDb()` app-enforced (diff zero)

idempotency, rate-limit, quota check, `insertAgentRun`/`updateAfter*` (audit), `buildAccountContext`, `user_prefs`, `households.plan` **mantêm `getDb()`** — **diff zero** nesses blocos (§12.3). `withHousehold` entra **só** à volta do loop de `executeAtomic`.

### AC5 — `incrementQuota` e `undo` permanecem `getServiceDb()` (diff zero)

`incrementQuota` (D50) e `undo/route.ts` (D-12C — trigger de imutabilidade) **mantêm `getServiceDb()`** — **diff zero**. A atomicidade do `undo` **não é reescrita** nesta story.

### AC6 — Comentário `atomic.ts:19-26` corrigido para a realidade pós-SEC-8 (parte do DoD)

O bloco "RLS (NFR5)" de `atomic.ts:19-26` passa a descrever a verdade: a transação é aberta por `txRunner` (default `withHousehold` em produção) que faz `SET LOCAL ROLE authenticated` + claims → **as policies activam genuinamente dentro da transação**; o filtro `household_id` app-enforced mantém-se como 1.ª rede. **A story falha o DoD se este comentário não for corrigido** — comentário enganador num path de segurança é dívida activa, não cosmética.

### AC7 — App-enforced (1.ª rede) mantido; `withHousehold` é aditivo

O filtro `household_id` explícito existente nas queries das tools e na orquestração **mantém-se inalterado** — `withHousehold` é a 2.ª rede, nunca substitui a 1.ª. Nenhum ficheiro passa a usar `getServiceDb()` indevidamente (grep: zero introduções no caminho do `executeAtomic`).

### AC8 — Atomicidade (FR2), reverse_op + janela undo 30s (FR6) e rollback automático inalterados

A semântica transaccional (multi-intent atómico, INSERT `agent_reverse_ops` com `expires_at = now() + interval '30 seconds'`, rollback automático no throw de qualquer tool) **mantém-se exactamente igual** — provada pelos testes de integração existentes (`packages/tools/src/__tests__/atomic.test.ts`), que passam **sem reescrita** graças ao default backward-compat (D-12A).

### AC9 — Teste de integração RLS: escrita cross-household REJEITADA pelo Postgres (o AC que prova a 2.ª rede)

**Novo teste em `@meu-jarvis/db-test` (Testcontainers, Postgres real)** — o teste-gémeo de `atomic.test.ts` mas com a RLS **realmente activa**:

- **Negativo (a prova):** com `txRunner` a abrir a transação como `authenticated` + claims do household A (mecânica de `rls-harness.ts:322` `asUser`/`withHousehold`), uma tool a tentar escrever `household_id` do household B é **rejeitada pelo Postgres** (`/row-level security|new row violates/i`) — **não** pelo filtro app. Cobre ≥1 tabela de domínio (ex.: `tasks` ou `transactions`) **e** o INSERT de `agent_reverse_ops` (predicado real `is_household_member(household_id)`).
- **Positivo (não-regressão):** mesma operação no household A (claims A) **sucede** e persiste o `agent_reverse_ops`.
- **Não-tautológico:** os dados/IDs do household B são semeados via admin (bypass RLS) e a rejeição prova-se sob a sessão `authenticated` — o teste falharia se a RLS estivesse inerte (réplica do rigor SEC-3/5/7 em `rls-application.test.ts`).

### AC10 — Gates de qualidade TODOS VERDES; sem migration

`pnpm lint` · `pnpm typecheck` · `pnpm test` (incl. `@meu-jarvis/tools`, `@meu-jarvis/planner-executor`, `apps/web` e `@meu-jarvis/db-test` Docker) · `pnpm build` · `pnpm check:rls` — todos exit 0. **Sem migration SQL nova** (104 policies intactas — NÃO correr `db:migrate`; a Fase 0 §12.7 deu GO sem lacuna de policy).

---

## Tasks / Subtasks

- [x] **T1 — `packages/tools/src/atomic.ts`: `TxRunner` + abertura de tx via runner + comentário** (AC1, AC6, AC8)
  - [x] T1.1 `export type TxRunner = …` adicionado em `contracts.ts` (lar canónico dos contratos) + exportado de `@meu-jarvis/tools` via `index.ts`.
  - [x] T1.2 `executeAtomic(tools, ctx, txRunner?)` abre a tx via `runTransaction = txRunner ?? ((fn) => ctx.db.transaction(fn))` (D-12A). `ctxWithTx` e corpo do loop **inalterados**.
  - [x] T1.3 Comentário `atomic.ts:19-26` (+ bullet "Atomicidade") corrigido para a realidade pós-SEC-8 (AC6).
  - [x] T1.4 `__tests__/atomic.test.ts`: 16 testes verdes (default backward-compat intacto) + 3 casos novos `txRunner` (usa o runner, não `ctx.db.transaction`; loop recebe o tx do runner; default path sem txRunner).

- [x] **T2 — `packages/planner-executor/src/executor.ts`: propagar `txRunner`** (AC2, AC7)
  - [x] T2.1 `ExecutorOpts` ganha `readonly txRunner?: TxRunner`; `Executor` guarda-o e passa-o a `executeAtomic(atomicInputs, ctx, this.txRunner)`. `dbResolver` mantido como fallback (nunca `getServiceDb()`).
  - [x] T2.2 Com `txRunner` presente, `ctx.db = TX_RUNNER_DB_PLACEHOLDER` (não pré-resolve `dbResolver()`) → `defaultDbResolver` **não** dispara no caminho production-only. Placeholder falha ruidosamente se tocado.
  - [x] T2.3 `executor.test.ts`: 12 existentes verdes (default path) + 3 casos novos `txRunner` (propagação; placeholder seguro; precedência sobre dbResolver).

- [x] **T3 — `apps/web/src/app/api/agent/prompt/route.ts`: injectar `txRunner`** (AC3, AC4, AC7)
  - [x] T3.1 `new Executor({ txRunner: (fn) => withHousehold({ userId: user.id, householdId }, fn) })`. `withHousehold` de `@/lib/agent/db-shim`.
  - [x] T3.2 Diff zero na orquestração (idempotency/rate-limit/quota/audit/accountContext/user_prefs/plan continuam `getDb()`).
  - [x] T3.3 `route.test.ts`: mock `db-shim` expõe `withHousehold`; 25 testes verdes.

- [x] **T4 — `apps/web/src/app/api/agent/prompt/[runId]/confirm/route.ts`: injectar `txRunner`** (AC3, AC4, AC7)
  - [x] T4.1 `new Executor({ txRunner: (fn) => withHousehold({ userId: run.user_id, householdId: run.household_id }, fn) })`. Par idêntico ao já passado a `executor.execute`.
  - [x] T4.2 Grep confirmou **apenas 2** instanciadores de `Executor` em produção (`prompt:557` + `confirm:222`); zero 3.º.
  - [x] T4.3 `confirm.test.ts`: mock `withHousehold`; 8 testes verdes.

- [x] **T5 — `incrementQuota` + `undo` permanecem `getServiceDb()` (confirmar diff zero)** (AC5)
  - [x] T5.1 `audit-log.ts` (`incrementQuota`) e `undo/route.ts` **não tocados** (diff zero). Cabeçalho do `undo/route.ts` já documenta a excepção D-12C (NFR9 — trigger imutabilidade) — não foi necessário acrescentar.

- [x] **T6 — Teste de integração RLS (db-test) — AC9** (AC9)
  - [x] T6.1 Novo `packages/db-test/src/tests/executeAtomic.rls.test.ts`: positivo (mesma-household sucede + persiste `tasks` + `agent_reverse_ops`) + negativo `tasks` (cross-household rejeitado pelo Postgres) + negativo `agent_reverse_ops` (reverse_op household B sob claims A rejeitado) + contra-prova admin (não-tautológico). `txRunner` replica `withHousehold` (drizzle sobre `adminSql` + `SET LOCAL ROLE authenticated` + claims). 4/4 verdes.

- [x] **T7 — App-enforced 1.ª rede preservada + zero `getServiceDb` no caminho** (AC7)
  - [x] T7.1 Queries das tools e orquestração inalteradas (filtro `household_id` intacto). Zero introduções de `getServiceDb()` no caminho do `executeAtomic` (só os 2 instanciadores mudaram: `dbResolver`→`txRunner`).

- [x] **T8 — Quality gates** (AC10)
  - [x] T8.1 `pnpm lint` ✓ · T8.2 `pnpm typecheck` ✓ · T8.3 `pnpm test` ✓ (tools 354 · planner-executor 72 · web 1079/1080 [1 flaky calendário pré-existente, isolado 5/5 ✓] · db-test 206 incl. AC9 4/4) · T8.4 `pnpm build` ✓ · T8.5 `pnpm check:rls` ✓ — todos exit 0. **Sem `db:migrate`.**

---

## Dev Notes

### Referências-chave (leitura obrigatória)

| Recurso | Localização | Porquê |
|---------|-------------|--------|
| **Contrato de design** | `docs/adr/ADR-003-…md` §12 (íntegra) — §12.2 contrato, §12.3 mapa de fronteiras, §12.8 ACs | É a fonte de verdade. Não re-decidir; traduzir |
| Gate Fase 0 (GO) | `docs/db-specialist-review-sec8-fase0-20260609.md` | Cobertura RLS confirmada; predicado real `is_household_member(household_id)` |
| `executeAtomic` (alvo) | `packages/tools/src/atomic.ts:118-326` (tx L124; loop L137-261; INSERT reverse_op L244-250; comentário falso L19-26) | Só muda quem abre a tx |
| `Executor` (propagação) | `packages/planner-executor/src/executor.ts:65-160` (ExecutorOpts L65; ctx L142-148; executeAtomic L151; defaultDbResolver L236) | Ponto de injecção |
| `withHousehold` (shim) | `apps/web/src/lib/agent/db-shim.ts:79-88` · `packages/db/src/client.ts:119-153` | Assinatura `{ userId, householdId }`; mecânica `SET LOCAL ROLE`+claims |
| Instanciadores de `Executor` | `prompt/route.ts:550` · `confirm/route.ts:215` (os 2 únicos) | Onde se monta o closure do `txRunner` |
| Harness RLS real (AC9) | `packages/db-test/src/rls-harness.ts:322` (`asUser`) + `tests/agent_reverse_ops.rls.test.ts` + `tests/rls-application.test.ts` | Mecânica idêntica a `withHousehold`; padrão de rejeição cross-household |

### Pontos críticos

1. **Só muda quem abre a transação.** O corpo do loop de `executeAtomic` (validar→execute→reverse→INSERT `agent_reverse_ops`) e o `ctxWithTx` (`db: tx`) **não mudam**. Resistir à tentação de refactor.
2. **`defaultDbResolver` lança erro (`executor.ts:236`).** Com `txRunner` fornecido, o `Executor` **não pode** invocar `this.dbResolver()` cegamente (L145) — isso dispararia o throw em produção (onde já não se passa `dbResolver`). Estruturar para: se `txRunner` presente, não pré-resolver `db` para abrir a tx (o `executeAtomic` abre via runner). O `ctx.db` deixa de ser necessário para abrir a tx; se algum código ainda o exigir, fornecer um resolver inofensivo ou ajustar a construção do `ctx`. Decisão de implementação @dev (D-12A), mas **typecheck + testes têm de cobrir o caminho de produção (só `txRunner`)**.
3. **`confirm` deriva auth da run persistida, não do request.** Usar `{ userId: run.user_id, householdId: run.household_id }` (idêntico ao par já passado a `executor.execute`). Um membro diferente do household a confirmar continua a passar `is_household_member(run.household_id)` — correcto. **Nunca** misturar identidade do request com household da run.
4. **Fronteira de packages intacta.** `@meu-jarvis/tools`/`@meu-jarvis/planner-executor` **continuam a NÃO importar `@meu-jarvis/db`**. O `TxRunner` é um tipo agnóstico (`(fn) => Promise`); o `withHousehold` concreto só é conhecido no route (apps/web), injectado por DI. Não introduzir import de `@meu-jarvis/db` nos packages.
5. **Predicado RLS real = `is_household_member(household_id)`** (não `current_household_id()`). Qualquer asserção/comentário de teste deve usar o predicado real (correcção da Fase 0).
6. **Default backward-compat é a rede de segurança dos testes.** Os testes de `atomic.test.ts`/`executor` que injectam `DrizzleDbClient` mockado devem passar **sem reescrita** — se algum falhar, o salto deixou de ser aditivo (sinal de regressão de desenho, não de teste).

### REQ-INLINE-1

Nos ficheiros de `apps/web`, `getDb`, `getServiceDb`, `withHousehold` e `sql` vêm **sempre** de `@/lib/agent/db-shim`, **nunca** directamente de `@meu-jarvis/db`/`@meu-jarvis/db/client`. Parâmetros bound sempre com `${value}::uuid`, nunca concatenação de string.

### Fronteiras — o que SEC-8 NÃO faz (§12.9)

- Não reescreve a atomicidade do `undo` (D-12C).
- Não mexe em `getServiceDb()`/Inngest/cost-router read-only.
- Não toca em billing (CONGELADO).
- Não centraliza orquestração numa transação longa (anti-padrão transação-sobre-LLM, §12.1).
- Não altera contratos de tools (`ToolDefinition.execute/reverse` inalterados — recebem o mesmo `ctx.db = tx`).
- Não adiciona migration (104 policies intactas — Fase 0 GO sem lacuna).

### Convenções

Imports `@/` absolutos · sem `any` (`unknown` + guards) · PT-PT em comentários/erros · `prepare:false` intocado · REQ-INLINE-1 · parâmetros bound sempre (`${value}::uuid`).

### Riscos (para @architect/@qa no gate)

| Risco | Mitigação |
|-------|-----------|
| `defaultDbResolver` lança erro em produção (só `txRunner`) | Ponto crítico 2; T2.2; typecheck + teste do caminho production-only |
| `confirm` usa identidade errada (request vs run) | AC3/T4.1 explícito: `{ run.user_id, run.household_id }` = par de `executor.execute` |
| Salto deixa de ser aditivo (testes existentes partem) | D-12A default backward-compat; T1.4/T2.3; ponto crítico 6 |
| Import de `@meu-jarvis/db` introduzido nos packages | Ponto crítico 4; `TxRunner` agnóstico; grep no gate |
| AC9 tautológico (RLS não realmente exercitada) | T6.1 dados de B via admin; rejeição sob `authenticated`; padrão `rls-application.test.ts` |
| Orquestração migrada por engano (transação-sobre-LLM) | AC4/AC5 diff zero; mapa de fronteiras §12.3; grep `getDb`/`getServiceDb` antes/depois |
| 3.º instanciador de `Executor` esquecido | T4.2 grep confirmatório |
| Comentário falso `atomic.ts:19-26` não corrigido | AC6 é DoD; @architect confirma por leitura |

---

## Testing

| Camada | Ferramenta | Ficheiros |
|--------|-----------|-----------|
| `executeAtomic` (atomicidade + txRunner) | Vitest node (`@meu-jarvis/tools`) | `packages/tools/src/__tests__/atomic.test.ts` (default backward-compat + caso txRunner mock) |
| `Executor` (propagação txRunner) | Vitest node (`@meu-jarvis/planner-executor`) | testes do `executor.ts` (default path + txRunner mock) |
| Routes do cérebro (contrato) | Vitest node (`apps/web`) | `api/agent/prompt/__tests__/*`, `api/agent/prompt/[runId]/confirm/__tests__/*` (mock `withHousehold`) |
| **Gate RLS real (2.ª rede — AC9)** | Vitest + Testcontainers (`db-test`) | `packages/db-test/src/tests/executeAtomic.rls.test.ts` (novo) ou extensão de `rls-application.test.ts` |
| Gate estático | `pnpm check:rls` | — |

---

## CodeRabbit Integration

> **CodeRabbit Integration**: Disabled — sem `coderabbit_integration` em `core-config.yaml`. Validação via @architect adversarial gate (padrão SEC-1→7). Dado o carácter package-level e de segurança, o gate @qa/@architect foca especialmente o AC9 (prova RLS-enforced) e o ponto crítico 2 (production-only path).

---

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (1M context) — @dev Dex (YOLO/autónomo).

### Completion Notes

- **Salto puramente aditivo (D-12A) confirmado:** o 3.º parâmetro `txRunner?` de `executeAtomic` e o default `(fn) => ctx.db.transaction(fn)` mantêm os 16 testes de `atomic.test.ts` e os 12 de `executor.test.ts` verdes **sem uma linha reescrita**. O corpo do loop e o `ctxWithTx` ficaram byte-idênticos (só mudou quem abre a tx).
- **Ponto crítico 2 resolvido (production-only path):** o `Executor` deixou de pré-resolver `ctx.db = this.dbResolver()` quando `txRunner` está presente — usa `TX_RUNNER_DB_PLACEHOLDER` (satisfaz o tipo, lança se tocado). Em produção (só `txRunner`, sem `dbResolver`), o `defaultDbResolver` que lança **nunca** dispara. Provado por 3 testes novos no `executor.test.ts` (sucesso = placeholder/defaultResolver intocados).
- **AC9 — desvio de implementação registado:** o `txRunner` do teste replica a mecânica de `withHousehold` construindo o cliente Drizzle sobre `adminSql` (que expõe `.options`) e abrindo a tx via `db.transaction()` do Drizzle, com `SET LOCAL ROLE authenticated` + `set_config(request.jwt.claims)` **dentro** da tx. A 1.ª tentativa (`drizzle(pgTx)` sobre a `TransactionSql` crua do `begin()`) falhou com `Cannot read properties of undefined (reading 'parsers')` — a `TransactionSql` não expõe `.options` ao driver postgres-js do Drizzle. A semântica RLS é idêntica (mesmos `SET LOCAL`). Prova genuína: log mostra `PostgresError` real na rejeição cross-household; contra-prova admin confirma não-tautologia.
- **Predicado real `is_household_member(household_id)`** (correcção Fase 0 §12.7-2) assumido em todo o AC9 — nenhuma asserção usa `current_household_id()`.
- **Fronteira de packages intacta:** `@meu-jarvis/tools`/`@meu-jarvis/planner-executor` continuam a NÃO importar `@meu-jarvis/db` (typecheck cross-package verde). `TxRunner` é agnóstico; `withHousehold` injectado por DI do route via `db-shim` (REQ-INLINE-1).
- **Sem migration** (104 policies intactas); `db:migrate` NÃO corrido (AC10). Billing intocado (CONGELADO).
- **Flaky pré-existente:** `tarefas/calendario/__tests__/page.test.tsx` excede 5000ms sob carga da suite web completa (1079/1080); isolado passa 5/5 em ~1,9s. Não tocado por SEC-8 (padrão documentado SEC-3→7).

### File List

**Modificados (código de produção):**
- `packages/tools/src/contracts.ts` — novo `export type TxRunner`.
- `packages/tools/src/index.ts` — re-export de `TxRunner`.
- `packages/tools/src/atomic.ts` — `executeAtomic(tools, ctx, txRunner?)`; abre tx via runner (default backward-compat); comentário `L19-26` + bullet "Atomicidade" corrigidos (AC6).
- `packages/planner-executor/src/executor.ts` — `ExecutorOpts.txRunner?`; campo + propagação a `executeAtomic`; `TX_RUNNER_DB_PLACEHOLDER`; comentários de cabeçalho + `defaultDbResolver` actualizados.
- `apps/web/src/app/api/agent/prompt/route.ts` — import `withHousehold`; `new Executor({ txRunner: … })`.
- `apps/web/src/app/api/agent/prompt/[runId]/confirm/route.ts` — import `withHousehold`; `new Executor({ txRunner: … })` (auth da run persistida).

**Modificados (testes):**
- `packages/tools/src/__tests__/atomic.test.ts` — import `TxRunner`; describe novo "txRunner injectado (SEC-8)" (3 casos).
- `packages/planner-executor/src/__tests__/executor.test.ts` — describe novo "txRunner (SEC-8)" (3 casos).
- `apps/web/src/app/api/agent/prompt/__tests__/route.test.ts` — `withHousehold` no mock do `db-shim`.
- `apps/web/src/app/api/agent/prompt/__tests__/confirm.test.ts` — `withHousehold` no mock do `db-shim`.

**Criados:**
- `packages/db-test/src/tests/executeAtomic.rls.test.ts` — AC9 (4 testes, Testcontainers Postgres real).

---

## Change Log

| Data | Versão | Descrição | Autor |
|------|--------|-----------|-------|
| 2026-06-09 | 1.0-DEV | **Implementação (@dev Dex) — Ready for Review.** `TxRunner` (contracts.ts) + `executeAtomic(…, txRunner?)` com default backward-compat (D-12A). `Executor.txRunner` + `TX_RUNNER_DB_PLACEHOLDER` resolve o ponto crítico 2 (production-only path, `defaultDbResolver` não dispara). 2 routes injectam `withHousehold` via db-shim (prompt: `user.id`/`householdId`; confirm: par da run persistida). Comentário falso `atomic.ts:19-26` corrigido (AC6/DoD). AC9 novo em db-test (Testcontainers): escrita cross-household REJEITADA pelo Postgres em `tasks` + `agent_reverse_ops` (predicado real `is_household_member`), positivo + contra-prova admin não-tautológica — 4/4. `incrementQuota`+`undo` diff zero (AC5); orquestração `getDb()` diff zero (AC4). Fronteira de packages intacta (tools não importa db). 6 testes-suite + lint + typecheck + build + check:rls verdes (1 flaky calendário pré-existente, isolado 5/5). Sem migration. 10/10 ACs MET. | Dex (@dev) |
| 2026-06-09 | 0.1 (Ready) | **Validação @po (Pax) — GO 10/10, Draft→Ready.** Verificação byte-a-byte contra código real: (1) `confirm/route.ts:218-219` confirma auth da run persistida = par do `txRunner` (AC3); (2) `executor.ts:145` resolve `db` eagerly + `defaultDbResolver` (L234-240) lança erro → ponto crítico 2 / AC2 / T2.2 cobrem o caminho production-only; (3) `WithHouseholdAuth = {userId, householdId}` e fronteira de packages intacta (DI via `db-shim`); (4) só 2 instanciadores de `Executor` (`prompt:550` + `confirm:215`). Comentário falso `atomic.ts:19-26` confirmado (AC6 = DoD). Fase 0 GO GLOBAL + predicado real `is_household_member(household_id)` incorporado (AC9, ponto crítico 5). Nenhum PO-FIX. Executor assignment válido (@dev≠@architect, work-type code/security consistente). CodeRabbit Disabled com skip notice correcto. | Pax (@po) |
| 2026-06-09 | 0.1 | Draft inicial — ADR-003 Fase 4 Fatia D (Cérebro AI). `executeAtomic` (`atomic.ts`) passa a abrir a transação via `TxRunner` injectado; em produção `(fn) => withHousehold({userId,householdId}, fn)` montado nos 2 instanciadores de `Executor` (`prompt/route.ts:550` + `confirm/route.ts:215`). D-12A default backward-compat `(fn) => ctx.db.transaction(fn)` (salto aditivo, testes intactos). D-12B auth no closure (não no ctx). D-12C undo + incrementQuota permanecem service_role (excepções permanentes — diff zero). Orquestração permanece getDb() app-enforced (§12.3). Comentário falso `atomic.ts:19-26` corrigido (DoD, AC6). AC9: teste de integração RLS em db-test (Testcontainers) prova escrita cross-household REJEITADA pelo Postgres (harness `asUser`, predicado real `is_household_member(household_id)` — correcção Fase 0). Fronteira de packages intacta (tools NÃO importa db). Sem migration (Fase 0 GO global, 104 policies intactas). Billing CONGELADO. | River (@sm) |

---

> **Próximo passo:** `@po *validate-story-draft SEC-8`. Sequência §12.10: @po → @dev (`*develop`, provável QA Loop — mudança package-level) → @qa (`*qa-gate`, foco AC9) → @devops (`*push`, **incluir a Adenda §12 do ADR-003 — ainda não-commitada — no commit de fecho**).
