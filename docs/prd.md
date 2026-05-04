# meu-jarvis Product Requirements Document (PRD)

**Autor:** Bob (PM Strategist), corrigido por Orion (aiox-master) após directiva do Eurico
**Data:** 2026-05-04
**Versão:** 1.1 (MVP — Fase 1, PT-PT exclusivo)
**Estado:** Draft (pré-validação @po, pré-arquitectura)

---

## 1. Goals and Background Context

### 1.1 Goals

- Entregar SaaS multi-tenant com cérebro AI multi-intent operacional em 3-4 meses, focado **exclusivamente em Portugal**.
- Cobrir 60% do tempo de uso típico de um utilizador Néctar com 3 capacidades core: Cérebro, Tarefas, Finanças.
- Validar conversão freemium-to-paid >=8% em Portugal.
- Estabelecer base técnica multi-tenant (RLS, tenancy por household) que torna o pivot família-first impossível de copiar pelo Néctar sem refactor.
- Atingir latência p95 do prompt multi-intent < 6s e precisão >= 90% em classificação de intents num conjunto de 200 prompts PT-PT de avaliação.

### 1.2 Background Context

O Néctar (Eleven Tecnologia, Brasil) demonstrou em Jul/2025 que existe apetite real por assistentes pessoais AI multi-intent — uma frase cria simultaneamente tarefas, lembretes, transações financeiras e eventos. No entanto, falha em sustentar a entrega: rating 1,0/5 na App Store, sem trial, sem export, sem multi-utilizador, sem GDPR declarada, e ignora completamente o mercado de Portugal.

O `meu-jarvis` ataca esta janela com posicionamento estrutural diferenciado para o mercado **PT-PT exclusivo** (família privacy-first com integração ao ecossistema fiscal e bancário português, ver `docs/research/01-competitive-analysis.md` §4) e um MVP que prova o diferenciador-chave (multi-intent AI) em três módulos críticos. Fica de fora canais externos, OCR, voz e módulos secundários — adiados para Fases 2-4 conforme `mvp_scope.md`.

### 1.3 Change Log

| Data | Versão | Descrição | Autor |
|------|--------|-----------|-------|
| 2026-05-04 | 1.0 | Draft inicial PRD MVP Fase 1 | Bob (PM) |
| 2026-05-04 | 1.1 | Correcção PT-PT exclusivo + Família €8,88, removida toda referência BR/CPLP | Orion (aiox-master) por directiva do Eurico |

---

## 2. Requirements

### 2.1 Functional Requirements

**Cérebro AI multi-intent**
- **FR1:** O sistema deve aceitar um prompt em linguagem natural PT-PT (texto) no chat principal e classificá-lo numa ou mais intents simultâneas dentre: criar_tarefa, criar_finança_variável, criar_finança_recorrente, criar_cartão, criar_parcelada, consultar_dados. Trace: JARVIS.txt L9-15, mvp_scope.md.
- **FR2:** Quando um prompt tem múltiplas intents, o sistema deve executar todas dentro da mesma transação (ou compensar em caso de falha parcial) e devolver um resumo agregado do que foi criado/alterado. Trace: JARVIS.txt L11-15.
- **FR3:** Para cada execução do agente, o sistema deve registar uma entrada no audit log com prompt original, intents detectadas, parâmetros extraídos, decisão final e utilizador. Trace: research §3 — audit trail / explicabilidade.
- **FR4:** Se a confiança da classificação multi-intent for inferior a 70%, o sistema deve apresentar um preview (cartão de confirmação) ao utilizador antes de persistir. Trace: research §6.2 risco 3 mitigação.
- **FR5:** O agente deve suportar consultas analíticas em PT-PT (ex: "como estão as minhas finanças este mês", "o que tenho para fazer para a semana") devolvendo resposta texto + dados estruturados. Trace: JARVIS.txt L24-31.
- **FR6:** O cérebro deve permitir cancelar/reverter a última operação do agente via comando explícito ("cancela", "anula a última") ou botão de undo no histórico. Trace: standard de indústria + research auditabilidade.

