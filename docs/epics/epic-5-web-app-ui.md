# Epic 5 — Web App UI — Visão + Chat

**Status:** Validated v1.0 — 8 DPs validadas por Eurico 2026-05-23; pronto para `@sm *draft 5.1`
**Owner:** @pm (Morgan)
**Created:** 2026-05-23
**Depends on:** Epic 1 Done · Epic 2 Done · Epic 3 Done · Epic 4 Done (10/10 stories Done — gate APPROVED 2026-05-23).
**Estimated total effort:** L (≈ 10 stories, mistura S/M/L com 1 L na vista Visão frontend).

---

## 1. Visão e Valor de Negócio

O Epic 5 entrega a **casca visual** que torna o produto coerente — depois de quatro epics a construir cérebro, multi-tenancy, tarefas e finanças por baixo, este é o epic que dá *rosto* ao Expressia. O utilizador entra em `/visao`, vê numa só ecrã o que precisa de saber hoje (briefing, tarefas, gastos, próximas recorrências), tem o chat sempre a um clique e pode operar tudo em modo claro ou escuro. O mercado-alvo PT-PT — famílias e profissionais portugueses — vê uma aplicação que parece pensada para si: copy em português europeu, formato `€1.234,56`, datas `DD/MM/YYYY`, tom calmo e sóbrio (front-end-spec §2 e §8).

O valor competitivo vs Néctar (BR) assenta em três eixos: (1) **dashboard agregador como home** — quando o utilizador abre o produto vê *contexto* em vez de uma lista vazia (FR21), o Néctar atira para uma timeline cronológica que obriga a procurar; (2) **chat sempre acessível, não escondido** — o Epic 2 entregou um chat funcional em `/jarvis`, este epic torna-o presente em todas as telas via panel persistente, o que materializa a tese "chat-first" do PRD §3.2; (3) **estética PT-PT contemporânea, distinta do Néctar** — o front-end-spec já validou branding sóbrio (Lora para hero, Inter para corpo, paleta calma), este epic aplica-o consistentemente em todos os módulos existentes e nas telas novas do Visão.

A vantagem é defensável porque o Epic 5 consolida convenções de design que herdam para Epic 6 e além: `MoneyDisplay`/`DateDisplay` centralizados (architecture §8.4), empty-state component reutilizável, tokens Tailwind do front-end-spec, persistência de preferências em `user_prefs`. O Néctar não consegue copiar isto sem refactor visual completo, e o resultado é uma UI que comunica *fiabilidade* — atributo decisivo para o segmento famílias.

## 2. Objectivo

No fim do Epic 5, um utilizador autenticado num household pode: navegar a aplicação por uma sidebar fixa (substitui o nav horizontal placeholder actual); aceder ao chat AI em qualquer momento via panel persistente (não só na rota `/jarvis`); abrir `/visao` e ver um dashboard com 5+ widgets agregadores reais (briefing diário, tarefas hoje, gastos do mês, próximas recorrências, tarefas atrasadas) com toggle on/off; alternar entre modo claro e escuro com persistência por utilizador; ver feedback de undo (toast 30s) após qualquer acção do agente em qualquer rota; usar a aplicação em mobile e tablet sem quebras de layout — satisfazendo as ACs do PRD §6 Epic 5 (renderizar widgets, chat streaming, layout responsivo, dark mode completo, copy PT-PT validada) e os FR20-FR23.

## 3. Scope

### IN

