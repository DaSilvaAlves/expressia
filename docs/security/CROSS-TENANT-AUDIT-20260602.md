# Auditoria de Isolamento Cross-Tenant — Expressia (meu-jarvis)

**Data:** 2026-06-02
**Origem:** SMOKE-6.7 (ACHADO-2) → investigação @architect + @data-engineer → auditoria exaustiva (security-reviewer)
**Severidade:** **CRITICAL** (vazamento cross-tenant activo em produção, incl. dados financeiros/bancários)
**Estado:** confirmado empiricamente · remediação app-enforced aprovada pelo Eurico (segurança primeiro)

---

## Causa raiz (confirmada empiricamente)

A RLS multi-tenant está **INERTE em runtime**. Não por falta de policies (as 27 tabelas de domínio têm `FORCE ROW LEVEL SECURITY` + 4 policies cada — 104 policies, tudo correcto no SQL), mas porque **o `getDb()` (`packages/db/src/client.ts`) liga como role `postgres`, que tem `rolbypassrls=TRUE`**. `rolbypassrls` no role **vence** o `FORCE RLS` na tabela → as policies nunca são avaliadas.

**Prova:** a connection runtime, com `current_household_id()=NULL`, vê todos os households cross-tenant (`households→8, tasks→9, transactions→3, accounts→8…`). Com RLS viva veria 0.

**Consequência:** o isolamento depende HOJE inteiramente de filtros `where household_id` explícitos em cada query. Qualquer query de domínio sem esse filtro = vazamento (LEAK) ou IDOR.

**Porque os gates passaram:** `db-test` (Testcontainers) liga com role sem bypassrls e simula claims JWT → ali a RLS aplica-se. `check-rls-coverage` só valida que as policies *existem* no SQL, nunca que são *aplicadas* em runtime.

---

## Totais

| Categoria | Contagem |
|-----------|----------|
| Queries auditadas | ~120 |
| SEGURA | ~50 |
| **VULNERÁVEL-LEAK** (listagem sem `household_id`) | **16** |
| **VULNERÁVEL-IDOR** (`[id]` sem `household_id`) | **25+** |
| N/A — job global (`getServiceDb`, legítimo) | 8 |
| **Achado novo — SQL injection** (`setHouseholdContext`) | 1 (MEDIUM) |
| Ambiguidade — `accept_invite` (= ACHADO-1) | 1 |

---

## Checklist de remediação — VULNERÁVEL-LEAK (16)

| # | Ficheiro | Linha | Tabela | Fix |
|---|----------|-------|--------|-----|
| L1 | `lib/api-helpers/list-tasks.ts` | 168 | tasks | `WHERE tasks.household_id = ${householdId}::uuid` |
| L2 | `api/tags/route.ts` | 77 | tags | `WHERE household_id = ${auth.householdId}::uuid` |
| L3 | `api/tags/route.ts` | 61 | tags (with_counts) | `WHERE tags.household_id = ${auth.householdId}::uuid` |
| L4 | `api/kanban-columns/route.ts` | 80 | kanban_columns | `WHERE household_id = ${auth.householdId}::uuid` |
| L5 | `api/financas/contas/route.ts` | 67 | accounts | `AND household_id = ${auth.householdId}::uuid` |
| L6 | `api/financas/cartoes/route.ts` | 101 | cards | `AND household_id = ${auth.householdId}::uuid` |
| L7 | `api/financas/transacoes/route.ts` | 175 | transactions | `AND household_id = ${auth.householdId}::uuid` |
| L8 | `api/financas/categorias/route.ts` | 96 | categories | `AND (household_id = ${auth.householdId}::uuid OR household_id IS NULL)` — globais ficam visíveis |
| L9 | `api/financas/recorrencias/route.ts` | 126 | recurrences | `AND household_id = ${auth.householdId}::uuid` |
| L10 | `api/financas/prestacoes/route.ts` | 88 | installments | `AND household_id = ${auth.householdId}::uuid` |
| L11 | `api/recurrences/route.ts` | 76 | task_recurrences | `AND household_id = ${auth.householdId}::uuid` |
| L12 | `lib/visao/queries.ts` | 138,168,176,207,249,281,306 | tasks/transactions/recurrences/accounts | filtro `household_id` nas 7 queries (aceitar `householdId` param) |
| L13 | `api/agent/prompt/route.ts` | 134,140 | accounts, cards | `WHERE household_id = ${householdId}::uuid AND archived_at IS NULL` |