**Módulo Tarefas**
- **FR7:** Utilizador autenticado deve criar tarefas com título, descrição, data due, prioridade, tags e projecto opcional. Trace: JARVIS.txt L94-101.
- **FR8:** Tarefas devem suportar recorrência configurável (diária, semanal, mensal, dias úteis, fim-de-semana, dia do mês). Trace: JARVIS.txt L122-129.
- **FR9:** Sistema deve oferecer 3 vistas de tarefas: lista, Kanban (com colunas customizáveis por household), calendário semanal. Trace: JARVIS.txt L100-101.
- **FR10:** Drag-and-drop entre dias na vista calendário e entre colunas na vista Kanban deve actualizar persistentemente. Trace: JARVIS.txt L96-101.
- **FR11:** Tarefas atrasadas devem ser destacadas visualmente e listadas numa secção dedicada do dashboard "Visão". Trace: JARVIS.txt L96.
- **FR12:** Sistema deve permitir tags globais por household (criação, listagem, filtro). Trace: JARVIS.txt L102.

**Módulo Finanças**
- **FR13:** Utilizador deve criar transações financeiras variáveis (gastei X em Y) com valor, categoria, data, descrição, conta/cartão opcional. Trace: JARVIS.txt L114-116.
- **FR14:** Sistema deve suportar finanças recorrentes (renda, internet, salário) com mesma estrutura de recorrência das tarefas. Trace: JARVIS.txt L116, 122-129.
- **FR15:** Utilizador deve criar contas bancárias (com saldo) e cartões de crédito vinculados a uma conta, com fecho de fatura e dia de vencimento. Trace: JARVIS.txt L116-119.
- **FR16:** Sistema deve suportar compras parceladas (prestações) vinculadas a um cartão, gerando N transações futuras automaticamente. Trace: JARVIS.txt L116-118.
- **FR17:** Vista de Património deve mostrar saldo agregado por banco/conta e permitir drilldown. Trace: JARVIS.txt L117-119.
- **FR18:** Vista mensal deve apresentar análise por categoria, por dia, total entrado vs total saído, com projecção dos próximos 30 dias incluindo recorrentes e prestações. Trace: JARVIS.txt L29-30, 119-120.
- **FR19:** Sistema usa moeda **EUR exclusivamente** com formato PT-PT (vírgula decimal, separador milhar ponto: `€8,88`, `€1.234,56`). `[DECIDIDO POR PM:]` Multi-moeda fora do âmbito do produto.

**Web App — UI**
- **FR20:** Aplicação web deve ter chat principal com cérebro AI sempre acessível (sidebar ou layout split). Trace: JARVIS.txt L7-8.
- **FR21:** Dashboard "Visão" deve agregar widgets configuráveis (toggle on/off por widget): tarefas hoje, tarefas atrasadas, briefing diário, balanço financeiro do mês, próximos eventos recorrentes, central de operações com contadores. Trace: JARVIS.txt L19-22, 86-94.
- **FR22:** Aplicação deve oferecer modo claro e modo escuro com toggle persistente por utilizador. Trace: standard de indústria.
- **FR23:** Aplicação é **PT-PT exclusivo no MVP**. Sem i18n, sem hooks de tradução, sem strings externalizadas para tradução futura. Trace: directiva Eurico 2026-05-04, market_pt_pt_exclusive.md.

**Auth e Multi-tenancy**
- **FR24:** Utilizador deve registar-se com email + password (ou social login Google/Apple), confirmar email, completar onboarding (escolha de plano, criação de household). Trace: standard SaaS.
- **FR25:** Cada utilizador autenticado pertence a um ou mais households; um household tem 1+ utilizadores conforme limite de plano. Trace: research §3 multi-tenant família.
- **FR26:** Toda a data persistida tem `household_id` e RLS Postgres impede acesso cross-household. Trace: project_vision.md, research §3 GDPR.
- **FR27:** Owner de household pode convidar outros utilizadores via email (limites: Pessoal=1, Família=4, Pro=10). Trace: research §5.2 pricing.
- **FR28:** Utilizador pode pedir export completo dos seus dados em JSON e CSV em qualquer momento (GDPR Art. 20). Trace: research §3 portabilidade GDPR.
- **FR29:** Utilizador pode pedir eliminação completa da conta com purge real após 30 dias (GDPR Art. 17). Trace: research §3 GDPR.