- **Layout shell completo** — sidebar fixa (Visão, Jarvis, Tarefas, Finanças, Conta) + chat panel persistente (collapsible) + topbar com avatar/household switcher. Substitui o nav horizontal actual em `apps/web/src/app/(app)/layout.tsx` (60 linhas placeholder Story 1.5). Arquitectura §8.1 linha 663: `sidebar + chat panel + topbar`.
- **Dashboard "Visão" — frontend** — `WidgetGrid` configurável renderizando 7 widgets (FR21): briefing diário, tarefas hoje, tarefas atrasadas, balanço do mês, próximas recorrências, saldo por conta, calendário semana. Toggle on/off persistido em `user_prefs.widgets_enabled` (DP3). Empty-state quando todos os widgets `off`. Layout 3 colunas em desktop, 2 em tablet, 1 em mobile (wireframe §5.4).
- **Dashboard "Visão" — backend** — endpoints/queries agregadores RSC-friendly: `briefing-daily` (composição de 5 sub-fontes), `tasks-today`, `tasks-overdue`, `finance-monthly-summary`, `upcoming-recurrences`, `accounts-balance`. Reusam helpers `requireAuth`/`resolveHouseholdId` e respeitam RLS.
- **Modo claro/escuro** — design-token sweep em todos os módulos para garantir dark mode completo (sem leak de cores claras — AC4). Toggle UI em `/conta/preferencias` ao lado de `always_preview`. Persistência: ver DP2.
- **Chat panel persistente** — extracção de `jarvis-chat.tsx` (267 linhas) para componente shared `<ChatPanel>` montado no shell. Versão collapsible (desktop sidebar direita) + FAB (mobile). A rota `/jarvis` mantém-se como vista *fullscreen* do chat (já com histórico). Streaming, preview-then-confirm e error states reusados.
- **Indicador undo (toast 30s)** — `UndoToast` global registado no shell, alimentado por Zustand store `undoStore`. Lê `reverse_op` + `expires_at` do response da Server Action (Story 2.8). Render fora dos painéis para visibilidade em qualquer rota.
- **Empty-state component partilhado** — `<EmptyState>` em `packages/ui` com props `illustration`, `title`, `body`, `cta`. Aplicado em todas as listas existentes (tarefas vazias, finanças vazias, visão sem widgets, chat sem histórico).
- **Auditoria responsiva + Lighthouse mobile ≥ 85** — todas as telas existentes (auth, jarvis, tarefas×3, finanças×5, visão, conta) revistas em viewport mobile e tablet. Métricas Lighthouse documentadas em `docs/runbooks/lighthouse-mobile.md`.
- **Páginas auth — branding sweep** — aplicar tokens do front-end-spec §3 às páginas `/entrar`, `/registar`, `/recuperar` (Story 1.5 entregou funcionalidade; este epic aplica branding).
- **Reconciliação documental** — corrigir comentário desactualizado em `apps/web/src/app/(app)/visao/page.tsx:79` (refere "UX completa de Visão é Epic 6" — era a numeração antiga, é Epic 5).

### OUT (adiar para Epic posterior)

- **Onboarding 3-step** (wireframes §5.3 — captura nome, demo do cérebro, plano) → **Epic 6** (Onboarding e Billing). Este epic entrega `/visao` mas não o flow que precede primeira sessão. Toast "Bem-vindo, {nome}." na primeira navegação é Epic 6.
- **Household switcher e convite UI** → Epic 6. O topbar do shell desenha o slot do `HouseholdSwitcher` mas a lógica de troca + invites é Epic 6.
- **Páginas de plano/billing** (`/conta/plano`, página de upgrade) → Epic 6 (FR32-FR36).
- **Export GDPR UI** (`/conta/exportar`) → Epic 6 (FR28-FR29).
- **Painel de faturas** → Epic 6 (FR35).
- **Command palette (`Cmd+K`)** — wireframe §5.5 menciona-o mas é nice-to-have; adiar para Fase 2.
- **Sugestões inline de prompts no chat** — wireframe §5.5 mostra 3 chips contextuais; require modelo de recomendação. Adiar para Fase 2.
- **Mini chart no chat response** (resposta analítica com sparkline) — Fase 2.
- **Apps nativos Android/iOS** — Fases 2-3 (PRD §3.6).
- **i18n / hooks de tradução** — PT-PT exclusivo (CON3, FR23). Sem strings externalizadas.
- **OCR / sync bancário** — fora MVP.

## 4. Estado Actual da UI (pré-condição verificada)

> **Achado de planeamento.** Quatro epics consecutivos entregaram páginas e componentes UI sem que houvesse uma camada de design system formal — cada epic resolveu o seu sub-domínio com Tailwind inline. Verificação contra o codebase real (2026-05-23) confirma este padrão e dimensiona o trabalho do Epic 5 com precisão.

**O que já existe:**

| Artefacto | Estado | Localização |
|-----------|--------|-------------|
| Layout shell `(app)/layout.tsx` — header horizontal nav + main `max-w-5xl` | 60 linhas placeholder Story 1.5 — substituível | `apps/web/src/app/(app)/layout.tsx` |
| Página `/visao` placeholder com `user_id`/`household_id` debug | 83 linhas Story 1.5 — placeholder | `apps/web/src/app/(app)/visao/page.tsx` |
| Página `/jarvis` + componente `<JarvisChat>` (267 linhas) | Funcional Story 2.7 — chat com preview/confirm/undo | `apps/web/src/app/(app)/jarvis/` |
| Páginas Tarefas (lista, kanban, calendário) | Funcionais Stories 3.3-3.5 | `apps/web/src/app/(app)/tarefas/` |
| Páginas Finanças (este-mes, variáveis, recorrentes, cartões, património) | Funcionais Stories 4.6-4.9 | `apps/web/src/app/(app)/financas/` |
| Página `/conta/preferencias` com toggle `always_preview` (FR4) | Funcional Story 2.7 | `apps/web/src/app/(app)/conta/preferencias/` |
| Páginas auth (`/entrar`, `/registar`, `/recuperar`) | Funcionais Story 1.5 — sem branding tokens aplicados | `apps/web/src/app/(auth)/` |
| Schema `user_prefs` (PK = user_id, FK householdId, coluna `always_preview`) | Aplicado Story 2.7 + 4 RLS policies | `packages/db/src/schema/prefs.ts`, `migrations/0001:441+` |
| Front-end-spec.md (16 secções, 1584 linhas — branding, tokens, 14 wireframes, padrões AI, microcopy, WCAG AA, responsive, dark mode, animação) | Validado v1.0 | `docs/front-end-spec.md` |
| Helpers API `requireAuth`/`resolveHouseholdId`/`resolveHouseholdRole`/`insertAuditLog` | Stable Epic 3 (Stories 3.1-3.2) | `apps/web/src/lib/api-helpers/` |

