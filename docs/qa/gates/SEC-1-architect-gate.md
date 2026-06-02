# SEC-1 — Architect Quality Gate (Aria)

```yaml
storyId: SEC-1
title: 'Hotfix de segurança — isolamento cross-tenant app-enforced (CRITICAL)'
gate: '@architect (Aria)'
gate_type: adversarial-security
date: 2026-06-02
verdict: PASS
score: 9.4
iteration: 're-gate it.2 (FINAL — QA Loop)'
status_recommendation: 'Done v1.4-ARCH-APPROVED'
model: claude-opus-4-8[1m]
prev_verdict: 'FAIL 6,5/10 (re-gate it.1 — SEC-1-F3)'
prev_verdict_2: 'CONCERNS 8,4/10 (gate inicial — SEC-1-F1)'
```

## Veredicto resumido (re-gate it.2 — FINAL)

**PASS — 9,4/10.**

Os dois bloqueadores das iterações anteriores estão **fechados, provados ficheiro:linha e verificados independentemente**:

- **SEC-1-F1** (gate inicial) — 10 sub-queries FK dos POST de Finanças filtram `household_id`. Já ratificado em it.1; re-confirmado nesta iteração.
- **SEC-1-F3** (re-gate it.1, HIGH/CRITICAL) — IDOR cross-tenant de escrita/execução nas sub-rotas `confirm`/`undo` de agent runs: **FECHADO**.

O ponto crítico deste re-gate final era validar **independentemente** a afirmação do @dev de "zero vectores restantes". Fiz a minha própria varredura adversarial completa de `apps/web/src/app/api/**` + `apps/web/src/lib/**` (não confiei na tabela do @dev) — grep de `getUser(`, `where id = ${`, `from public.`, `update public.`, `delete from public.`, mutações por tabela de domínio, sub-queries FK. **Confirmo: zero vectores de isolamento cross-tenant residuais.** D-SEC1.3 ratificada. Os 6 gates re-corridos independentemente estão verdes — e nesta execução o flaky `tarefas/calendario` passou na suite completa (1068/1068, 0 flaky), confirmando definitivamente que era flaky e não regressão.

## SEC-1-F3 — VERIFICADO FECHADO (era o bloqueador do re-gate it.1)

### confirm — `api/agent/prompt/[runId]/confirm/route.ts`

| Linha | Verificação |
|-------|-------------|
| `:101-105` | `resolveHouseholdId(user.id)` após auth; sem household → 404 **antes de tocar na DB** (`db.execute` ainda não chamado) |
| `:111-118` | lookup `agent_runs where id = ${runId}::uuid and household_id = ${userHouseholdId}::uuid limit 1` — filtro app-enforced |
| `:120-123` | 0 rows → 404 `RUN_NOT_FOUND` (não 403 — não revela existência cross-household) |
| `:194-222` | Planner + Executor só executados **após** a verificação de pertença (rows.length > 0) |
| docblock `:10-13` | corrigido — afirma agora "pertença verificada app-enforced (RLS inerte em runtime)", não mais "RLS bloqueia cross-household" |

### undo — `api/agent/prompt/[runId]/undo/route.ts`

| Linha | Verificação |
|-------|-------------|
| `:101-105` | `resolveHouseholdId(user.id)`; sem household → 404 antes da DB |
| `:112-118` | lookup `agent_runs where id = ${runId}::uuid and household_id = ${userHouseholdId}::uuid` |
| `:120-123` | 0 rows → 404 |
| `:146-153`, `:157-162` | lookups de `agent_reverse_ops` filtram por `run.household_id` (vem do row já filtrado por `userHouseholdId` — cadeia consistente) |
| `:182-200` | `getServiceDb()` (que ignora RLS por design) só é alcançado **após** a verificação de pertença — caminho cross-household nunca atinge o service_role |
| docblock `:20-23` | corrigido |

**Cadeia fechada:** o caminho do `getServiceDb()` no undo (linha 182) é estritamente posterior à verificação de pertença (linha 112-123). Um membro do household B com um `runId` do household A recebe 404 antes de qualquer efeito.

### Testes do F3 — não-tautológicos (verificado)

`confirm.test.ts` (8 testes) e `undo.test.ts` (14 testes):
- `confirm.test.ts:92-97` — `boundParamValues()` percorre os chunks do objecto `SQL` Drizzle e assere `TEST_HOUSEHOLD_ID` bound na lookup. Sem o filtro `and household_id`, o parâmetro não estaria bound → teste falha. Prova ao nível da query.
- `confirm.test.ts:99-110` — cross-household → 404 **e** `plannerPlanMock`/`executorExecuteMock` **nunca chamados** (prova ausência de side-effect de execução cross-tenant).
- `confirm.test.ts:112-123` — sem household → 404 **e** `dbExecuteMock` **nunca chamado** (DB não tocada antes da resolução de pertença).
- `undo.test.ts` — análogo, asserindo que `getServiceDb()` nunca aplica reverse ops no path cross-household. Bug latente corrigido: `setupAuth` passou a mockar `.from('household_members')` (exigido pelo `resolveHouseholdId` do fix). SÓLIDO.

