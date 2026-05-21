# Epic 4 — Módulo Finanças

**Status:** Validated v1.0 — 8 DPs validadas por Eurico 2026-05-20; pronto para `@sm *draft 4.1`
**Owner:** @pm (Morgan)
**Created:** 2026-05-20
**Depends on:** Epic 1 (Foundation) Done · Epic 2 (Cérebro AI) Done · Epic 3 (Módulo Tarefas) Done
**Estimated total effort:** XL (≈ 10 stories, mistura S/M/L com 1 L contida na vista mensal e 1 L nas tools)

---

## 1. Visão e Valor de Negócio

O Módulo Finanças fecha a terceira capacidade core do MVP Fase 1 — a par do Cérebro (Epic 2) e das Tarefas (Epic 3) — entregando ao utilizador português a gestão completa do dinheiro do agregado familiar: transacções variáveis, despesas recorrentes, cartões com fatura, compras parceladas, património por banco e uma vista mensal com projecção a 30 dias. Tudo em EUR com formato PT-PT correcto (`€78,70`, `€1.234,56`).

O valor competitivo vs Néctar (BR) assenta em três eixos: (1) **captura sem fricção via cérebro** — `"paguei €78,70 no supermercado com o cartão Millennium"` cria a transacção correcta associada ao cartão numa única frase, com a mesma latência e atomicidade do Epic 2; (2) **projecção real** — a vista "este mês" soma recorrentes e prestações futuras, respondendo à pergunta "quanto me sobra no fim do mês" que o Néctar não resolve; (3) **multi-tenancy família-first** — o orçamento é do household, partilhado entre os membros conforme o plano, com RLS Postgres a garantir isolamento — uma família vê as finanças da família, nunca de outra.

A vantagem é defensável porque o módulo assenta sobre fundações que o Néctar não conseguiria copiar sem refactor: schema multi-tenant com RLS por `household_id` (Epic 1), pipeline de cérebro tipado e transaccional (Epic 2), e a infra de jobs Inngest idempotentes já validada no Epic 3 (Story 3.7). Cada tool de Finanças no `toolRegistry` é tipada (Zod), corre dentro de transacções Postgres com `reverse_op` declarativo para undo, e respeita RLS — herdando integralmente o contrato do Epic 2.

## 2. Objectivo

No fim do Epic 4, um utilizador autenticado num household pode: criar e gerir contas bancárias e cartões; registar transacções variáveis e despesas recorrentes; criar compras parceladas que geram N prestações futuras; ver o património agregado por banco; consultar a vista mensal com análise por categoria/dia, total entrado vs saído e projecção dos próximos 30 dias incluindo recorrentes e prestações; e operar tudo isto também por linguagem natural via cérebro AI (`criar_financa_variavel`, `criar_financa_recorrente`, `criar_cartao`, `criar_parcelada`, `consultar_dados`) — satisfazendo as ACs do PRD §6 Epic 4 e os FR13-FR19.

## 3. Scope

### IN

- **API routes CRUD** para as 6 entidades de domínio: `accounts`, `cards`, `categories`, `transactions`, `recurrences`, `installments` — autenticadas, com RLS context, audit log e validação Zod `.strict()` (padrão Epic 3 Stories 3.1-3.2).
- **Cálculo de prestações** — criar `installments` gera N `transactions` futuras (`is_projected=true`) com `per_installment_cents` correcto incluindo resto na última parcela.
- **Geração automática** de transacções de recorrências e materialização de prestações via job Inngest cron diário — reutilizando a infra provisionada na Story 3.7 (`/api/inngest`, signing/event keys, ADR-010).
- **Vista "Este mês"** — agregações por categoria e por dia, total entrado vs total saído, projecção dos próximos 30 dias incluindo recorrentes e prestações (FR18).
- **Vista "Variáveis"** e **"Recorrentes"** — listas CRUD com filtros (FR13, FR14).
- **Vista "Cartões"** — fatura corrente e próxima fatura calculadas a partir do ciclo `closing_day`/`due_day`, prestações associadas (FR15, FR16).
- **Vista "Património"** — balanço agregado por conta/banco com drilldown (FR17).
- **Tools do cérebro Finanças** — `create_finance_variable`, `create_finance_recurrence`, `create_card`, `create_installment`, `query_finance_summary` registadas no `toolRegistry`, mapeadas em `TOOL_TO_INTENT_MAP`, com `preview`/`execute`/`reverse` (undo) e os prompts do classifier/planner actualizados.
- **Reconciliação documental** — corrigir `db-schema.md §4.6` (ver R-4.4 e DP6) e validar o schema existente contra cargas reais.
- **Categorias default PT-PT** — validar o seed existente (`migrations/seeds/0001_default_categories.sql`) e expor listagem/criação per-household via API.