**O que NÃO existe (é o trabalho do Epic 5):**

- `packages/ui/` — directório referido em `architecture.md:720-724` (design system shared com `primitives/`, `components/`, `tokens.ts`) — não existe ainda. Cada módulo tem Tailwind inline. `MoneyDisplay` mencionado em `architecture.md:723` não existe — Finanças (Epic 4) usa formatação inline. **Discutir em DP6.**
- `<EmptyState>` partilhado — cada lista tem o seu próprio empty state inline (tarefas, finanças, jarvis).
- `<ChatPanel>` shared — `<JarvisChat>` está acoplado à rota `/jarvis`, não é montável noutras rotas.
- Sidebar component — nav é horizontal e inline no layout.
- `<UndoToast>` global — Story 2.8 entregou undo backend; UI feedback está só dentro do `<JarvisChat>` (toast inline na conversa, não persistente fora dela).
- `user_prefs.theme` + `user_prefs.widgets_enabled` — colunas inexistentes. Schema actual só tem `always_preview`. **Migration de extensão na Story 5.1.**
- Endpoints/queries agregadores para o dashboard "Visão" — nenhum existe. As 5 vistas Finanças e 3 Tarefas consomem APIs específicas, mas não há query composta tipo "briefing".
- Tema dark mode tokenizado — actualmente cada componente usa classes Tailwind `dark:` ad-hoc; sem garantia de cobertura. **Sweep necessário.**
- Lighthouse mobile baseline — nenhuma medição registada. **Story 5.10 estabelece baseline + budgets.**

## 5. Stories Propostas (alta-nível, ordem sugerida)

| Story | Título | Objectivo (1 frase) | Estimate | Dependências |
| ----- | ------ | ------------------- | -------- | ------------ |
| 5.1 | Schema `user_prefs` extensão + reconciliação documental | Migration adiciona `theme text` + `widgets_enabled jsonb` (ou equivalente conforme DP3) a `user_prefs`; corrigir comentário `visao/page.tsx:79` ("Epic 6" → "Epic 5"); validar RLS coverage gate verde após ALTER. | S | Epic 1 (1.3 Done) |
| 5.2 | `packages/ui` bootstrap + design tokens + `MoneyDisplay`/`DateDisplay` | Criar workspace `@meu-jarvis/ui`, exportar tokens (cores, espaços, tipografia) do front-end-spec §3 + `MoneyDisplay` (`Intl.NumberFormat pt-PT EUR`) + `DateDisplay` (`Intl.DateTimeFormat pt-PT`). Refactor incremental dos call-sites Finanças (Epic 4) e Tarefas. | M | 5.1 |
| 5.3 | Layout shell — sidebar fixa + topbar + chat panel slot | Substituir `(app)/layout.tsx` por shell 3-zonas: sidebar vertical (nav), main content, chat panel (slot vazio nesta story), topbar com avatar/logout. Responsive: hamburger menu < 768px. | M | 5.2 |
| 5.4 | `<ChatPanel>` extraído + montado no shell | Extrair `<JarvisChat>` para `packages/ui/components/ChatPanel` agnóstico de rota. Montar no shell com toggle expand/collapse (desktop) e FAB (mobile). Rota `/jarvis` passa a render `<ChatPanel mode="fullscreen">`. | M | 5.3 |
| 5.5 | Visão — APIs/queries agregadoras (backend) | RSC queries (ou route handlers se necessário) para 6 agregados: `briefing-daily`, `tasks-today`, `tasks-overdue`, `finance-monthly-summary`, `upcoming-recurrences`, `accounts-balance`. Tipados Zod, RLS-aware, p95 < 500ms (NFR2). | M | 5.1, Epic 3+4 Done |
| 5.6 | Visão — `<WidgetGrid>` + 7 widgets renderizáveis (frontend) | Página `/visao` real: grid responsivo 3/2/1 colunas, skeleton independente por widget, lê `widgets_enabled` de `user_prefs`, empty-state quando todos `off`. Cada widget é um Server Component leve. | L | 5.5, 5.3 |
| 5.7 | Widget config UI + persistência | UI em `/conta/preferencias` ou inline em `/visao` (DP4) para toggle on/off por widget. PATCH `/api/conta/preferencias` actualiza `user_prefs.widgets_enabled`. | S | 5.6 |
| 5.8 | Modo claro/escuro — tokens sweep + persistência + toggle | Auditar todos os componentes para dark mode completo (AC4 — sem leak claras). Toggle UI em `/conta/preferencias`. Persistência: ver DP2 (Zustand+localStorage vs `user_prefs.theme`). | M | 5.2 |
| 5.9 | `<UndoToast>` global + `<EmptyState>` shared | `<UndoToast>` registado no shell, alimentado por Zustand `undoStore` (token + `expires_at` da response Story 2.8). `<EmptyState>` em `packages/ui` com 4 variantes, aplicado em tarefas/finanças/visão/chat. | S | 5.3 |
| 5.10 | Responsive sweep + branding auth + Lighthouse mobile ≥ 85 | Auditoria de todas as telas (auth + 11 da app) em mobile/tablet. Aplicar tokens às páginas auth. Documentar baseline + budgets Lighthouse em runbook. Gate CI opcional. | M | 5.2, 5.8, 5.9 |