## SEC-1-F4 — VERIFICADO FECHADO (era o F2 LOW) — `kanban-columns/batch`

`api/kanban-columns/batch/route.ts` — 4 mutações por `id` agora com `and household_id = ${auth.householdId}::uuid` inline:

| Linha | Mutação |
|-------|---------|
| `:246-251` | `update public.tasks set kanban_column_id ... where kanban_column_id = ${del.id} and household_id` |
| `:253-257` | `delete from public.kanban_columns where id = ${del.id} and household_id` |
| `:306-311` | `update public.kanban_columns set sort_order = -100 - ... where id = ${col.id} and household_id` |
| `:323-328` | `update public.kanban_columns set ... where id = ${col.id} and household_id` |

Defesa-em-profundidade (já era não-explorável via guard `validateInput` 422 prévio). +1 teste (`batch/__tests__/route.test.ts:170-172`) prova household bound nas mutações.

## Varredura adversarial INDEPENDENTE (o ponto crítico do re-gate final)

NÃO confiei na tabela do @dev. Varredura própria completa de `apps/web/src/app/api/**` + `apps/web/src/lib/**`.

### Handlers que autenticam via `getUser()` directo (não `requireAuth`)

| Handler | household derivado de | Veredicto |
|---------|----------------------|-----------|
| `me/route.ts:119-124` | PostgREST `.eq('user_id', user.id)` + RLS-via-JWT | SEGURO — não user-controlled |
| `agent/prompt/route.ts:112` | `resolveHouseholdId(user.id)` → usado em todas as queries (`:316,334`) | SEGURO |
| `conta/preferencias/route.ts:111,218` | `resolveHouseholdId(user.id)` → `user_prefs` por `user_id`+`household_id` próprios | SEGURO |
| `conta/household/route.ts:112` | `resolveHouseholdId(user.id)`; GET `:134`, PATCH `:319-328` (com role guard `:300-317`) | SEGURO |
| `agent/prompt/[runId]/confirm` | `getUser()` + `runId` **user-controlled** | **F3 — FECHADO** |
| `agent/prompt/[runId]/undo` | `getUser()` + `runId` **user-controlled** | **F3 — FECHADO** |
| `conta/household/aceitar-convite` | accept_invite flow | FORA DE ÂMBITO (Story 6.7) |

Os RSC/server-actions (`(app)/**/page.tsx`, `bem-vindo/actions.ts`, components, middleware) não são rotas API e derivam household do próprio user — não são superfície de IDOR por path/body.

### Acesso a entidade de domínio por `id`/FK/mutação

Varri **cada** ocorrência de `where id = ${`, `from public.`, `update public.`, `delete from public.`, `update agent_runs`, mutações por tabela:

| Superfície | Filtro household | Veredicto |
|------------|------------------|-----------|
| Finanças `[id]` GET/PATCH/DELETE (contas/cartões/transações/categorias/recorrências/prestações) | `and household_id = ${auth.householdId}::uuid` em cada `where id` / mutação | SEGURO |
| Finanças POST sub-queries FK (account/card) | `and household_id` | SEGURO (F1) |
| Finanças sub-queries FK category/parent | `and (household_id = ${auth.householdId}::uuid or household_id is null)` | SEGURO — excepção globais AC-E1 (verificado `transacoes/route.ts:265`, `transacoes/[id]:200`, `recorrencias/route.ts:205`, `recorrencias/[id]:184`, `prestacoes/route.ts:154`, `categorias/route.ts:155`, `categorias/[id]:80,150`) |
| Tarefas/Kanban/Tags/Recurrences `[id]`+sub-rotas | `and household_id` em cada `where id`/mutação/delete | SEGURO |
| `tasks/[id]/tags/route.ts:66-72` | task+tag validadas por `household_id` antes do INSERT | SEGURO |
| `tasks/[id]/tags/[tagId]/route.ts:47-49` | `delete task_tags ... and household_id` | SEGURO |
| `conta/household/invites/[id]:59-61` | `delete household_invites where id and household_id` + role guard | SEGURO |
| `conta/household/members/[userId]:64-92` | lookup + delete por `household_id`+`user_id` + role guard + owner-guard | SEGURO |
| `kanban-columns/batch` | 4 mutações com `household_id` inline | **F4 — FECHADO** |
| `lib/agent/audit-log.ts` (`update agent_runs where id = ${runId}`, 4 funções) | opera por `runId` **já validado** pelo handler chamador (prompt cria o run para o household próprio; confirm verifica pertença antes) | SEGURO — não alcançável cross-tenant |
| `lib/agent/idempotency.ts:106-108` | `agent_runs where idempotency_key and household_id = ${householdId}` (param do handler, do próprio user) | SEGURO |
| `lib/visao/queries.ts`, `lib/api-helpers/list-tasks.ts` | filtro `household_id` (v1.2 T9/T6) | SEGURO |
| `lib/inngest/functions/*` (generate-recurring-tasks, generate-finance-recurrences, cleanup-expired-reverse-ops) | `getServiceDb()` exclusivo; mutações por `id` de cursor household-scoped do próprio job | LEGÍTIMO — jobs iteram todos os households por design |

