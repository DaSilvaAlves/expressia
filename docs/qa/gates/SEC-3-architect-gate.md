# SEC-3 — Architect Quality Gate (Aria)

```yaml
storyId: SEC-3
title: 'RLS enforced em runtime — Fase 2 domínio Finanças (12 route handlers)'
gate: '@architect (Aria)'
gate_type: adversarial-security
date: 2026-06-02
verdict: PASS
score: 9.6
iteration: 'gate inicial (fresh adversarial review da execução; ADR-003 autoria prévia minha)'
status_recommendation: 'Done v1.1-ARCH-APPROVED'
model: claude-opus-4-8[1m]
adr: 'ADR-003 (Fase 2) — autoria minha; este gate é revisão adversarial da EXECUÇÃO, não do design'
acs_met: '9/9 (AC1-AC9)'
dev_decisions_ratified: '3/3 (D-SEC3.1, D-SEC3.2, D-SEC3.3)'
po_fix_honoured: 'PO-FIX-2 (insertAuditLog FORA do withHousehold) — verificado em 8/8 handlers de mutação'
po_obs_implemented: 'PO-OBS (gate estendido a accounts + categories globais) — D-SEC3.1'
```

## Veredicto resumido

**PASS — 9,6/10. Confiança ALTA.**

A Fase 2 do ADR-003 migra os 12 route handlers `/api/financas/*` de `getDb()` → `withHousehold(auth, fn)`, adicionando a 2.ª rede (RLS viva em runtime) ao domínio mais sensível do produto — sem remover a 1.ª rede (filtro `household_id` app-enforced, SEC-1). A migração é mecanicamente fiel ao template canónico `tasks/route.ts` (SEC-2) e — o que mais importa — o gate de aplicação real foi estendido (D-SEC3.1) para provar o ÚNICO ponto onde a policy diverge do template: as categorias globais (`OR household_id IS NULL`).

Escrevi o ADR-003 numa invocação anterior. Isso **não** me tornou complacente: a varredura foi adversarial sobre a execução. Fiz a minha própria varredura (greps independentes, leitura byte-a-byte dos blocos críticos, comparação com a baseline `e5f84db`), não confiei na tabela do @dev. Os 8 focos de segurança que defini estão limpos. O desconto de 0,4 é preventivo (2 observações não-bloqueantes — ver OBS); ligeiramente menor que o de SEC-2 porque a mecânica `withHousehold` já estava provada na Fase 1 e o @dev fechou o único risco residual (leak de globais) por sua iniciativa.

---

## Gates re-corridos (números reais, esta sessão — Docker UP)

| Gate | Resultado | Evidência |
|------|-----------|-----------|
| `pnpm lint` | **PASS** exit 0 | 10/10 tasks, FULL TURBO; "No ESLint warnings or errors" |
| `pnpm typecheck` | **PASS** exit 0 | 10/10 tasks; web compilou — confirma que o fix TS7034 (`const sets: ReturnType<typeof sql>[] = []` em `recorrencias/[id]`) passa strict sem `any` |
| `pnpm --filter @meu-jarvis/web test` | **PASS** funcional | 1068 pass / 1 flaky pré-existente (`tarefas/calendario/page.test.tsx` timeout 5000ms — RSC de calendário, ZERO relação com finanças/`withHousehold`) |
| ↳ finanças isoladas | **PASS** | nenhum dos 107 testes de `api/financas/*/__tests__` falhou; o único fail é fora do âmbito da story |
| `pnpm --filter @meu-jarvis/db-test test` | **PASS** | 36 ficheiros / 181 testes (era 175; +6 da PO-OBS); Testcontainers Postgres 16 efémero com migrations prod 0000+0001 + role `authenticated` real |
| ↳ `rls-application.test.ts` | **PASS 15/15** | 2947ms; 9→15 (accounts 3 + categories globais 3); inclui a prova load-bearing de leak de globais |
| `pnpm build` | **PASS** exit 0 | `.next` limpo antes (gotcha conhecido); 10/10 tasks |
| `pnpm check:rls` | **PASS** exit 0 | 104 policies intactas; 6 tabelas de finanças cobertas (accounts, cards, categories, recurrences, installments, transactions) |

Sem migration SQL nova — confirmado (working tree a partir de `e5f84db`: só os 12 handlers + 12 testes + `rls-application.test.ts` + docs de handoff).

---

## Focos de segurança adversariais (re-corridos para REFUTAR)