**Total estimado:** 10 stories — 2×S, 6×M, 1×L (5.6) — alinhado com precedente Epic 4 (10 stories — 1×S, 6×M, 2×L) e Epic 3 (8 stories).

> **Paralelização possível:** 5.5 (backend Visão) e 5.4 (chat panel) podem correr em paralelo após 5.3. 5.8 (dark mode), 5.9 (toasts/empty) e 5.10 (responsive sweep) podem correr em paralelo entre si após 5.6. 5.1 → 5.2 → 5.3 é o caminho crítico (≈ 3 sprints leves).

## 6. Riscos Macro

| ID | Risco | Probabilidade | Impacto | Mitigação proposta |
| -- | ----- | ------------- | ------- | ------------------ |
| R-5.1 | **`packages/ui` introduz refactor cross-package potencialmente extenso** — `MoneyDisplay`/`DateDisplay` centralizados implicam tocar todas as vistas Finanças (Epic 4) e potencialmente Tarefas. Refactor mal feito = regressões visuais. | Alta | Médio | Story 5.2 entrega `MoneyDisplay`/`DateDisplay` mas refactor dos call-sites é incremental (não bloqueia merge da story). Cada call-site refactored tem teste de snapshot. Pattern de migração documentado no PR de 5.2. |
| R-5.2 | **Dark mode leak — cores claras em modo escuro** — AC4 exige "modo escuro completo (sem leak de cores claras)". Tailwind dark: classes ad-hoc em 11 telas = risco alto de gaps. | Alta | Médio | Story 5.8 inclui audit-script (`scripts/audit-dark-mode.ts`) que faz grep de classes `bg-white`/`text-black`/etc. sem `dark:` counterpart. Falha o script = falha story. Testes visuais em modo escuro nas 11 telas (Playwright screenshot diff opcional). |
| R-5.3 | **Persistência de tema cross-device — Zustand+localStorage vs `user_prefs.theme`** — architecture §8.3 prescreve `localStorage` (per-device); FR22 diz "por utilizador" (ambíguo). Decisão errada = re-trabalho. | Média | Médio | DP2 decide explicitamente. Recomendação preliminar: `user_prefs.theme` (cross-device coerente com "por utilizador"); fallback localStorage no SSR para evitar flash. |
| R-5.4 | **Widget config JSONB sem schema explícito** — `widgets_enabled jsonb` é flexível mas pode degenerar em estrutura ad-hoc. | Média | Médio | Story 5.1 define Zod schema `WidgetsEnabledSchema` (record `widget_id → boolean`) com lista enum dos widgets válidos. Migrations idempotent: default JSONB inclui todos os widgets default ON conforme front-end-spec §5.4. Validação no PATCH endpoint. |
| R-5.5 | **Briefing diário com latência alta** — `briefing-daily` composto por 5 sub-queries (tarefas hoje, atrasadas, balanço-mês, recorrências-próximas, gastos-ontem) pode exceder NFR2 p95 < 500ms se serial. | Média | Alto | Story 5.5: queries em paralelo (`Promise.all`), cada uma com seu índice. EXPLAIN ANALYZE no PR. Budget p95 < 500ms para briefing composto; cada sub-query < 100ms. Cache de 60s no servidor (se utilizador refresca em < 1min, mesma resposta). |
| R-5.6 | **Chat panel persistente — duplicação de estado entre `/jarvis` fullscreen e panel** — se utilizador escreve no panel e depois abre `/jarvis`, mensagem desaparece. | Alta | Alto | Story 5.4: estado do chat em store partilhado (Zustand `chatStore`) ou query cache TanStack. `<ChatPanel mode="fullscreen">` em `/jarvis` lê o MESMO store que o panel collapsible. Teste E2E: enviar no panel, navegar para `/jarvis`, ver mensagem. |
| R-5.7 | **Layout shell quebra rotas existentes** — Tarefas/Finanças assumem `max-w-5xl` centrado; sidebar+chat panel altera layout. | Média | Médio | Story 5.3: refactor é grandfather-friendly — main content area mantém-se em coluna central com max-width responsiva, sidebar e chat panel são overlays/aside laterais. Snapshot test de cada vista existente após shell change. |
| R-5.8 | **Lighthouse mobile < 85 difícil sem optimizações JS-bundle** — Next 15 + AI SDK + Zustand + Tailwind = bundle não-trivial. | Média | Médio | Story 5.10: medir baseline antes (não definir AC sem dados). Se < 85, escalar a 80 como AC interim com plano de optimização Fase 2 (dynamic imports, code splitting). PRD Epic 5 quality gate "Lighthouse ≥ 85" é aspiracional — ajustar se baseline mostrar 70-80. |
| R-5.9 | **Undo toast — race condition entre acções consecutivas** — utilizador faz acção A (undo token T1), depois acção B (T2) em < 30s. O toast deve mostrar T2 e abandonar T1 (T1 já não é "última operação"). | Média | Médio | Story 5.9: `undoStore` mantém apenas o último token; ao receber T2, substitui T1 (T1 ficará no histórico do agente mas não no toast). Documentar comportamento em microcopy (`"A acção anterior já não pode ser anulada por aqui — usa o chat"`). |
| R-5.10 | **`packages/ui` adiciona build-step que quebra `transpilePackages`** — CLAUDE.md menciona `packages/db` é "source-only" via `transpilePackages: ['@meu-jarvis/db']`. Aplicar mesmo padrão a `@meu-jarvis/ui` é o esperado, mas falha pode quebrar dev. | Baixa | Alto | Story 5.2 reusa padrão `transpilePackages`. `next.config.ts` actualizado para `['@meu-jarvis/db', '@meu-jarvis/ui']`. Teste de `pnpm dev` + `pnpm build` no PR. |