### OUT (adiar para Epic posterior)

- **UI do dashboard "Visão"** (widget de balanço financeiro do mês) → Epic 5 (Web App UI — Visão e Chat). O Epic 4 entrega as páginas `/financas/*` próprias, não os widgets agregadores.
- **Chat panel e streaming SSE** → Epic 5. O Epic 4 expõe as tools e os endpoints; os pixels do chat são do Epic 5.
- **OCR de recibos / importação de extractos bancários** — fora do MVP (`mvp_scope.md`).
- **Open Banking / sincronização automática com bancos PT** — Fase 2+.
- **Multi-moeda** — EUR exclusivo (CON9, FR19).
- **Orçamentos / metas de poupança por categoria** — não está nos FR do MVP; Fase 2.
- **Relatórios anuais / export financeiro dedicado** — o export GDPR genérico (JSON+CSV) é do Epic 6; relatórios analíticos são Fase 2.
- **Conciliação bancária (matching de transacções)** — Fase 2+.

## 4. Estado Actual do Schema (pré-condição já satisfeita)

> **Achado de planeamento.** O PRD §6 Epic 4 sugeria a Story 4.1 como "criar schema de `accounts`, `cards`, `transactions`, `recurrences`, `installments`, `categories`". Verificação contra o codebase real (2026-05-20) confirma que **esse schema já foi materializado na Story 1.3** (Epic 1 bootstrap). O scope da Story 4.1 reduz-se portanto a validação + reconciliação documental, não a criação.

**O que já existe:**

| Artefacto | Estado | Localização |
|-----------|--------|-------------|
| Schema das 6 tabelas (`accounts`, `cards`, `categories`, `recurrences`, `installments`, `transactions`) | Materializado, 435 linhas | `packages/db/src/schema/finance.ts` |
| RLS — 4 policies por tabela (24 policies) | Aplicadas | `packages/db/migrations/0001_rls_policies.sql:441-533+` |
| 7 enums Postgres (`account_type`, `card_type`, `category_kind`, `transaction_kind`, `payment_method_finance`, `recurrence_freq_finance`) | Definidos | `packages/db/src/schema/finance.ts:39-76` |
| Categorias default PT-PT (seed) | Aplicado | `packages/db/migrations/seeds/0001_default_categories.sql` |
| Intents `agent_intent` para Finanças (`criar_financa_variavel`, `criar_financa_recorrente`, `criar_cartao`, `criar_parcelada`, `consultar_dados`) | No enum DB | `packages/db/src/schema/agent.ts` (db-schema §4.4) |
| Valores monetários em cêntimos (`*_cents integer`) | Confirmado | `finance.ts` — alinhado com `architecture.md:167` e `CLAUDE.md` |
| Infra Inngest (endpoint, keys, cron) | Funcional (Story 3.7, ADR-010) | `/api/inngest`, Vercel env |
| Tool Registry contract (`ToolDefinition<I,O>` com `execute`/`reverse`) | Estável desde Story 2.3 | `packages/agent/src/tools/registry.ts` |
| Padrão de tools de domínio (precedente) | Story 3.8 (tools Tarefas) | `packages/agent/src/tools/` |

**O que NÃO existe (é o trabalho do Epic 4):**

- API routes `/api/financas/*` — directório inexistente em `apps/web/src/app/api/`.
- Páginas `(app)/financas/*` — directório inexistente (`este-mes`, `variaveis`, `recorrentes`, `cartoes`, `patrimonio` previstas em `architecture.md:670-675`).
- Tools de Finanças em `packages/agent/src/tools/` — só existem tools de Tarefas (Story 3.8).
- Job Inngest de geração de transacções recorrentes/prestações de Finanças.
- Audit actions de Finanças no enum `audit.ts` — provável necessidade de nova migration.

## 5. Stories Propostas (alta-nível, ordem sugerida)