**Onboarding**
- **FR30:** Após registo, novo utilizador entra num fluxo de onboarding que: cria household default, oferece tour de 3 passos (chat, tarefas, finanças), inicia trial de 14 dias automaticamente. Trace: research §5 trial 14 dias.
- **FR31:** Utilizador pode saltar onboarding mas o trial é sempre activado. Trace: standard SaaS conversão.

**Billing**
- **FR32:** Sistema deve integrar Stripe para checkout, gestão de subscrições, mudanças de plano (upgrade/downgrade pro-rata), cancelamentos e faturas. Trace: mvp_scope.md, research §5.2.
- **FR33:** Trial de 14 dias inicia automaticamente sem captura de cartão; ao terminar, conta volta ao plano Free se utilizador não fizer upgrade. Trace: research §5.2.
- **FR34:** Utilizador pode mudar entre planos Free / Pessoal €4,90 / Família €8,88 / Pro €14,90 a qualquer momento; downgrade aplica-se no fim do período actual. Trace: standard SaaS, directiva Eurico (Família €8,88 fixo).
- **FR35:** Sistema deve emitir factura/recibo electrónico (compatível com Autoridade Tributária PT) para cada pagamento e disponibilizá-lo no painel da conta. Trace: GDPR + obrigação fiscal PT.
- **FR36:** Checkout Stripe deve disponibilizar payment methods PT: cartão, **Multibanco** e **MB Way**. Trace: mercado PT, integração Stripe nativa.

### 2.2 Non-Functional Requirements

**Performance**
- **NFR1:** Latência p95 de prompt multi-intent (entrada → resposta agregada) < 6s. Trace: project brief OKR O2 KR1.
- **NFR2:** Latência p95 de operações CRUD de tarefas/finanças < 500ms.
- **NFR3:** Suportar 1000 households activos com 50 prompts/dia/household sem degradação observável (target Fase 1).
- **NFR4:** First Contentful Paint da web app < 2s em conexão 4G.

**Segurança**
- **NFR5:** RLS Postgres activa em TODAS as tabelas com `household_id`; teste automatizado bloqueia merge se nova tabela com `household_id` for criada sem policy RLS.
- **NFR6:** Senhas com hashing argon2 ou bcrypt cost >=12; tokens de sessão JWT com expiração curta + refresh tokens.
- **NFR7:** Comunicação client-server via TLS 1.2+ exclusivamente.
- **NFR8:** Secrets nunca em código; gestão via vault da plataforma (Vercel env, Supabase secrets).
- **NFR9:** Audit log de operações sensíveis (login, mudança de plano, export de dados, eliminação) imutável e retido 12 meses.

**Compliance e Privacy**
- **NFR10:** **GDPR compliance** obrigatório (mercado PT) — direito de acesso, portabilidade (FR28), eliminação (FR29), rectificação, oposição. Privacy policy em PT-PT publicada antes do launch.
- **NFR11:** **Data residency UE obrigatória** — todos os dados armazenados em região UE (Frankfurt ou Estocolmo). `[DECIDIDO POR PM:]` data residency UE é selling point para mercado PT.
- **NFR12:** Logs do sistema NÃO devem conter PII além de user_id; conteúdo de prompts NÃO é logado em texto claro (apenas hash + classificação de intents para análise).

**Observability**
- **NFR13:** Stack OpenTelemetry-compatível em todos os services desde Epic 1 (não afterthought). Métricas, traces e logs estruturados.
- **NFR14:** Dashboards essenciais: latência do agente, taxa de erro por intent, custo LLM por household, conversões trial→paid, churn mensal.
- **NFR15:** Alertas para: erro rate > 1% em 5 min, latência p95 do agente > 10s em 5 min, falha de billing webhook.