## 7. Dependências Críticas

**Internas (Epics anteriores — todos Done):**

- **Epic 1 / Story 1.3** (Supabase + Drizzle): schema `user_prefs` existe; Story 5.1 estende-o.
- **Epic 1 / Story 1.5** (Auth + RLS): middleware autentica `(app)/*`; Story 5.3 mantém intacto.
- **Epic 2 / Story 2.7** (Preview-then-confirm): `<PreviewCard>` e `<JarvisChat>` existem; Story 5.4 extrai para `<ChatPanel>` shared.
- **Epic 2 / Story 2.8** (Undo Inngest): backend de undo entrega `reverse_op` + `expires_at` na response. Story 5.9 consome no toast global.
- **Epic 3 / Stories 3.3-3.5** (Tarefas views): vistas existem e serão consumidas pelos widgets de tarefas (5.5/5.6).
- **Epic 4 / Stories 4.6-4.9** (Finanças views): vistas existem e serão consumidas pelos widgets de finanças (5.5/5.6).
- **Front-end-spec.md** (Uma, 2026-05-04, v1.0): branding, tokens, 14 wireframes, microcopy PT-PT, WCAG AA, dark mode, responsive — *fonte da verdade* para Stories 5.2, 5.6, 5.8, 5.10.

**Externas (acção Eurico/@devops):**

- **Nenhum bloqueador externo novo identificado.** Não exige novas keys, novos providers, novos serviços. Tudo opera dentro do stack actual (Next.js + Tailwind + Zustand + Postgres + Supabase Auth).
- **Validação Eurico das DPs em §8** antes de detalhar as stories (mínimo DP2, DP3, DP6).

**Bloqueadores cross-epic:**

- **Epic 6 (Onboarding e Billing) depende do shell entregue por este epic** — o flow de onboarding pós-registo precisa do `<ChatPanel>` montável (Story 5.4), do `<EmptyState>` (Story 5.9) e do `WidgetGrid` (Story 5.6). Adiamentos no Epic 5 atrasam Epic 6.

## 8. Decisões Pendentes — VALIDADAS

> **Validado por Eurico em 2026-05-23.** As 8 decisões foram revistas uma a uma e o Eurico **aceitou integralmente as 8 recomendações preliminares**. A coluna "Decisão validada" abaixo é agora a fonte de verdade para o detalhamento das stories. O bloqueio de planeamento está levantado — `@sm *draft 5.1` autorizado.