| Story | Título | Objectivo (1 frase) | Estimate | Dependências |
| ----- | ------ | ------------------- | -------- | ------------ |
| 4.1 | Validação schema Finanças + reconciliação documental | Validar as 6 tabelas + 24 policies contra o RLS gate, adicionar audit actions de Finanças (migration nova), corrigir `db-schema.md §4.6` (numeric→integer), confirmar índices da vista mensal. | S | Epic 1 (1.3, 1.4 Done) |
| 4.2 | API routes — `accounts` + `cards` | CRUD autenticado de contas e cartões com RLS context, audit log, Zod `.strict()`, cálculo de saldo de conta (ver DP1). | M | 4.1 |
| 4.3 | API routes — `transactions` variáveis + `categories` | CRUD de transacções variáveis e listagem/criação de categorias (globais + per-household), com filtros por período/categoria/conta. | M | 4.2 |
| 4.4 | API routes — `recurrences` + `installments` | CRUD de recorrências financeiras e criação de compras parceladas com cálculo de `per_installment_cents` (resto na última parcela). | M | 4.3 |
| 4.5 | Geração automática — cron Inngest Finanças | Job Inngest cron diário que materializa transacções de `recurrences` (`next_run_on <= today`) e prestações de `installments`, idempotente, reutilizando infra Story 3.7. | M | 4.4 |
| 4.6 | Vista "Este mês" — agregações + projecção 30d | Página `financas/este-mes` com análise por categoria/dia, total entrado vs saído, projecção 30 dias incluindo recorrentes e prestações (FR18). | L | 4.3, 4.4 |
| 4.7 | Vistas "Variáveis" + "Recorrentes" | Páginas `financas/variaveis` e `financas/recorrentes` — listas CRUD com filtros e formatação PT-PT via `MoneyDisplay`. | M | 4.3, 4.4 |
| 4.8 | Vista "Cartões" — fatura e prestações | Página `financas/cartoes` — fatura corrente e próxima por ciclo `closing_day`/`due_day`, prestações associadas (ver DP7). | M | 4.4 |
| 4.9 | Vista "Património" — balanço por conta | Página `financas/patrimonio` — saldo agregado por banco/conta com drilldown (FR17). | M | 4.2, 4.3 |
| 4.10 | Tools do cérebro Finanças | Registar `create_finance_variable`, `create_finance_recurrence`, `create_card`, `create_installment`, `query_finance_summary` no `toolRegistry` + `TOOL_TO_INTENT_MAP` + prompts classifier/planner v-bump. | L | 4.2, 4.3, 4.4 |

**Total estimado:** 10 stories — 1×S, 6×M, 2×L (4.6 e 4.10). Granularidade L máxima para entrega incremental, alinhada com o precedente dos Epics 2 (11 stories) e 3 (8 stories).

> Nota: 4.5 (cron) e 4.10 (tools) dependem das API routes 4.2-4.4 mas não entre si — podem paralelizar após 4.4. As vistas 4.6-4.9 dependem das routes mas são independentes entre si — paralelização leve possível após 4.4.

## 6. Riscos Macro