## Checklist de remediação — VULNERÁVEL-IDOR (25+)

Todos os handlers `[id]` filtram por `WHERE id = ${id}::uuid` sem `AND household_id`. Adicionar `AND household_id = ${auth.householdId}::uuid` a cada SELECT/UPDATE/DELETE.

| # | Ficheiro | Linhas | Tabela |
|---|----------|--------|--------|
| I1 | `api/tasks/[id]/route.ts` | 52, 141, 202 | tasks |
| I2 | `api/tasks/[id]/move/route.ts` | 79, 92, 109, 119, 162 | tasks, kanban_columns |
| I3 | `api/tasks/[id]/tags/route.ts` | 65 | tasks+tags |
| I4 | `api/tasks/[id]/tags/[tagId]/route.ts` | 46 | task_tags |
| I5 | `api/tags/[id]/route.ts` | 75, 148 | tags |
| I6 | `api/kanban-columns/[id]/route.ts` | 91, 142, 191, 266, 276, 308, 321, 327 | kanban_columns, tasks |
| I7 | `api/financas/contas/[id]/route.ts` | 75, 147, 220 | accounts |
| I8 | `api/financas/cartoes/[id]/route.ts` | 76, 152, 234 | cards |
| I9 | `api/financas/transacoes/[id]/route.ts` | 90, 149, 169-192, 219, 288, 309 | transactions, accounts, cards, categories |
| I10 | `api/financas/categorias/[id]/route.ts` | 76, 144, 182, 250 | categories |
| I11 | `api/financas/recorrencias/[id]/route.ts` | 87, 145, 155-179, 221, 293 | recurrences, accounts, cards, categories |
| I12 | `api/financas/prestacoes/[id]/route.ts` | 81, 126, 138, 142 | installments, transactions |
| I13 | `api/recurrences/[id]/route.ts` | 56, 115, 174, 232 | task_recurrences |

## Achado novo — SQL injection em `setHouseholdContext`

`packages/db/src/client.ts:97` — `set_config('app.current_household_id', '${householdId}', true)` por interpolação de string. MEDIUM (actualmente não chamado em rotas de produção, mas exportado). Fix: parametrizar via `sql\`... set_config(..., ${householdId}, true)\``.

## Ambiguidade — `accept_invite` (= ACHADO-1)

`api/conta/household/aceitar-convite/route.ts:103` chama `accept_invite(${token})` via `getDb()`; a função depende de `auth.uid()` = NULL → falha. Já mapeado como ACHADO-1 (fix: `p_user_id` explícito, migration 0022). Tratar no fio da Story 6.7, depois do hotfix de segurança.

---

## Notas para a remediação

- O `householdId` legítimo é resolvido por `resolveHouseholdId()` (`apps/web/src/lib/api-helpers/auth.ts`) via Supabase JS client (PostgREST, com JWT) — essa via é segura e já está disponível em todos os handlers.
- Os **INSERTs estão seguros** (injectam `${auth.householdId}` nos values). O perigo concentra-se em SELECT/UPDATE/DELETE.
- **Categorias:** caso especial — globais (`household_id IS NULL`) devem permanecer visíveis a todos; o fix mantém `OR household_id IS NULL`.
- **Jobs Inngest** (`getServiceDb`) iteram todos os households por design — legítimos, mas confirmar que agrupam por household.

## Teste de garantia (gate NFR5 hardening)

Adicionar ao `@meu-jarvis/db-test` um teste que liga como o **mesmo role do runtime** (`getDb()`, postgres/bypassrls), tenta ler uma tabela de domínio de OUTRO household e assercione **0 rows** (ou que a rota devolve 403/404). Hoje o gate prova que a fechadura existe; falta provar que está trancada.

## Hardening posterior (RLS-enforced — defense-in-depth)

Repor a RLS viva em runtime: `getDb()` ligar como role `authenticated` (sem bypassrls) com `request.jwt.claims` injectado por request. Nuance crítica: pgbouncer transaction-mode (porta 6543) exige `set local role` + `set local request.jwt.claims` dentro de transação por request — design a cargo de @architect + @data-engineer.