| ID | Decisão | Decisão validada (Eurico 2026-05-23) |
| -- | ------- | ------------------------------------ |
| **DP1** | Layout shell — sidebar fixa vs collapsible no desktop | **A — Sidebar fixa 240px** em desktop; collapsible em tablet/mobile via hamburger. Espaço para chat panel resolve-se com main central + chat aside collapsible (collapsed por default, ícone visível para abrir). |
| **DP2** | Persistência do tema (claro/escuro) — cross-device ou per-device | **C — Híbrido.** `user_prefs.theme text` ("light"/"dark"/"system") é fonte de verdade no servidor (sem flash no SSR); `localStorage` é cache para mudança imediata no cliente; toggle PATCH `/api/conta/preferencias` actualiza ambos. |
| **DP3** | `widgets_enabled` — schema JSONB vs tabela dedicada | **A — JSONB com Zod schema** `Record<WidgetId, boolean>` em `user_prefs.widgets_enabled`. Migration de extensão (1 ALTER). Default JSONB com 5 widgets default-ON conforme front-end-spec §5.4 (briefing, tasks-today, finance-month, recurrences-next, tasks-overdue). |
| **DP4** | Widget config UI — onde fica o toggle | **B — Inline em `/visao`** (wireframe §5.4): botão `[+ Adicionar widget]` + ícone `⚙` por widget. Persistência debounced. Sem investimento UI dedicado em `/conta/preferencias` para isto. |
| **DP5** | `/` (raiz) redirecciona para | **A — `/visao`** como landing autenticada. `/jarvis` está sempre a um clique via sidebar + chat panel. Chat-first do PRD §3.2 = "chat sempre disponível", não "chat como home". |
| **DP6** | `packages/ui` — criar agora (Story 5.2) ou adiar | **A — Criar na Story 5.2.** Workspace `@meu-jarvis/ui` com tokens + `MoneyDisplay` + `DateDisplay`. Refactor call-sites Epic 4 é incremental e não bloqueia merge. Coerente com architecture §8.4. |
| **DP7** | Briefing diário — pré-computado por cron ou on-demand | **C — On-demand com cache HTTP 60s** no RSC. Queries em paralelo (`Promise.all`) com índices dedicados; budget p95 < 500ms para briefing composto. Re-avaliar B na Fase 2 se 10K+ households. |
| **DP8** | Chat panel — fullscreen sempre disponível ou só em `/jarvis` | **A — Panel collapsible em todas as rotas + `/jarvis` mantida** como rota dedicada (vista fullscreen com histórico completo + right rail). Estado partilhado via Zustand store para coerência fullscreen↔panel (R-5.6). |

### 8.1 Registo das opções consideradas (histórico)