| ID | Risco | Probabilidade | Impacto | Mitigação proposta |
| -- | ----- | ------------- | ------- | ------------------ |
| R-4.1 | **Cálculo de prestações com resto incorrecto** — `€1.000 / 3` = €333,33×3 = €999,99, falta 1 cêntimo. Divisão inteira ingénua perde dinheiro. | Alta | Médio | Story 4.4: `per_installment_cents = floor(total/num)` para as N-1 primeiras; última parcela = `total - (N-1)*per`. Teste explícito com totais não-divisíveis (€1.000/3, €100/7). Schema já tem `per_installment_cents` separado de `total_amount_cents`. |
| R-4.2 | **Drift de saldo de conta** — `accounts.balance_cents` é coluna stored; cada transacção tem de actualizar o saldo, e undo/edição tem de reverter. Trigger mal feito ou recompute inconsistente = saldo errado. | Média | Alto | DP1 decide a estratégia (trigger vs recompute on-read). Recomendação: recompute on-read no MVP (KISS, zero drift) — `balance_cents` passa a snapshot inicial + soma de transactions. Story 4.2 implementa; teste de invariante saldo. |
| R-4.3 | **Projecção 30 dias com performance fraca** — vista mensal soma transactions reais + projecção de recorrentes + prestações; query pesada se mal indexada. | Média | Médio | Schema já tem `transactions_date_range_idx`, `transactions_projected_idx`, `recurrences_next_run_idx`. Story 4.6: EXPLAIN ANALYZE com fixture realista; budget p95 < 500ms (NFR2). Decisão de materialização em DP2. |
| R-4.4 | **Discrepância documental schema** — `db-schema.md §4.6` afirma `transactions` usa `numeric(14,2)`; o schema real (`finance.ts`) usa `integer` cents. Risco de uma story implementar contra a doc errada. | Alta (já presente) | Médio | Story 4.1 corrige `db-schema.md §4.6` para reflectir `*_cents integer`. `architecture.md:167` e `CLAUDE.md` já estão correctos. NIT documental, não bloqueia mas corrigir cedo. Ver DP6. |
| R-4.5 | **Idempotência do cron de geração** — job Inngest corre 2× (retry) e gera transacções duplicadas de uma recorrência. | Média | Alto | Story 4.5 reusa o pattern validado na Story 3.7: índice unique parcial + `ON CONFLICT DO NOTHING` na chave `(recurrence_id, transaction_date)`. ADR-010 (Inngest US) já documentado. |
| R-4.6 | **Fatura de cartão com ciclo de fecho errado** — `closing_day`/`due_day` (1-28) definem o ciclo; transacção no dia de fecho pode cair na fatura errada. | Média | Médio | DP7 decide on-the-fly vs tabela dedicada. Recomendação: cálculo on-the-fly (sem tabela `card_statements` — não existe no schema). Story 4.8: teste de fronteira de ciclo (transacção no `closing_day`, viragem de mês). |
| R-4.7 | **RLS leak via tool execute** — tool de Finanças aceita `household_id`/`account_id` arbitrário em vez de derivar do JWT. | Baixa | Crítico | Tool contract obriga `ctx.householdId` derivado do JWT (Epic 2 Story 2.3). Story 4.10 segue o pattern Story 3.8: `ctx.householdId` parametrizado + Zod strip-mode. Teste integration cross-household no harness `packages/db-test`. |
| R-4.8 | **Categorias globais vs per-household — RLS edge case** — `categories.household_id` é NULL para globais; policy `categories_select_global_or_member` tem de permitir ler globais + próprias sem leak. | Baixa | Médio | Policy já existe e foi validada no Epic 1. Story 4.3: teste explícito — household A não vê categorias custom do household B, mas ambos vêem globais. |
| R-4.9 | **Sub-utilização das tools pelo planner** — precedente NIT-DEVOPS-3.8.1: o LLM planner pode ignorar tools novas se os prompts não as mencionarem explicitamente. | Média | Médio | Story 4.10 inclui bump de versão dos prompts classifier + planner (`v2`/`v3`) com menção explícita das 5 tools de Finanças e exemplos few-shot. Sincronizar `INTENT_VALUES` + `TOOL_TO_INTENT_MAP` + testes (pattern memory `feedback_meu_jarvis_classifier_intent_values_sync.md`). |
| R-4.10 | **`transactions.amount_cents` sempre positivo + `kind`** — sinal lógico vem de `kind` (expense/income/transfer), não do valor. Agregações que somem sem respeitar `kind` dão totais errados. | Média | Alto | Story 4.6 + 4.9: agregações sempre `SUM(amount_cents) FILTER (WHERE kind='expense')` vs `income`. CHECK `transactions_amount_positive` já no schema. Teste de invariante: total entrado/saído nunca mistura sinais. |

## 7. Dependências Críticas

**Internas (Epics anteriores — todos Done):**

- **Epic 1 / Story 1.3** (Supabase + Drizzle): schema das 6 tabelas de Finanças + RLS + seed de categorias. Pré-condição já satisfeita — o Epic 4 valida e consome, não cria.
- **Epic 1 / Story 1.4** (RLS test suite): harness `packages/db-test` para testes cross-household das tabelas de Finanças.
- **Epic 1 / Story 1.7** (Observability): OTel obrigatório para instrumentar latência das routes e do cron.
- **Epic 2** (Cérebro AI): pipeline classifier→planner→executor, `toolRegistry`, contrato `ToolDefinition`, `atomic.ts` (transacção + `reverse_op`), `agent_intent` enum já com os intents de Finanças. A Story 4.10 reusa tudo.
- **Epic 3 / Story 3.7** (Inngest cron): infra Inngest provisionada e validada (endpoint, keys, ADR-010), pattern de idempotência (índice unique parcial). A Story 4.5 reusa.
- **Epic 3 / Stories 3.1-3.2** (padrões API): `requireAuth` + `resolveHouseholdId` + `resolveHouseholdRole` em `@/lib/api-helpers/auth`, `insertAuditLog` em `@/lib/api-helpers/audit`, Zod schemas `.strict()` em `@/lib/api-schemas/`. As Stories 4.2-4.4 reusam o pattern integral.
- **Epic 3 / Story 3.8** (tools Tarefas): precedente directo das tools de domínio — a Story 4.10 espelha a estrutura.

