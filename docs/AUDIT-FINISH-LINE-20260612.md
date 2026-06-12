# Auditoria Finish-Line — Expressia (meu-jarvis)

**Data:** 12/06/2026
**Objectivo:** inventário completo e verificado do que falta corrigir para considerar o projecto terminado (MVP usável em produção).
**Método:** quality gates corridos hoje na máquina + 2 sweeps exaustivos de código (UI/frontend e integrações/infra) + cruzamento com os 7 handoffs pending e a auditoria estratégica de 11/06 (`CORE-STATE-AUDIT-20260611.md`).

---

## 1. Estado verificado hoje (12/06)

| Gate | Resultado |
|------|-----------|
| `pnpm lint` | EXIT 0 |
| `pnpm typecheck` | EXIT 0 |
| `pnpm test` | 9/10 packages verdes; web **1099/1100** — o único fail é o flaky pré-existente do calendário (`tarefas/calendario/__tests__/page.test.tsx` — "renderiza WeekViewClient…", erro `connection refused` PGRST500 em mock) |
| Suite RLS (db-test, Testcontainers) | 39 ficheiros verdes contra Postgres 16 real |

Correcções de 11/06 confirmadas em `main`: **P1** (formulário completo de criar tarefa, `798aeb9`), **W1** (saldo computado on-read, `f27bbb5`), **W2** (revalidação de /visao, `84fdcbe`), **OBS-2** (chat aceita hora, `2ad4a09`).

A fundação (multi-tenancy RLS, auth, cérebro AI, 27 tabelas/120+ policies, CI) está fechada e provada. O que falta é **finito e maioritariamente frontend**.

---

## 2. O que falta — priorizado

### A. CORE — UI desligada com backend pronto (o que faz o produto parecer incompleto)

Cada item é trabalho de horas; o backend (API/tools do chat) já existe em todos.

| # | Gap | Ficheiro | Nota |
|---|-----|----------|------|
| A1 | Finanças/Variáveis: botão "+ Nova" (registar transacção) `disabled` | `apps/web/src/app/(app)/financas/variaveis/page.tsx:125-132` | Só via Jarvis |
| A2 | Finanças/Património: "+ Nova conta" `disabled` | `apps/web/src/app/(app)/financas/patrimonio/page.tsx:83-90` | FUP-4.9.A; nem o chat cria contas — único fluxo sem workaround completo |
| A3 | Finanças/Cartões: "+ Novo" `disabled` | `apps/web/src/app/(app)/financas/cartoes/page.tsx:85-92` | Só via Jarvis |
| A4 | Finanças/Recorrentes: "+ Nova" `disabled` | `apps/web/src/app/(app)/financas/recorrentes/page.tsx:118-125` | Só via Jarvis |
| A5 | Kanban: "+ Nova" `disabled` | `apps/web/src/app/(app)/tarefas/kanban/page.tsx:156-160` | Reutilizar o `NewTaskModal` que a Lista já usa (P1) |
| A6 | EditTaskModal: "Atribuir a" é placeholder textual | `apps/web/src/app/(app)/tarefas/_components/EditTaskModal.tsx:97` | Backend já aceita `assigned_to_user_id`; relevante para a proposta família-first |

Falta também **editar/eliminar transacção via UI** nas vistas de finanças (read-only hoje) — confirmar âmbito ao atacar A1.

### B. Validação e dados (pendente, humano)

| # | Item | Fonte |
|---|------|-------|
| B1 | Executar smoke A1–E3 em prod (checklist + ground-truth prontos) — pontos críticos: B2 (degradação graceful do dado cross-tenant) e C1 (regressão W1) | handoff `mj-handoff-qa-smoke-financas-household-ready-20260612` |
| B2 | Limpar as 2 transacções de Maio com `account_id` de outro household (dado sujo de seed legado; decisão de 11/06 foi "registar, limpar depois") | memória `cross_tenant_legacy_transactions` |

### C. Provisionamento de produção (owner Eurico — minutos cada)

| # | Item | Impacto sem isto |
|---|------|------------------|
| C1 | **GAP-4 Inngest**: `INNGEST_EVENT_KEY` + `INNGEST_SIGNING_KEY` na Vercel | ALTA — recorrências (tarefas e finanças) e cleanup de reverse-ops **nunca correm em prod**; 3 jobs prontos e provados localmente |
| C2 | **GAP-2 Resend**: chave + rota de envio de email nos convites | BAIXA — convite por link manual funciona (D-6.7.3) |
| C3 | Follow-ups antigos: `SITE-URL-PROD`, `FU-LOGIN-NEXT`, cleanup de test users | menor |

### D. Limpeza técnica e housekeeping

| # | Item |
|---|------|
| D1 | `apps/web/vercel.json` declara cron `/api/cron/daily` que **não existe** (404 diário na Vercel) — remover a entrada; os 3 jobs usam cron nativo Inngest (D38 KISS) |
| D2 | Corrigir ou quarentenar o flaky do calendário (único vermelho da suite) |
| D3 | Mover stories stale de `docs/stories/active/` (1.1, 1.2, 1.3, 6.1, SEC-6 — concluídas há semanas) e triar os 7 handoffs pending (vários >7 dias = stale por regra; ex.: 1.7-post-deploy é de 08/05) |
| D4 | Decidir destino de `packages/db/src/scripts/smoke-baseline.ts` (untracked — commitado parcialmente como helper em `d945a9b`; confirmar estado) |

### E. Polish adiável (não bloqueia "terminado")

- Filtro por etiqueta no Kanban (`KanbanFilterBar.tsx:51-58` — Story 3.6).
- Widget Briefing é stub `available:false` (`lib/visao/queries.ts:375-382`).
- Edição de roles de membros do household (convidar/listar/remover já funciona).
- Criação inline no calendário só com título+data (o "+ Nova" completo cobre o resto).
- Story 5.10 (responsive sweep + Lighthouse + FUP-5.3.C/D middleware) — última do Epic 5.
- Dashboards/alertas Grafana + smoke Sentry pós-deploy (handoff 1.7).

### F. Congelado por directiva — NÃO tocar sem ordem do Eurico

- **Billing/Stripe** (directiva 29/05): schema existe, zero rotas — continua congelado.
- **SEC-8 / Fatia D Cérebro AI**: HOLD até Adenda §12 do @architect (withHousehold em transacções multi-tool).

---

## 3. Definição de "terminado" proposta

O MVP está terminado quando: **A1–A6 ligados** (toda a criação básica funciona por botão, não só por chat) + **B1 smoke PASS** + **C1 Inngest em prod** (recorrências vivas) + **B2/D1/D2** limpos. Tudo o resto é polish ou está congelado por decisão.

Estimativa honesta: A1–A6 são ~4–6 sessões de implementação directa (padrão `NewTaskModal` já estabelecido pelo P1); B/C/D são acções pontuais. Não há incógnitas técnicas abertas.