| ID | Decisão | Opções consideradas | Recomendação preliminar |
| -- | ------- | ------------------- | ----------------------- |
| **DP1** | **Layout shell — sidebar fixa vs collapsible no desktop?** | A) Sidebar fixa 240px em desktop (sempre visível); collapsible em tablet/mobile via hamburger. B) Sidebar sempre collapsible (toggle visível) — economiza espaço para chat panel. C) Sidebar overlay (Drawer) em todos os breakpoints. | **A**. Coerente com wireframe §5.4 e com aplicações de produtividade que o público-alvo conhece (Notion, Things, Todoist). Espaço para chat panel resolve-se com max-width central + chat aside collapsible (collapsed por default, ícone visível para abrir). |
| **DP2** | **Persistência do tema (claro/escuro) — cross-device ou per-device?** | A) `user_prefs.theme text` ("light" / "dark" / "system") — cross-device. B) Zustand persist em `localStorage` — per-device (architecture §8.3 indica isto). C) Híbrido — `user_prefs.theme` é fonte de verdade no servidor; localStorage é cache para evitar flash no SSR. | **C**. FR22 diz "por utilizador" (sugere cross-device); architecture §8.3 indica localStorage (per-device). Híbrido satisfaz ambos: server-side render usa `user_prefs.theme` (no flash de tema errado no SSR), client persiste em localStorage para responsividade imediata, mudança via toggle PATCH a `/api/conta/preferencias` e actualiza ambos. |
| **DP3** | **`widgets_enabled` — schema JSONB vs tabela dedicada?** | A) `user_prefs.widgets_enabled jsonb` com Zod schema `Record<WidgetId, boolean>`. Default JSONB com todos os widgets default-ON conforme front-end-spec §5.4. B) Tabela `user_widget_prefs` (user_id, widget_id, enabled). Mais relacional, mais rígido. C) Per-household widgets default + per-user override (2 colunas). | **A**. KISS para MVP. Apenas 7 widgets identificados; JSONB com Zod validation suficiente. Migration de extensão (1 ALTER) vs 2 migrations (create table + RLS policies). Re-avaliar B na Fase 2 se número de widgets explodir ou se houver necessidade de ordering/positioning. |
| **DP4** | **Widget config UI — onde fica o toggle on/off?** | A) Página dedicada `/conta/preferencias` com secção "Widgets do Visão". B) Inline em `/visao` — botão `[+ Adicionar widget]` (wireframe §5.4 sugere isto) + ícone `⚙` por widget. C) Modal global acessível via topbar. | **B**. Wireframe §5.4 já mostra o pattern; mantém o utilizador no contexto. Coerente com produtos comparáveis (Notion blocks, Linear dashboards). Story 5.7 implementa inline com persistência debounced. Toggle global "ver todos" em `/conta/preferencias` como atalho secundário (sem investimento UI dedicado). |
| **DP5** | **`/` (raiz) redirecciona para `/visao` ou para `/jarvis`?** | A) `/visao` — dashboard como landing autenticada (default na maioria dos SaaS). B) `/jarvis` — chat-first conforme PRD §3.2 ("chat-first: acção primária é escrever ao agente"). C) Último estado salvo do utilizador. | **A**. `/visao` mostra *contexto* (briefing, gastos, tarefas) o que é mais valioso à abertura. `/jarvis` está sempre a um clique (sidebar + chat panel). Coerente com wireframe §5.4 (landing autenticada é o dashboard). PRD §3.2 chat-first significa "chat sempre disponível", não "chat como home". |
| **DP6** | **`packages/ui` — criar agora (Story 5.2) ou refactor incremental?** | A) Story 5.2 cria workspace `@meu-jarvis/ui` com tokens + `MoneyDisplay` + `DateDisplay`; refactor call-sites Epic 4 é parte da story. B) Apenas tokens partilhados em `apps/web/src/lib/design-tokens.ts` (sem workspace novo); criar `packages/ui` quando houver 2+ consumidores. C) Adiar `packages/ui` para Epic 7+; Epic 5 vive com Tailwind inline + utils locais. | **A**. Architecture §8.4 prescreve `packages/ui` explicitamente. Custo da criação é baixo (folder + `package.json` + `tsconfig.json` + `transpilePackages` config). Sem ele, `MoneyDisplay`/`DateDisplay`/`EmptyState` vivem em `apps/web` sem caminho fácil para reuso (Epic 6 vai precisar de muitos destes). Refactor call-sites incremental — não bloqueia merge. |
| **DP7** | **Briefing diário — pré-computado por cron ou on-demand RSC?** | A) On-demand: cada GET `/visao` compõe o briefing das 5 sub-queries em paralelo. B) Cron Inngest diário às 06:00 UTC materializa em tabela `briefing_cache` per household. C) Sub-query dedicada que é cached HTTP por 60s no RSC. | **C**. NFR2 p95 < 500ms é alcançável on-demand se queries em paralelo + índices certos (R-5.5 mitigação). Cron pré-computado adiciona complexidade (idempotência + invalidação quando user adiciona tarefa às 09:00 e refresca a `/visao`). Cache RSC 60s é o equilíbrio: latência boa, conteúdo "fresco o suficiente". Re-avaliar B na Fase 2 se 10K+ households. |
| **DP8** | **Chat panel — fullscreen sempre disponível ou só em `/jarvis`?** | A) Chat panel collapsible em todas as rotas; `/jarvis` mantém-se como rota dedicada (vista fullscreen com histórico completo). B) Chat panel substitui `/jarvis` — rota `/jarvis` redirecciona para `/visao?chat=open`. C) Chat panel só em `/visao`; outras rotas têm FAB que abre `/jarvis`. | **A**. PRD §3.2 "chat-first" = chat acessível de qualquer lado. Mas o utilizador que quer ver o histórico longo do chat ainda beneficia da rota dedicada `/jarvis` com vista fullscreen + right rail de histórico (wireframe §5.5). Manter ambos é a opção mais flexível. Stores partilhadas (R-5.6) garantem coerência. |

## 9. Métricas de Sucesso

**Métricas de produto (epic Done quando atingidas):**

- **AC PRD Epic 5 AC1:** Visão renderiza widgets escolhidos com dados reais.
- **AC PRD Epic 5 AC2:** Chat envia prompt, mostra streaming, persiste no histórico.
- **AC PRD Epic 5 AC3:** Layout funciona em desktop, tablet e mobile responsivo.
- **AC PRD Epic 5 AC4:** Modo escuro completo (sem leak de cores claras).
- **AC PRD Epic 5 AC5:** Toda a copy visível é PT-PT validada.
- **AC adicional:** Toggle de widget persiste e é respeitado em refresh (RLS — utilizador A não vê widgets de utilizador B).