**Externas (acção Eurico/@devops):**

- **Nenhum bloqueador externo novo identificado.** As keys de LLM (Anthropic/OpenAI) e a infra Inngest já estão provisionadas (Epics 2 e 3). O cron de Finanças adiciona-se ao endpoint `/api/inngest` existente — não exige nova conta nem novas env vars.
- **Validação Eurico das DPs em §8** antes de detalhar as stories (mínimo DP1, DP2, DP7, DP8).

**Bloqueadores cross-epic:**

- O widget de balanço financeiro do dashboard "Visão" (Epic 5) **depende** das API routes deste epic. O caminho inverso é falso — o Epic 4 entrega páginas `/financas/*` próprias e não espera pelo Epic 5.

## 8. Decisões Pendentes — VALIDADAS

> **Validado por Eurico em 2026-05-20.** As 8 decisões foram revistas uma a uma e o Eurico **aceitou integralmente as 8 recomendações preliminares**. A coluna "Decisão validada" abaixo é agora a fonte de verdade para o detalhamento das stories. O bloqueio de planeamento está levantado — `@sm *draft 4.1` autorizado.

| ID | Decisão | Decisão validada (Eurico 2026-05-20) |
| -- | ------- | ------------------------------------ |
| **DP1** | Saldo de conta — stored vs computed | **A — Recompute on-read.** `accounts.balance_cents` é snapshot inicial; saldo real = inicial + `SUM` de transactions na leitura. Zero drift. |
| **DP2** | Projecção 30 dias — materializada vs on-the-fly | **C — Híbrido.** Prestações materializadas na criação do installment; recorrências projectadas on-the-fly. |
| **DP3** | Vista mensal — meses navegáveis | **B — Navegação livre** passado/futuro. Projecção futura limitada a 30 dias (FR18). |
| **DP4** | Cron — horizonte de materialização das recorrências | **A — Só o dia corrente** (`next_run_on <= today`). Consistente com o cron de Tarefas (Story 3.7). |
| **DP5** | `query_finance_summary` no MVP | **A — Incluir** na Story 4.10. FR5 é requisito do MVP; resolve-se direct-DB sem executor. |
| **DP6** | Reconciliação `db-schema.md §4.6` | **A — Story 4.1 corrige** o documento (numeric→integer cents) como parte do scope. |
| **DP7** | Fatura de cartão — on-the-fly vs tabela dedicada | **A — On-the-fly.** Cálculo a partir de `transactions` por ciclo `closing_day`/`due_day`. Sem tabela `card_statements`. |
| **DP8** | Prestações — geração de transactions na criação vs cron | **A — Na criação do installment**, atómico, na mesma transacção Postgres (`is_projected=true`). |

### 8.1 Registo das opções consideradas (histórico)