**Qualidade**
- **NFR16:** Cobertura de testes >=70% em packages core (cérebro, tarefas, finanças). Trace: project_brief OKR O3 KR1.
- **NFR17:** Quality gates pre-merge bloqueantes: lint (ESLint), typecheck (TypeScript strict), test (Jest/Vitest). Trace: project_brief OKR O3 KR2.
- **NFR18:** CodeRabbit review activo em todas as PRs (severidade CRITICAL/HIGH bloqueia merge).
- **NFR19:** Imports absolutos obrigatórios em todo o código TypeScript (Constitution Article VI). Trace: CLAUDE.md.

**Custo**
- **NFR20:** Custo LLM por household activo no plano Pessoal não deve exceder 30% do MRR desse plano (~€1,47/mês). Trace: research §6.2 risco 2.
- **NFR21:** Implementar router de modelos: classificação de intent usa modelo barato (GPT-4o-mini), execução multi-intent usa Claude Sonnet. Trace: research §6.2 mitigação.

**Reliability**
- **NFR22:** Uptime alvo 99,5% no MVP (downtime tolerado ~3,6h/mês).
- **NFR23:** Backup diário de Postgres com retenção 30 dias; ensaios de restore mensais.
- **NFR24:** Rollback de deploy em <2 min via Vercel rollback ou similar.

### 2.3 Constraints

- **CON1:** Stack obrigatória — Next.js (App Router) + TypeScript + PostgreSQL. Trace: tech_stack.md.
- **CON2:** Multi-tenant desde o dia 1, com tenancy por household (não por user). Trace: project_vision.md.
- **CON3:** **PT-PT é a língua exclusiva do MVP.** Toda a copy do produto em PT-PT, nunca PT-BR ou outras línguas. Sem i18n no MVP. Trace: directiva Eurico 2026-05-04, market_pt_pt_exclusive.md.
- **CON4:** **Mercado-alvo Portugal exclusivo.** Sem features, copy, integrações ou roadmap visível dirigidos a outros mercados. Trace: market_pt_pt_exclusive.md.
- **CON5:** Imports absolutos obrigatórios; sem imports relativos. Trace: CLAUDE.md, Constitution Art. VI.
- **CON6:** Constitution AIOX não-negociável — CLI First, Agent Authority, Story-Driven Development, No Invention, Quality First.
- **CON7:** Deploy só pode ser executado por @devops; @dev nunca executa `git push`. Trace: agent-authority.md.
- **CON8:** Nenhum FR/NFR pode ser implementado sem story validada por @po. Trace: Constitution Art. III.
- **CON9:** Moeda EUR exclusiva, formato PT-PT (vírgula decimal). Sem multi-moeda no MVP. Trace: directiva Eurico, mercado PT.

---

## 3. User Interface Design Goals

### 3.1 Overall UX Vision

UX minimalista com **chat sempre presente** como ponto central, complementado por dashboard "Visão" agregadora e módulos detalhados acessíveis via sidebar. Tom visual moderno, foco em legibilidade e densidade de informação ajustável (modo compacto vs confortável). Estética PT-PT contemporânea, **sem influência visual do Néctar** (evitar aparência de clone).

### 3.2 Key Interaction Paradigms

- **Chat-first:** acção primária é escrever uma frase ao agente. Toda outra UI é secundária.
- **Preview-then-confirm para acções de baixa confiança:** se classificação <70%, cartão de confirmação antes de persistir.
- **Direct manipulation:** drag-and-drop em tarefas (calendário, Kanban) para reduzir cliques.
- **Undo first-class:** botão de undo visível após cada acção do agente, válido por 30s.

### 3.3 Core Screens and Views

1. **Login / Sign-up**
2. **Onboarding (3 passos)** — chat tour + tarefa exemplo + finança exemplo
3. **Visão (Dashboard agregador)** — widgets configuráveis
4. **Chat principal** — histórico + input
5. **Tarefas — lista**
6. **Tarefas — Kanban**
7. **Tarefas — calendário semanal**
8. **Finanças — overview mensal**
9. **Finanças — variáveis**
10. **Finanças — recorrentes**
11. **Finanças — cartões e fatura**
12. **Finanças — património**
13. **Configurações da conta** (perfil, plano, billing, household, export, eliminação)
14. **Convidar membros do household**