| # | Foco | Resultado | Evidência (independente, não a tabela do @dev) |
|---|------|-----------|-------------------------------------------------|
| 1 | App-enforced MANTIDO (zero filtro removido) | **✓ LIMPO** | Grep `household_id` sobre os 12 handlers: TODAS as queries SELECT/INSERT/UPDATE/DELETE e sub-queries FK mantêm `household_id = ${auth.householdId}::uuid`. `OR household_id IS NULL` intacto nas categorias GET (`categorias/route.ts:93`, `[id]:87`) e sub-queries FK de categoria (`transacoes:276`, `prestacoes:173`, `recorrencias:213`, `categorias:171`). Filtro estrito (sem `OR NULL`) nas mutações de categorias (`[id]:197,288`) — D-SEC1.1 globais read-only preservado |
| 2 | service_role intocado | **✓ LIMPO** | Grep `getServiceDb` em `api/financas`: **No matches found**. Todos importam só `{ getDb, withHousehold }` de `@/lib/agent/db-shim` |
| 3 | PO-FIX-2 (insertAuditLog FORA da tx, best-effort) | **✓ LIMPO** | Nos 8/8 handlers de mutação a ordem é invariável: `const db = getDb()` → `withHousehold(...)` (op principal) → `try { insertAuditLog({ db, ... }) } catch { log.warn }`. A linha de `insertAuditLog` é SEMPRE posterior à de `withHousehold` (verificado por grep com nº de linha). O catch só faz `log.warn` — nunca propaga, nunca reverte a op principal |
| 4 | Tx aninhada D-SEC3.3 (atomicidade + ordem) | **✓ LIMPO** | `prestacoes/route.ts:182` POST: `tx.transaction(innerTx => ...)` — installment ANTES das N transactions (FK `installment_id` exige-o); resto da última parcela calculado fora (matemática pura). `prestacoes/[id]:153` DELETE: DELETE transactions ANTES de installments (comentário cita o CHECK `transactions_installment_index_coherent` via `ON DELETE set null`). O savepoint herda o contexto RLS do `outerTx` (mesma connection/tx). Provado por `installments.rls` + `prestacoes` route tests verdes |
| 5 | Early-returns D-SEC3.2 (status/msg byte-a-byte, COMMIT limpo) | **✓ LIMPO** | Callbacks devolvem tipo discriminado (`{ notFound }`/`{ error }` \| `{ row }`); o `apiError` é emitido FORA do `withHousehold`. Antes de cada early-return só correram SELECTs (zero escrita) → o COMMIT da tx só-leitura não tem efeito. Mensagens verificadas idênticas: "Conta não encontrada." / "Cartão não encontrado." / "Categoria não encontrada." (404), `GENERATED_CONFLICT` (409 em `transacoes/[id]` DELETE), "Prestação não encontrada." (404). O caso mais subtil (`transacoes/[id]` DELETE com 2 erros discriminados 404+409) preserva ambos os status codes |
| 6 | Gate de aplicação real prova leak de globais | **✓ LIMPO — prova load-bearing** | `rls-application.test.ts:215-241`: userA vê `catA` (própria per-household) + `globalId` (NULL), `expect(ids).not.toContain(catB)` (per-household de B NUNCA visível), e asserção universal `rows.every(r => r.household_id === householdA.id \|\| r.household_id === null)`. Linhas 243-251: SELECT explícito de `catB` por userA → 0 rows. Linhas 253-263: INSERT cross-household de categoria bloqueado + `count(*)=0` por admin. 15/15 verde |
| 7 | auth.uid() vivo dentro de withHousehold | **✓ LIMPO (transitivo)** | `rls-application.test.ts` usa `asUser()` de `rls-harness.ts` — a MESMA mecânica `SET LOCAL ROLE authenticated` + `set_config('request.jwt.claims', ...)` que `withHousehold` replica byte-a-byte (verificado na SEC-2, memória `sec2_gate_pattern`). As 6 tabelas de finanças têm policies `is_household_member`-based que SÓ passam com `auth.uid()` não-NULL — os 15 testes a verde provam-no |
| 8 | Atomicidade financeira não-quebrada | **✓ LIMPO** | Nenhuma operação dependia de auto-commit múltiplo: os GET puros são SELECT único; as mutações já eram atómicas (INSERT/UPDATE/DELETE únicos ou `db.transaction()` interno em prestacoes). Envolver num `withHousehold` (uma tx) não altera o comportamento — só adiciona o `SET LOCAL`. `resolveHouseholdRole` (authz de role, não dados financeiros) corre fora da tx ANTES da escrita (`contas/[id]:221`, `cartoes/[id]`), devolvendo 403 cedo — coerente com cadeia-de-pertença-antes-de-efeito |

---

## ACs (9/9)

| AC | Estado | Nota |
|----|--------|------|
| AC1 — 12 handlers → `withHousehold` | **MET** | Padrão canónico replicado; `withHousehold(auth, (tx) => ...)` em todos |
| AC2 — filtros app-enforced mantidos | **MET** | Foco 1; zero remoção, `OR NULL` intacto |
| AC3 — `getServiceDb()`/Inngest não tocados | **MET** | Foco 2; grep zero matches |
| AC4 — gate de aplicação cobre finanças | **MET (excede)** | gate estendido 9→15 (D-SEC3.1) |
| AC5 — sub-queries FK dentro da tx | **MET** | Focos 4+5; FK no mesmo `tx` |
| AC6 — semântica tx aninhada | **MET** | Foco 4; savepoint herda contexto RLS |
| AC7 — `insertAuditLog` best-effort FORA | **MET** | Foco 3; PO-FIX-2 honrado 8/8 |
| AC8 — import via `db-shim.ts` | **MET** | 12/12 `import { getDb, withHousehold } from '@/lib/agent/db-shim'` |
| AC9 — gates todos verdes | **MET** | 6/6 (flaky calendário = não-regressão) |

