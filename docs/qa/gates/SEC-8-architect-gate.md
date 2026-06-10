# SEC-8 — Architect Gate (adversarial, padrão SEC-1→7)

- **Story:** SEC-8 — Cérebro AI: RLS enforced em runtime no `executeAtomic` (ADR-003 Fase 4 Fatia D)
- **Gate por:** Aria (@architect) — gate adversarial independente (verificação byte-a-byte, varredura própria)
- **Data:** 10/06/2026
- **Input:** Ready for Review v1.0-DEV (@dev Dex, 09/06/2026), 10/10 ACs MET
- **Git baseline:** `aadbf31` (origin/main); nada commitado/pushed

---

## VEREDICTO: **PASS** — confiança **9,6/10** (Alta)

SEC-8 fecha **genuinamente** a Fase 4 do ADR-003 no ponto de escrita mais sensível do sistema (o cérebro AI / `executeAtomic`). A correcção é cirúrgica e **package-level**: troca-se *quem abre a transação* (de `ctx.db.transaction` para um `txRunner` injectado que em produção é `(fn) => withHousehold({userId, householdId}, fn)`), sem tocar no corpo do loop, sem migration, sem transação-sobre-LLM. A 2.ª rede (RLS viva) está **empiricamente provada** contra Postgres real; a 1.ª rede (app-enforced) está **intacta por git diff**. Story → **Done v1.1-ARCH-APPROVED**.

> Nota de reconciliação de memória: o índice interno registava SEC-7 como "fecha Fase 4 em TODOS os domínios". Correcção: SEC-7 fechou os domínios de **route** (Finanças/Tarefas/Visão/Household em `apps/web`); **SEC-8 é a última fatia real** — o cérebro AI / `executeAtomic` (package-level). Só com SEC-8 PASS a Fase 4 está completa.

---

## Resultado dos 7 focos do gate adversarial

| # | Foco | Resultado | Prova |
|---|------|-----------|-------|
| 1 | **AC9 não-tautológico (a prova da 2.ª rede)** | **MET** | db-test 206/206 verde contra Postgres real; AC9 4/4. Log mostra `PostgresError` real (`Tool 'ac9_insert_task' execute() threw: PostgresError`, traceId `ac9-neg-tasks`) → rejeição é RLS, não filtro app/constraint. Contra-prova admin insere a MESMA row tasks(B) com sucesso (bypass RLS) → não-tautologia. Seed prova-se discriminante: `seedTwoHouseholds` faz userA membro de A **apenas** → `is_household_member(B)` genuinamente falso sob claims A. Cobre `tasks` E `agent_reverse_ops` (predicado real `is_household_member`). Asserções `countTasks()==0`/`countReverseOps()==0` falhariam se a RLS estivesse inerte. |
| 2 | **Ponto crítico 2 (production-only path)** | **MET** | `executor.ts`: `db: this.txRunner ? TX_RUNNER_DB_PLACEHOLDER : this.dbResolver()`. Com `txRunner` (produção, sem `dbResolver`), `this.dbResolver()` **nunca** é invocado → `defaultDbResolver` (que lança) nunca dispara. Placeholder lança ruidosamente nos 3 métodos (defense-in-depth). Provado por 3 testes novos em `executor.test.ts` (sucesso sem `dbResolver`; precedência sobre `dbResolver`; placeholder intocado). |
| 3 | **Salto aditivo (loop byte-idêntico)** | **MET** | `git diff HEAD` de `atomic.ts`: única mudança = import de `TxRunner` + param `txRunner?` + `runTransaction = txRunner ?? ((fn) => ctx.db.transaction(fn))` + comentários. `ctxWithTx` e corpo do loop **não aparecem no diff** (byte-idênticos). Teste case-3 backward-compat confirma `ctx.db.transaction` ainda abre 1× sem `txRunner`. |
| 4 | **Fronteira de packages (agnóstica)** | **MET** | grep `@meu-jarvis/db` em `packages/tools/src` + `packages/planner-executor/src`: **zero `import`** — todos os matches são comentários/docstrings que explicam "NÃO importa". `TxRunner` é `<T>(fn) => Promise<T>` agnóstico; `withHousehold` injectado por DI só no route. |
| 5 | **1.ª rede (app-enforced) intacta** | **MET** | `git diff` confirma: filtros `household_id` das tools/orquestração inalterados; só os 2 instanciadores de `Executor` mudaram (`dbResolver`→`txRunner`). `withHousehold` é aditivo. |
| 6 | **Diff-zero em incrementQuota + undo + orquestração** | **MET** | `git diff --name-only`: `audit-log.ts` e `undo/route.ts` **ausentes** do changed-set. Nos routes, os únicos diffs são os 2 `new Executor`. Orquestração (idempotency/rate-limit/quota/audit/accountContext/user_prefs/plan) continua `getDb()`. `getServiceDb` no path = só comentários (D50 incrementQuota por referência). |
| 7 | **Comentário `atomic.ts:19-26` corrigido (AC6=DoD)** | **MET** | Bloco "RLS (NFR5)" antigo afirmava falsamente "o `tx` herda o role do cliente raiz — RLS continua activa". Substituído pela verdade pós-SEC-8: tx aberta por `txRunner` (`SET LOCAL ROLE authenticated`+claims → policies activam genuinamente; default backward-compat documentado; predicado real `is_household_member`). Bullet "Atomicidade" também actualizado. |