### 3.4 Accessibility

**WCAG AA** como requisito obrigatório no MVP. `[DECIDIDO POR PM:]` standard PT/UE.

### 3.5 Branding

`[DECIDIDO POR PM:]` Branding pendente — delegado a @ux-design-expert para criar visual identity proposta. Constraints:
- Tom moderno, calmo, confiável — não "AI hype" (nada de gradientes neon, nada de vibes ChatGPT).
- Adequado a famílias e profissionais portugueses — nem demasiado corporativo, nem demasiado lúdico.
- Distinto do Néctar (que usa visual escuro com sotaque amarelo/laranja).
- Sensibilidade cultural PT-PT: tom calmo, sóbrio, sem americanismos visuais excessivos.

### 3.6 Target Device and Platforms

**Web Responsive** — desktop primário, tablet completo, mobile funcional (não app-like). Apps nativos Android/iOS adiados para Fases 2-3.

---

## 4. Technical Assumptions

### 4.1 Repository Structure

**Monorepo** (npm workspaces ou pnpm) — alinhado com convenção AIOX (`packages/` já existe na estrutura).

### 4.2 Service Architecture

**Monolito serverless** sobre Next.js full-stack na Fase 1. Routes API do Next.js servem o cérebro AI, módulos de tarefas/finanças, billing webhooks. Background jobs (recorrências, geração de prestações, billing) via cron jobs gerido pela plataforma (Vercel Cron ou Supabase Edge Functions).

Justificação: minimizar overhead operacional no MVP; serviços dedicados surgem quando carga ou complexidade exigir (Fase 2+).

### 4.3 Testing Requirements

**Unit + Integration** obrigatório no MVP. Pirâmide:
- Unit (Vitest/Jest) — cobertura >=70% em packages core.
- Integration — testes de API routes do Next.js, RLS Postgres com containers efémeros.
- E2E (Playwright) — apenas fluxos críticos: registo → onboarding → primeiro prompt → upgrade.
- Manual QA exploratório obrigatório antes de cada release.

### 4.4 Additional Technical Assumptions

- **AI provider:** Anthropic Claude Sonnet primário (executor multi-intent), OpenAI GPT-4o-mini como classificador de intent. `[DECIDIDO POR PM:]` Claude Sonnet superior em function calling PT-PT; GPT-4o-mini barato para classification.
- **ORM:** Prisma ou Drizzle — decisão @architect.
- **Auth:** Supabase Auth ou Clerk — decisão @architect (implica RLS integration).
- **Hosting:** Vercel (web) + Supabase ou Neon (Postgres com pgvector preparado para Fase 3) **com obrigatoriedade de região UE**.
- **Billing:** Stripe com payment methods PT (cartão, Multibanco, MB Way). Único provider necessário.
- **Vector store:** pgvector preparado mas não usado no MVP (módulo Conhecimento é Fase 3).
- **Observability:** OpenTelemetry SDK + provider gerido (Honeycomb, Grafana Cloud ou Vercel Observability).
- **Feature flags:** sistema simples baseado em DB (planos Stripe → flags) já no MVP.

---

## 5. Epic List

| # | Épico | Goal (1 frase) |
|---|-------|----------------|
| **Epic 1** | Foundation & Multi-Tenant Core | Estabelecer monorepo, CI/CD, Postgres com RLS multi-tenant, auth, observability — entregar canary endpoint funcional. |
| **Epic 2** | Cérebro AI Multi-Intent | Implementar agente com function calling capaz de detectar e executar múltiplas intents num prompt PT-PT, com audit log e undo. |
| **Epic 3** | Módulo Tarefas | CRUD de tarefas com recorrência, 3 vistas (lista/Kanban/calendário), tags, integração com cérebro. |
| **Epic 4** | Módulo Finanças | Variáveis, recorrentes, cartões, prestações, património, vista mensal com projecção, integração com cérebro. |
| **Epic 5** | Web App UI — Visão e Chat | Dashboard "Visão" configurável, chat principal sempre acessível, modo claro/escuro, layout responsivo. |
| **Epic 6** | Onboarding e Billing | Registo, onboarding, household, convites, Stripe (cartão+MB+MBWay), trial 14 dias, mudança de planos, export e eliminação GDPR. |