| ID | Decisão | Opções consideradas | Recomendação preliminar |
| -- | ------- | ------ | ----------------------- |
| **DP1** | **Saldo de conta — stored vs computed.** `accounts.balance_cents` existe como coluna; como mantê-la coerente? | A) Recompute on-read — `balance_cents` é snapshot inicial; saldo real = inicial + `SUM` de transactions. Zero drift, KISS. B) Trigger Postgres mantém `balance_cents` sync a cada INSERT/UPDATE/DELETE de transaction. Leitura rápida, risco de drift se trigger falhar. C) Recompute periódico via cron + leitura da coluna. | **A** para MVP. Elimina classe inteira de bugs (R-4.2). Volume de transactions por household é baixo na Fase 1; `transactions_account_idx` torna o `SUM` barato. Re-avaliar B na Fase 2 se a vista património ficar lenta. |
| **DP2** | **Projecção 30 dias — materializada vs on-the-fly.** O schema tem `transactions.is_projected boolean`. | A) On-the-fly — a vista mensal calcula a projecção em runtime a partir de `recurrences` + `installments`, sem escrever rows. B) Materializada — o cron (Story 4.5) escreve transactions `is_projected=true` para o horizonte futuro; a vista só lê. C) Híbrido — prestações materializadas (são finitas e certas), recorrências on-the-fly. | **C**. Prestações são N rows certas e finitas — materializá-las na criação do installment (Story 4.4) é natural e simplifica a vista cartões. Recorrências são potencialmente infinitas — projectá-las on-the-fly evita lixo na DB. Confirma o horizonte em DP4. |
| **DP3** | **Vista mensal — quantos meses navegáveis no MVP?** | A) Só o mês corrente (sem navegação). B) Mês corrente + navegação livre passado/futuro. C) Mês corrente + 3 meses passados + projecção do próximo. | **B**. O histórico completo já está em `transactions`; restringir navegação não poupa trabalho significativo e limita o valor. Projecção futura limita-se a 30 dias (FR18). |
| **DP4** | **Cron de geração — horizonte de materialização das recorrências.** | A) Gera só a transacção do dia (`next_run_on <= today`) — minimalista, alinha com o cron de Tarefas Story 3.7. B) Gera com horizonte de 90 dias à frente (espelha o horizonte de recorrência das Tarefas). C) Gera o mês corrente completo. | **A**. Consistência com a Story 3.7 (Tarefas gera o dia). A projecção futura da vista mensal é resolvida on-the-fly (DP2 opção C) — não precisa de rows materializadas além do dia corrente. |
| **DP5** | **`query_finance_summary` — tool no MVP ou adiar?** A consulta analítica FR5 ("como estão as minhas finanças este mês"). | A) Incluir na Story 4.10 — o cérebro responde a consultas financeiras. B) Adiar para Epic 5/Fase 2 — o Epic 4 entrega só as 4 tools de escrita. | **A**. FR5 é requisito do MVP e o `consultar_dados` resolve-se direct-DB sem executor (barato, rápido — Epic 2 §4.6). Sem isto, o cérebro cria finanças mas não as consulta — experiência incompleta. |
| **DP6** | **Reconciliação `db-schema.md §4.6`** — corrigir agora ou criar tech-debt ticket? | A) Story 4.1 corrige o documento (numeric→integer cents) como parte do scope. B) Criar ticket de tech-debt separado. | **A**. É uma correcção de 2 linhas, baixo risco, e a Story 4.1 já toca a área de schema. Deixar a doc errada arrisca uma story futura implementar contra ela (R-4.4). |
| **DP7** | **Fatura de cartão — cálculo on-the-fly vs tabela dedicada.** Não existe tabela `card_statements` no schema. | A) On-the-fly — a vista cartões calcula a fatura corrente/próxima a partir de `transactions` com `card_id` filtradas pelo ciclo `closing_day`/`due_day`. B) Criar tabela `card_statements` materializada via cron. | **A**. O schema não tem `card_statements` e o volume não justifica materialização no MVP. Cálculo on-the-fly com `transactions_card_idx`. Re-avaliar B na Fase 2 se houver histórico longo de faturas. |
| **DP8** | **Prestações — geração de transactions na criação ou via cron.** | A) Criar o installment gera as N transactions futuras imediatamente (`is_projected=true`), na mesma transacção Postgres. B) O installment guarda só a definição; o cron materializa parcela a parcela. | **A**. As prestações são finitas e determinísticas — gerar as N rows à cabeça é atómico, simples e torna a vista cartões trivial (basta ler). Coerente com DP2 opção C. O cron (4.5) trata só de recorrências. |

## 9. Métricas de Sucesso

**Métricas de produto (epic Done quando atingidas):**

- **AC PRD Epic 4 AC1:** Compra parcelada de €1.200 em 12× cria 12 transações futuras correctas (€100 cada).
- **AC PRD Epic 4 AC2:** Recorrente "renda todo o dia 8" gera transação automaticamente.
- **AC PRD Epic 4 AC3:** Vista mensal mostra projecção dos próximos 30 dias incluindo recorrentes e prestações.
- **AC PRD Epic 4 AC4:** Cérebro: "Paguei €78,70 no supermercado, com o cartão Millennium" cria transação correctamente associada ao cartão.
- **AC PRD Epic 4 AC5:** Todos os valores apresentados em formato PT-PT (`€1.234,56`).
- **AC adicional:** Transacção criada num household não é visível noutro household (RLS — NFR5).

**Métricas operacionais:**