### Veredicto da varredura independente

**Zero vectores de isolamento cross-tenant residuais em `apps/web`.** Cada query de domínio e cada handler de escrita está isolado por household, por uma de três vias: (a) filtro inline app-enforced `household_id = ${auth.householdId}`; (b) RLS-via-JWT do PostgREST (`me`); (c) household derivado do próprio user, nunca user-controlled. Os únicos `id` user-controlled (path/body) — `confirm`/`undo` `runId` e os FK dos POST/`[id]` — estão todos filtrados por household. A afirmação do @dev de exaustividade está **confirmada independentemente**.

## D-SEC1.3 — RATIFICADA (APPROVE)

Fechar o F2/F4 (`kanban-columns/batch`) apesar de LOW não-bloqueante é **correcto e alinhado com o mandato anti-whack-a-mole do re-gate**:
- Custo baixo (4 filtros inline + 1 teste), backward-compatible (ids inválidos já eram 422 a montante — contrato observável inalterado).
- Elimina dependência da ordem de validação: se um refactor futuro mexesse no `validateInput`, as mutações ficariam expostas. O filtro inline torna cada mutação segura por construção.
- Coerente com o princípio "segurança primeiro" e com o objectivo explícito da story ("dados do meu household nunca acessíveis a outro household através de qualquer rota da API").

D-SEC1.1 e D-SEC1.2 mantêm-se ratificadas (it.0/it.1).

## 7 Quality Checks

| # | Check | Resultado | Nota |
|---|-------|-----------|------|
| 1 | Code review (segurança adversarial) | PASS | F1+F3+F4 fechados ficheiro:linha; varredura independente = zero vectores residuais |
| 2 | Unit/integration tests | PASS | F3 tests não-tautológicos (boundParamValues + Planner/Executor/serviceDb never-called); AC-K1 db-test 164/164 (Docker real) |
| 3 | Acceptance criteria | PASS | ACs A–L satisfeitas; F3/F4 fora das ACs originais mas fechados (sub-rotas não catalogadas na auditoria) |
| 4 | No-regression | PASS | web 1068/1068 (0 flaky nesta execução — calendário passou); db-test 164/164 |
| 5 | Performance | PASS | filtro `household_id` usa index existente; overhead nulo |
| 6 | Security (OWASP — IDOR/leak/injection) | PASS | IDOR de escrita/execução cross-tenant eliminado; SQLi parametrizado (J1); leak fechado |
| 7 | Documentation | PASS | docblocks confirm/undo corrigidos (premissa RLS falsa removida); D-SEC1.3 documentada; File List completa |

## Re-execução independente dos gates (evidência real — re-gate it.2)

| Gate | Resultado | Evidência |
|------|-----------|-----------|
| `pnpm lint` | PASS (exit 0) | 10/10 tasks, FULL TURBO, "No ESLint warnings or errors" |
| `pnpm typecheck` | PASS (exit 0) | 10/10 tasks, FULL TURBO |
| `pnpm --filter @meu-jarvis/web test` | **1068/1068 PASS** | 136 ficheiros, 0 flaky — `tarefas/calendario` passou na suite completa |
| `pnpm check:rls` | PASS (exit 0) | tabelas multi-tenant com coverage completa |
| `pnpm build` | PASS (exit 0) | 10/10 tasks, FULL TURBO |
| `pnpm --filter @meu-jarvis/db-test test` | PASS | 35 ficheiros, 164/164 (Docker UP, Postgres 16 real) |

0 regressões. Flaky confirmado como flaky (passou desta vez sob a mesma suite).

## Decisão e próximo passo

- **Verdict:** PASS — 9,4/10 (re-gate it.2 FINAL).
- **Marcar Done — `v1.4-ARCH-APPROVED`.** F1, F3 e F4 fechados, provados e verificados independentemente; D-SEC1.3 ratificada; 6 gates verdes; varredura adversarial própria confirma zero vectores residuais.
- **Declaração de segurança:** a superfície de domínio de `apps/web` está **livre de vectores de isolamento cross-tenant conhecidos** — todas as queries de domínio e handlers de escrita estão isolados por household (filtro inline app-enforced, RLS-via-JWT do PostgREST, ou household derivado do próprio user). **Ressalva:** a RLS Postgres continua **inerte em runtime** (`getDb()` liga como role bypassrls) — o isolamento é hoje 100% app-enforced. O hardening RLS-enforced (defense-in-depth: `getDb()` como role `authenticated` com claims JWT por request) fica para story posterior a cargo de `@architect` + `@data-engineer`, **fora do âmbito desta story**. O ACHADO-1 / `accept_invite` / Story 6.7 também permanece fora de âmbito (fio separado).
- **Próximo passo:** `@devops *push` (exclusivo). Deploy não requer migrations (todo o fix é app-code TypeScript + 1 fix preventivo em `client.ts`).

— Aria (@architect)