`[DECIDIDO POR PM:]` 6 épicos como granularidade óptima — Epic 1 estabelece foundation com canary, Epic 2 prova diferenciador, 3-4 entregam módulos, 5 dá rosto, 6 fecha o loop comercial. Ordem é sequencial mas Epics 3 e 4 podem correr em paralelo após Epic 2.

---

## 6. Epic Details

### Epic 1 — Foundation & Multi-Tenant Core

**Goal:** Estabelecer fundação técnica do projecto: monorepo Next.js+TS, CI/CD com gates de qualidade, Postgres com RLS multi-tenant, autenticação básica, stack de observability — terminando com um endpoint canary autenticado que prova multi-tenancy fim-a-fim.

**Stories sugeridas:**
- 1.1 Setup monorepo Next.js 15 + TS strict + lint/typecheck/test gates.
- 1.2 CI/CD pipeline (GitHub Actions) com lint+typecheck+test bloqueantes em PRs e main.
- 1.3 Postgres provisioning (região UE) + Prisma/Drizzle schema base (households, users, household_members) com RLS policies.
- 1.4 Autenticação (email+password, sessão JWT) integrada com schema multi-tenant.
- 1.5 Endpoint canary `/api/me` autenticado que devolve household + role do utilizador, com teste E2E de RLS cross-household (deve negar acesso).
- 1.6 OpenTelemetry SDK setup + dashboard mínimo (latência, error rate).

**AC de Epic 1 (alto nível):**
- AC1: Repo arranca em < 30s, todos os checks passam em < 5min na CI.
- AC2: Cross-household access bloqueado por RLS — verificado em teste automatizado.
- AC3: Canary endpoint responde com latência p95 < 200ms.
- AC4: Telemetria (latência+erros) visível no dashboard escolhido.
- AC5: Todos os recursos cloud (Postgres, KV, blobs) provisionados em região UE.

**Quality gates:** lint, typecheck, test (>=70% em packages core), security review básico (RLS coverage), performance smoke.

---

### Epic 2 — Cérebro AI Multi-Intent

**Goal:** Implementar o agente AI core capaz de aceitar um prompt em PT-PT, classificar múltiplas intents simultâneas, extrair parâmetros, executar tool calls em transação e devolver resposta agregada — com audit log imutável e undo de 30s.

**Stories sugeridas:**
- 2.1 Schema de `agent_runs` (audit log) + `intent_classifications`.
- 2.2 Provider abstraction sobre Anthropic Sonnet (executor) + OpenAI GPT-4o-mini (classifier).
- 2.3 Tool registry + tool calling adapter (recebe lista de tools, devolve plan).
- 2.4 Classificador de intents PT-PT com confidence score.
- 2.5 Executor multi-intent com transações DB (commit atómico ou compensação).
- 2.6 Preview-then-confirm flow para confidence < 70%.
- 2.7 Undo mechanism (storage de operações reversíveis por 30s + endpoint).
- 2.8 Endpoint `/api/agent/prompt` com auth + RLS + telemetria.
- 2.9 Conjunto de 200 prompts PT-PT curated para benchmark de precisão.

**AC de Epic 2:**
- AC1: Prompt "amanhã reunião às 15h, paguei €78,70 no supermercado" cria 1 evento + 1 finança numa única chamada.
- AC2: Prompt ambíguo dispara preview de confirmação.
- AC3: `agent_runs` regista cada execução com prompt, intents, params, resultado.
- AC4: Undo reverte a última operação dentro de 30s.
- AC5: Latência p95 < 6s em 200 prompts de teste PT-PT.
- AC6: Precisão de classificação >= 90% em conjunto de 200 prompts curated PT-PT.

**Quality gates:** todas de Epic 1 + LLM cost monitoring + intent accuracy benchmark.

---

### Epic 3 — Módulo Tarefas