- Latência p95 das operações CRUD de Finanças < 500ms (NFR2).
- Latência p95 da vista mensal (com projecção) < 500ms (NFR2) — validada por EXPLAIN ANALYZE.
- Zero RLS leaks em testes integration cross-household das 6 tabelas (NFR5).
- Cron de geração idempotente — re-execução não duplica transacções (validado por teste).
- Cobertura de testes ≥ 70% no package/módulo de Finanças (NFR16).
- RLS Coverage Gate verde — as 6 tabelas mantêm 4 policies cada (24 policies).

**Métricas de negócio (medidas após launch):**

- % de utilizadores que registam pelo menos 1 transacção financeira na primeira semana ≥ 35%.
- % de transacções criadas via cérebro vs UI manual — proxy do valor do diferenciador multi-intent.

## 10. FRs/NFRs Cobertos

**Functional Requirements (do PRD §2.1):**

- **FR13** — Criar transacções variáveis com valor, categoria, data, descrição, conta/cartão.
- **FR14** — Finanças recorrentes (renda, internet, salário) com estrutura de recorrência.
- **FR15** — Contas bancárias (com saldo) e cartões de crédito com fecho de fatura e dia de vencimento.
- **FR16** — Compras parceladas vinculadas a cartão, gerando N transacções futuras.
- **FR17** — Vista de Património — saldo agregado por banco/conta com drilldown.
- **FR18** — Vista mensal — análise por categoria/dia, total entrado vs saído, projecção 30 dias.
- **FR19** — Moeda EUR exclusiva, formato PT-PT (`€8,88`, `€1.234,56`).
- **FR5** (parcial) — Consultas analíticas PT-PT sobre finanças via `query_finance_summary` (DP5).
- **FR1-FR2** (extensão) — Intents de Finanças no cérebro multi-intent, executadas atomicamente.
- **FR6** (extensão) — Undo das operações de Finanças via `reverse_op` declarativo.

**Non-Functional Requirements (do PRD §2.2):**

- **NFR2** — Latência p95 CRUD de Finanças < 500ms.
- **NFR5** — RLS Postgres activa nas 6 tabelas (gate CI obrigatório — já satisfeito, mantido).
- **NFR9** — Audit log de operações de Finanças (migration de audit actions na Story 4.1).
- **NFR12** — Sem PII além de `user_id`; `iban_last4`/`last4` em vez de IBAN/número completos.
- **NFR13/14** — OTel nas routes e no cron de Finanças.
- **NFR16** — Cobertura de testes ≥ 70% no módulo de Finanças.
- **NFR19** — Imports absolutos `@/...` e `@meu-jarvis/...`.

**Constraints (do PRD §2.3):**

- **CON3** — PT-PT exclusivo (copy das vistas, mensagens de erro, nomes de categorias).
- **CON8** — Cada story validada por @po antes de @dev implementar.
- **CON9** — Moeda EUR, formato PT-PT (vírgula decimal, `€78,70`); valores em `*_cents integer`.

## Change Log

| Versão | Data | Autor | Mudanças |
| ------ | ---- | ----- | -------- |
| v0.1 | 2026-05-20 | Morgan (@pm) | Draft inicial — skeleton + 10 stories alta-nível + 10 riscos + 8 decisões pendentes. Scope ajustado ao estado real do codebase: schema Finanças já existe (Story 1.3), Story 4.1 reduzida a validação/reconciliação. |
| v1.0 | 2026-05-20 | Morgan (@pm) | 8 DPs validadas por Eurico — aceitou integralmente as 8 recomendações preliminares. §8 reescrita com a decisão validada como fonte de verdade; histórico das opções movido para §8.1. Status Draft → Validated. Bloqueio de planeamento levantado: `@sm *draft 4.1` autorizado. |

---

*Documento de planeamento por Morgan (@pm AIOX) em 2026-05-20. Pré-condições de detalhamento de stories satisfeitas:*
*1) Decisões pendentes §8 — VALIDADAS por Eurico 2026-05-20 (8/8 recomendações aceites).*
*2) Epic 3 Done — verificado (8/8 stories Done 2026-05-20).*
*Próximo passo autorizado: `@sm *draft 4.1` (Validação schema Finanças + reconciliação documental).*

*Toda decisão técnica é rastreável a FR/NFR/CON do PRD ou ao schema real verificado no codebase, conforme Constitution Article IV — No Invention.*