**Verificações adversariais além do catálogo do @dev:**
- **Apenas 2 `new Executor(` em produção** (prompt:557, confirm:222) — grep confirma zero 3.º instanciador.
- **Par de auth idêntico (invariante de segurança load-bearing):** prompt `txRunner {userId: user.id, householdId}` ≡ `executor.execute {householdId, userId: user.id}`; confirm `txRunner {run.user_id, run.household_id}` ≡ `executor.execute {run.household_id, run.user_id}`. A sessão RLS scopa **exactamente** o household dos inserts. `confirm` deriva auth da **run persistida**, nunca do request.
- **REQ-INLINE-1:** `withHousehold` importado de `@/lib/agent/db-shim` nos 2 routes (nunca directo de `@meu-jarvis/db`).

---

## Gates re-executados independentemente (não confiando nos números do @dev)

| Gate | Resultado | Exit |
|------|-----------|------|
| `pnpm typecheck` | 10/10 (FULL TURBO) | 0 |
| `pnpm lint` | No ESLint warnings or errors | 0 |
| `pnpm check:rls` | 20 tabelas cobertas | 0 |
| `pnpm --filter @meu-jarvis/tools test` | **354 passed** (20 files) | 0 |
| `pnpm --filter @meu-jarvis/planner-executor test` | **72 passed** (7 files) | 0 |
| `pnpm --filter @meu-jarvis/db-test test` | **206 passed** (38 files, incl. **AC9 4/4**) — Postgres real Testcontainers | 0 |
| `pnpm --filter @meu-jarvis/web test` | **1079/1080** (1 flaky calendário pré-existente) | 1* |
| `pnpm build` | 10/10 | 0 |
| `db:migrate` | **NÃO corrido** (zero migration — 104 policies intactas) | — |

\* O único fail web é `tarefas/calendario/__tests__/page.test.tsx` (timeout 5000ms sob carga da suite completa) — **isolado passa 5/5 em ~1,4s**. Flaky pré-existente (padrão SEC-3→7), **não tocado por SEC-8** (zero ficheiros calendário/tarefas-UI no diff). Não é regressão.

---

## Observações não-bloqueantes (housekeeping)

1. **Docstring `DbResolver` ligeiramente stale** (`executor.ts:62`): "em produção é `getDb()`" — pós-SEC-8, em produção passa-se `txRunner`, não `dbResolver`. NÃO é violação de AC6 (que visa `atomic.ts:19-26`, esse corrigido) nem comentário enganador num path de segurança — `DbResolver` continua mecanismo legítimo de testes/fallback. Cosmético. Pode ser afinado num housekeeping futuro; não bloqueia.
2. **ADR-003 agora existe como ficheiro físico** (`docs/adr/ADR-003-rls-enforced-runtime-hardening.md`, +131 linhas Adenda §12) — resolve a observação registada no SEC-7 gate (ADR sem ficheiro). Deve ir no commit de fecho do @devops.

---

## Decisões ratificadas

- **D-12A (default backward-compat):** RATIFICADA. `txRunner ?? ((fn) => ctx.db.transaction(fn))` mantém testes legacy verdes sem reescrita; salto provadamente aditivo.
- **D-12B (auth no closure do txRunner, não no ctx):** RATIFICADA. O par `{userId, householdId}` vive no closure montado no route; `ToolExecutionContext` inalterado.
- **D-12C (undo + incrementQuota service_role):** RATIFICADA. Diff-zero confirmado; trigger de imutabilidade `trg_agent_runs_immutability` justifica a excepção permanente.

---

## Próximo passo

`@devops *push` — commit único de fecho (fast-forward, sem `--force`/`--no-verify`, CodeRabbit SKIP, **SEM `db:migrate`**), incluindo OBRIGATORIAMENTE além do código+story: a Adenda §12 do ADR-003, a nota Fase 0 (`docs/db-specialist-review-sec8-fase0-20260609.md`), o `HANDOFF-INDEX` e o housekeeping dos handoffs SEC-8. Ver `docs/handoffs/mj-handoff-sec8-architect-to-devops-20260610.yaml`.