**Métricas operacionais:**

- Latência p95 da query `briefing-daily` < 500ms (NFR2).
- Latência p95 de `GET /visao` (com 5 widgets default ON) < 800ms inclusivo de SSR.
- Audit-script dark mode com zero leaks (R-5.2).
- Cobertura de testes ≥ 70% no `packages/ui` (NFR16).
- RLS Coverage Gate verde após ALTER `user_prefs` (NFR5).
- Lighthouse Performance ≥ 85 em mobile (target; ver R-5.8 para ajuste se baseline o exigir).
- Lighthouse Accessibility ≥ 95 (WCAG AA — front-end-spec §9).

**Métricas de negócio (medidas após launch):**

- % de utilizadores que customizam widgets na primeira semana ≥ 25% (proxy de engagement com a Visão).
- % de prompts enviados via chat panel vs `/jarvis` fullscreen — proxy do valor do panel persistente.
- % de utilizadores que adoptam modo escuro ≥ 30% (proxy de retenção — utilizadores que customizam ficam mais).

## 10. FRs/NFRs Cobertos

**Functional Requirements (do PRD §2.1):**

- **FR20** — Aplicação web com chat principal sempre acessível (sidebar ou layout split).
- **FR21** — Dashboard "Visão" com widgets configuráveis (toggle on/off): tarefas hoje, tarefas atrasadas, briefing diário, balanço financeiro do mês, próximos eventos recorrentes, central de operações.
- **FR22** — Modo claro e modo escuro com toggle persistente por utilizador.
- **FR23** — Aplicação é PT-PT exclusivo no MVP (sem i18n, sem hooks de tradução).
- **FR6** (extensão UI) — Indicador de undo (toast 30s) visível em qualquer rota (Story 2.8 backend; este epic UI).
- **FR4** (extensão UI) — Toggle `always_preview` co-localizado com toggle de tema em `/conta/preferencias`.

**Non-Functional Requirements (do PRD §2.2):**

- **NFR2** — Latência p95 de operações CRUD < 500ms; aplicado aos endpoints agregadores da Visão.
- **NFR4** — First Contentful Paint < 2s em conexão 4G (medido em Story 5.10).
- **NFR5** — RLS Postgres activa em `user_prefs` (gate CI obrigatório — já satisfeito, mantido após ALTER da Story 5.1).
- **NFR13/14** — OTel nas queries agregadoras + métricas de latência por widget.
- **NFR16** — Cobertura de testes ≥ 70% no `packages/ui`.
- **NFR19** — Imports absolutos `@/...` e `@meu-jarvis/...` (incluindo `@meu-jarvis/ui`).

**Constraints (do PRD §2.3):**

- **CON3** — PT-PT exclusivo (copy dos widgets, empty states, microcopy, mensagens de undo).
- **CON8** — Cada story validada por @po antes de @dev implementar.

## Change Log

| Versão | Data | Autor | Mudanças |
| ------ | ---- | ----- | -------- |
| v0.1 | 2026-05-23 | Morgan (@pm) | Draft inicial — skeleton + 10 stories alta-nível + 10 riscos + 8 decisões pendentes. Scope ajustado ao estado real do codebase: layout/visao/jarvis/conta/preferencias placeholders existem e serão refactored; `packages/ui` não existe, é criado em Story 5.2; schema `user_prefs` precisa de migration de extensão na Story 5.1. |
| v1.0 | 2026-05-23 | Morgan (@pm) | 8 DPs validadas por Eurico — aceitou integralmente as 8 recomendações preliminares. §8 reescrita com a decisão validada como fonte de verdade; histórico das opções movido para §8.1. Status Draft → Validated. Bloqueio de planeamento levantado: `@sm *draft 5.1` autorizado. |

---

*Documento de planeamento por Morgan (@pm AIOX) em 2026-05-23. Pré-condições de detalhamento de stories satisfeitas:*
*1) Epic 4 Done — verificado (10/10 stories Done 2026-05-23, gate APPROVED em `22fb136`).*
*2) Front-end-spec.md v1.0 validado (2026-05-04) — fonte da verdade para tokens, wireframes, microcopy, dark mode, responsive.*
*3) Decisões pendentes §8 — VALIDADAS por Eurico 2026-05-23 (8/8 recomendações aceites).*
*Próximo passo autorizado: `@sm *draft 5.1` (Schema `user_prefs` extensão + reconciliação documental).*

*Toda decisão técnica é rastreável a FR/NFR/CON do PRD, ao front-end-spec ou ao schema/codebase real verificado, conforme Constitution Article IV — No Invention.*