---

## [DEV-DECISION] — ratificação

| Decisão | Veredicto | Racional |
|---------|-----------|----------|
| **D-SEC3.1** — PO-OBS aceite, gate estendido a accounts(3) + categories globais(3) | **RATIFICADA** | Decisão de alto valor. Fecha o único risco residual da story: a policy `categories_select_global_or_member` (`OR household_id IS NULL`) é a ÚNICA que diverge do template padrão. Sem este teste, a prova de isolamento seria só da mecânica genérica; com ele, prova-se tabela-a-tabela que userA não vê per-household de B mas vê globais. Custo marginal (fixtures existiam). É exactamente o que eu recomendaria como gate-author |
| **D-SEC3.2** — retorno discriminado p/ early-returns dentro do callback | **RATIFICADA** | Correcta e necessária. Um `return NextResponse` solto dentro do callback abortaria a tx de forma ambígua (o `withHousehold` faz COMMIT/ROLLBACK em torno do callback). O tipo discriminado permite que o early-return faça `return` da tx (COMMIT de tx só-leitura, zero escrita) e converte para `apiError` fora — preservando status/mensagem byte-a-byte. Padrão limpo, type-safe (sem `any`), reusável nos próximos domínios |
| **D-SEC3.3** — tx aninhada (savepoint) em prestacoes | **RATIFICADA** | Tecnicamente sólida e alinhada com o ADR-003 §6 Fase 2. O `tx.transaction()` interno é um SAVEPOINT Postgres que herda `SET LOCAL ROLE authenticated` + claims da tx exterior — sem fuga de contexto. Atomicidade preservada (rollback total se qualquer INSERT falhar); ordem de delete (transactions antes de installments) mantida pelo CHECK constraint. Provado pelos testes de integração |

---

## OBS (não-bloqueantes)

| # | Observação | Severidade | Recomendação (futuro, não bloqueia) |
|---|-----------|-----------|-------------------------------------|
| OBS-1 | O gate de aplicação cobre accounts, transactions, categories (globais) mas ainda não cards/installments/recurrences tabela-a-tabela. A mecânica é idêntica e `check:rls` garante coverage estática das 4 policies; o risco residual é nulo (nenhuma destas tem policy divergente como categories). | LOW | Adicionar asserções para cards/installments/recurrences ao `rls-application.test.ts` numa story de hardening futura (custo marginal, fixtures existem). Puramente defensivo |
| OBS-2 | O flaky `tarefas/calendario/page.test.tsx` (timeout 5000ms) persiste há 3 stories de segurança. Não é regressão (RSC de calendário, fora do âmbito) mas é ruído recorrente no gate. | LOW | Story dedicada para estabilizar o teste (aumentar `testTimeout` para essa RSC ou mockar o data-fetch). Não afecta SEC-3 |

Ambas LOW, ambas fora do âmbito de SEC-3. Nenhuma bloqueia.

---

## Declaração de segurança (com ressalva, padrão SEC-1/SEC-2)

Após esta story, o domínio Finanças tem **defense-in-depth genuíno**: 1.ª rede app-enforced (filtro `household_id`, SEC-1) + 2.ª rede RLS viva em runtime (`withHousehold`, SEC-3). Uma query nova de finanças que esqueça o filtro app-enforced passa agora a ser apanhada pela RLS Postgres (retorna 0 rows do household errado em vez de vazar). O gate de aplicação real prova isto contra um Postgres com as policies de produção e o role `authenticated`, incluindo o caso crítico de leak de categorias globais.

**Ressalva (inalterada do ADR-003 §1.4):** o ganho RLS-em-runtime aplica-se EXCLUSIVAMENTE às rotas migradas. Os domínios ainda em `getDb()` directo (SSR pages `(app)/financas/*`, helpers `lib/finance/*`, `/api/visao/financas-*`, household `/api/conta/*`, cérebro AI `/api/agent/*`, POST `/api/tasks`) continuam protegidos APENAS pelo app-enforced até serem migrados nas stories SEC-4+. `getServiceDb()` (jobs/migrations) ignora RLS por design e permanece intocado.

---

## Veredicto final

**PASS — 9,6/10 — Done v1.1-ARCH-APPROVED.**

Story pronta para `@devops *push`. Billing continua CONGELADO (fora de âmbito).

---

*SEC-3 Architect Gate — Aria (@architect), arquitetando o futuro.*