**Goal:** Entregar CRUD completo de tarefas com recorrência, 3 vistas (lista/Kanban/calendário), tags globais por household, drag-and-drop, e tools de cérebro AI integradas (criar_tarefa, completar_tarefa, listar_tarefas).

**Stories sugeridas:**
- 3.1 Schema de `tasks`, `task_recurrences`, `tags`, `task_tags`.
- 3.2 API routes CRUD de tarefas (auth + RLS).
- 3.3 Vista lista com filtros e ordenação.
- 3.4 Vista Kanban com colunas configuráveis e drag-and-drop.
- 3.5 Vista calendário semanal com drag entre dias.
- 3.6 Sistema de tags globais (criar/listar/aplicar).
- 3.7 Geração automática de instâncias recorrentes (cron diário).
- 3.8 Tools do cérebro: criar_tarefa, completar_tarefa, listar_tarefas, listar_atrasadas.

**AC de Epic 3:**
- AC1: Criar tarefa via UI ou via cérebro tem mesmo resultado persistido.
- AC2: Recorrência semanal/mensal/dias-úteis funciona em horizonte de 90 dias.
- AC3: Drag-and-drop em Kanban e calendário persiste sem reload.
- AC4: Tarefa criada num household não é visível noutro household (RLS).

**Quality gates:** as de Epic 2 + UX review de @ux-design-expert.

---

### Epic 4 — Módulo Finanças

**Goal:** Entregar finanças completas — variáveis, recorrentes, cartões com fatura, prestações, património por banco, vista mensal com projecção 30 dias, e tools do cérebro AI integradas. Tudo em EUR formato PT-PT.

**Stories sugeridas:**
- 4.1 Schema de `accounts`, `cards`, `transactions`, `recurrences`, `installments`, `categories`.
- 4.2 API routes CRUD para todas as entidades.
- 4.3 Vista "este mês" com agregações por categoria/dia + projecção.
- 4.4 Vista cartões com fatura corrente, próxima fatura, prestações associadas.
- 4.5 Vista património com balanço por conta.
- 4.6 Geração automática de prestações + recorrências (cron diário).
- 4.7 Tools do cérebro: criar_finança_variavel, criar_finança_recorrente, criar_cartao, criar_parcelada, consultar_balanço.
- 4.8 Categorias default PT (Mercearia, Restauração, Combustível, Saúde, Habitação, Educação, Lazer, Subscrições, etc.).

**AC de Epic 4:**
- AC1: Compra parcelada de €1.200 em 12x cria 12 transações futuras correctas (€100 cada).
- AC2: Recorrente "renda todo o dia 8" gera transação automaticamente.
- AC3: Vista mensal mostra projecção dos próximos 30 dias incluindo recorrentes e prestações.
- AC4: Cérebro: "Paguei €78,70 no supermercado, com o cartão Millennium" cria transação correctamente associada ao cartão.
- AC5: Todos os valores apresentados em formato PT-PT (€1.234,56).

**Quality gates:** as anteriores + revisão financeira manual (precisão dos cálculos de fatura/prestações).

---

### Epic 5 — Web App UI — Visão e Chat

**Goal:** Entregar a casca UI completa: dashboard "Visão" agregadora configurável, chat principal sempre acessível, navegação principal entre módulos, modo claro/escuro, layout responsivo, estado de empty states e onboarding inline.

**Stories sugeridas:**
- 5.1 Layout shell (sidebar + main + chat panel) responsivo.
- 5.2 Dashboard "Visão" com widgets toggleáveis: tarefas hoje, atrasadas, briefing diário, balanço mensal, próximos eventos.
- 5.3 Chat principal — histórico, input, envio, streaming de resposta.
- 5.4 Modo claro/escuro com persistência por utilizador.
- 5.5 Empty states em todos os módulos (copy PT-PT).
- 5.6 Indicador de undo (toast 30s) após acção do agente.

**AC de Epic 5:**
- AC1: Visão renderiza widgets escolhidos com dados reais.
- AC2: Chat envia prompt, mostra streaming, persiste no histórico.
- AC3: Layout funciona em desktop, tablet e mobile responsivo.
- AC4: Modo escuro completo (sem leak de cores claras).
- AC5: Toda a copy visível é PT-PT validada.

**Quality gates:** as anteriores + Lighthouse score >= 85 em mobile.

---

### Epic 6 — Onboarding e Billing

**Goal:** Fechar o loop comercial: registo, onboarding em 3 passos, criação de household, convites, integração Stripe (Free/Pessoal €4,90/Família €8,88/Pro €14,90), trial 14 dias automático, mudança de planos, exports GDPR e eliminação de conta. Pagamentos em EUR com cartão + Multibanco + MB Way.

**Stories sugeridas:**
- 6.1 Fluxo de registo + verificação de email.
- 6.2 Onboarding 3 passos (chat tour + criar tarefa exemplo + criar finança exemplo).
- 6.3 Setup Stripe: produtos, prices em EUR, payment methods PT (cartão+MB+MBWay), webhook handler.
- 6.4 Activação automática de trial 14 dias sem cartão no registo.
- 6.5 Página de upgrade com 4 planos + checkout Stripe (Família €8,88 destacado como tier hero).
- 6.6 Mudança de plano (upgrade/downgrade pro-rata).
- 6.7 Convite de membros do household com limites por plano (Pessoal=1, Família=4, Pro=10).
- 6.8 Export GDPR (JSON + CSV) por endpoint autenticado.
- 6.9 Eliminação de conta com purge agendado (30 dias).
- 6.10 Página de billing/faturas no painel + emissão de factura electrónica PT.

**AC de Epic 6:**
- AC1: Registo + onboarding completo em < 3 min para utilizador novo.
- AC2: Trial activa-se automaticamente; ao fim de 14 dias volta a Free.
- AC3: Upgrade Pessoal→Família via Stripe ajusta limite de membros imediatamente.
- AC4: Pagamento via Multibanco e MB Way funcional em ambiente de teste e produção.
- AC5: Export devolve ZIP com JSON + CSV de toda a data do utilizador.
- AC6: Eliminação cria job de purge a 30 dias; revogável até execução.
- AC7: Factura emitida tem NIF do cliente quando fornecido.

**Quality gates:** as anteriores + security review (Stripe webhook signing, RLS em billing tables) + GDPR review documentada por @qa.

---

## 7. Checklist Results Report

`[DECIDIDO POR PM:]` Validação contra `pm-checklist.md` será executada por @po na fase de validação de stories. PRD será re-revisitado se gaps forem identificados.

---

## 8. Next Steps

### 8.1 UX Expert Prompt

> @ux-design-expert *audit-codebase + *front-end-spec
> Input: `docs/prd.md` + `docs/project-brief.md` + `docs/research/01-competitive-analysis.md`.
> Entregar: `docs/front-end-spec.md` cobrindo branding (proposta), wireframes dos 14 core screens, design tokens, biblioteca de componentes shadcn/ui ou equivalente, regras de acessibilidade WCAG AA. Tom: moderno, calmo, confiável, distinto do Néctar. **PT-PT exclusivo na copy** (formato datas DD/MM/YYYY, moeda €1.234,56).

### 8.2 Architect Prompt

> @architect *create-architecture
> Input: `docs/prd.md` + `docs/project-brief.md`.
> Entregar: `docs/architecture.md` cobrindo: AI provider final, ORM (Prisma/Drizzle), Auth (Supabase/Clerk), schema completo com RLS, billing flow (Stripe + payment methods PT), observability stack, custo LLM modelo de routing, deployment topology Vercel+Postgres **em região UE**, estratégia de testes (incluindo RLS testing automatizado).

### 8.3 Handoffs adicionais

- **@po** *validate (PRD + brief) antes de @sm criar stories detalhadas.
- **@sm** *draft (Epic 1 stories) após validação @po e architecture entregue.
- **@devops** *setup-ci antes da primeira story em desenvolvimento.

---

*PRD preparado por Bob (PM AIOX) em 2026-05-04, corrigido por Orion (aiox-master) na mesma data após directiva do Eurico para focar PT-PT exclusivo + pricing Família €8,88. Cada FR/NFR/CON é rastreável conforme Constitution Article IV — No Invention.*
