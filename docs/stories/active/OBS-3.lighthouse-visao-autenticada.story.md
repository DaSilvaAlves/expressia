# Story OBS-3: Medir Lighthouse da /visao autenticada e completar runbook

## Status

InReview

> **Regra de transição de estado (PO-S1):** esta story só pode passar a **Done** após a medição real da `/visao` autenticada pelo Eurico (valor Lighthouse + captura de ecrã como evidência). Concluído o trabalho autónomo do @dev (T1 procedimento + T3.1/T3.2 moldura da tabela), o estado correcto é **InReview** — nunca Done sem o número real. T2 (medição), AC1/AC2/AC5 (valores reais) e AC4 (decisão Plano Fase 2) ficam pendentes da acção do Eurico. Proibido marcar Done com valores inventados ou estimados (Constitution Article IV).

## Executor Assignment

```yaml
executor: "@dev"
quality_gate: "@sm"
quality_gate_tools:
  - "verificação manual do runbook preenchido"
  - "captura de ecrã Lighthouse como evidência obrigatória"
```

## Story

**As a** utilizador do Expressia e membro da equipa de produto,
**I want** saber o score real de Lighthouse Performance da rota `/visao` com uma sessão autenticada activa (com os 7 widgets carregados),
**so that** o `docs/runbooks/lighthouse-mobile.md` reflicta métricas honestas da rota mais complexa da app, e possamos decidir com base em dados se é necessário accionar o Plano Fase 2 de optimização de performance (dynamic imports, code splitting por rota, revisão do First Load JS).

## Contexto e âmbito (ler antes das ACs)

O runbook `docs/runbooks/lighthouse-mobile.md` (origem: Story 5.10) já documenta o procedimento de medição mobile (secção 1) e contém as métricas baseline de `/` (landing, Performance 99), `/entrar` (Performance 96) e `/visao` (Performance 95 — valor **não real**).

O valor 95 para `/visao` corresponde ao **redirect target** `/entrar?next=/visao` e não à `/visao` autenticada: um pedido Lighthouse CLI sem cookies de sessão é interceptado pelo `middleware.ts` e redireccionado para `/entrar`. A `/visao` autenticada — que carrega até 7 widgets (`<WidgetGrid>`) — nunca foi medida.

Esta story fecha esse gap, referenciado honestamente na nota da linha 57 e na secção 2 do próprio runbook, completando o estado do Plano Fase 2 (secção 3 do runbook) com base na métrica real.

**Restrição de honestidade (Constitution Article IV — medições reais, zero invenção):** a medição da `/visao` autenticada exige uma sessão real no browser. Um agente headless NÃO consegue trivialmente autenticar-se na app (cookies Supabase httpOnly; sem fluxo de login programático aprovado para esta story). Por isso:

- O agente PODE fazer o trabalho de preparação (validar o procedimento, estruturar a secção no runbook, garantir que o comando Lighthouse está correcto com flags de cookies/sessão se aplicável).
- A **medição real** (DevTools → Lighthouse → Mobile com sessão iniciada) é uma subtask **deferida** para o Eurico ou para uma sessão assistida. O agente NÃO deve inventar nem estimar valores.
- O runbook só pode ser marcado completo após evidência real (captura de ecrã ou valor registado pelo Eurico).

**Precedente:** padrão de subtasks deferidas sem evidência inventada, seguido em Story 6.8 (T1.2 e T4.6-live — bloqueador externo, não marcadas como feitas).

**Âmbito minor:** não há código de produção a alterar. O único entregável de código é o preenchimento do `docs/runbooks/lighthouse-mobile.md` com a métrica real e a avaliação do Plano Fase 2.

## Acceptance Criteria

> Rastreabilidade: Epic 5 §5/§6 (R-5.8), front-end-spec §13.1 (performance goals — Performance ≥ 85 mobile), PRD NFR4 (FCP < 2s), Constitution Article IV (medições reais — zero invenção), catálogo soft-launch `mj-handoff-followups-soft-launch-20260615.yaml` item OBS-3.

1. **Medição real da `/visao` autenticada** — o score de Lighthouse Performance (mobile, CPU 4×, 4G simulado, build de produção) para a `/visao` com sessão iniciada e widgets carregados é registado no runbook com valor numérico real. A medição é feita via painel Lighthouse do Chrome DevTools com sessão activa (ou via Lighthouse CLI com `--extra-headers` de cookies de sessão, se o procedimento for viável — ver AC3). **Proibido inventar ou estimar o valor.**

2. **Runbook actualizado** — a secção 2 do `docs/runbooks/lighthouse-mobile.md` tem uma nova linha na tabela de métricas para `/visao` **autenticada** (distinta da linha de redirect existente), com todos os campos preenchidos com valores reais: Performance, Accessibility, FCP, LCP, TBT, CLS.

3. **Procedimento de medição validado** — a secção 1 do runbook é revista/complementada com a alternativa de medição autenticada:
   - Alternativa A (recomendada, sem CLI): Chrome DevTools → painel Lighthouse → device "Mobile" → throttling "Slow 4G / 4× CPU" → com sessão de utilizador autenticada no browser → auditar `/visao`.
   - Alternativa B (opcional, CLI com sessão): se viável, documentar o comando Lighthouse CLI com `--extra-headers` ou cookie file para sessão autenticada.
   O procedimento documentado na secção 1.2 (CLI sem sessão) mantém-se inalterado — é válido para rotas públicas.

4. **Plano Fase 2 — avaliação condicional** (secção 3 do runbook):
   - **Se Performance ≥ 85:** confirmar no runbook que o Plano Fase 2 continua "não aplicável" para o MVP, com referência ao valor real medido. As acções candidatas (dynamic import dos widgets, code splitting por rota, revisão do First Load JS — já documentadas na secção 3) ficam como follow-up pós-MVP.
   - **Se Performance < 85:** o Plano Fase 2 passa a "aplicável" — abrir uma nova story de optimização com as acções candidatas por ordem de impacto (já documentadas na secção 3 do runbook). Escalar ao @architect.
   Nenhuma optimização de performance é implementada nesta story — apenas a avaliação da necessidade.

5. **Nota de honestidade removida** — após a medição real ser registada, remover (ou actualizar) a nota da linha 57 do runbook que admite que o valor de `/visao` corresponde ao redirect target. Substituir pela referência ao valor real medido e ao procedimento utilizado.

6. **Zero alterações a código de produção** — esta story não toca em `apps/web/src/`, `packages/`, `.github/`, migrations, nem qualquer ficheiro de código. O único ficheiro modificado é `docs/runbooks/lighthouse-mobile.md`. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm check:rls`, `pnpm build` mantêm-se nos seus estados actuais.

## CodeRabbit Integration

> **CodeRabbit Integration**: Disabled
>
> CodeRabbit CLI não está activo em `core-config.yaml` (precedente stories SEC-1→SEC-11, RGPD-1, OBS-1, 6.8).
> A validação de qualidade usa o processo de revisão manual pelo @sm.

## Tasks / Subtasks

- [x] T1 — Validar o procedimento de medição autenticada (AC: 3)
  - [x] T1.1 — Rever a secção 1.2 do runbook (`docs/runbooks/lighthouse-mobile.md`) e confirmar os flags do Lighthouse CLI que já estão documentados para rotas públicas.
  - [x] T1.2 — Avaliar a viabilidade do Lighthouse CLI com sessão (flag `--extra-headers` com cookie de sessão Supabase httpOnly): cookie `sb-*` confirmado httpOnly (`@supabase/ssr` `createServerClient` no `middleware.ts`) → **inviável/inseguro**; documentada apenas Alternativa A (DevTools) e justificada a rejeição da Alternativa B no runbook §1.4.
  - [x] T1.3 — Escrever/rever a subsecção "Medição de rotas autenticadas" na secção 1 do runbook (nova §1.4), com o procedimento passo-a-passo para a Alternativa A (DevTools mobile com sessão).

- [ ] T2 — **[DEFERIDA — requer sessão Eurico]** Medir `/visao` autenticada e registar resultado (AC: 1, 2)
  - [ ] T2.1 — (Eurico) Iniciar sessão em `https://expressia.pt` (ou `https://expressia-black.vercel.app`) com uma conta de teste.
  - [ ] T2.2 — (Eurico) Abrir o painel Lighthouse no Chrome DevTools (F12 → Lighthouse), configurar: Device = Mobile, Throttling = Slow 4G / 4× CPU, Categories = Performance + Accessibility.
  - [ ] T2.3 — (Eurico) Navegar para `/visao` (com os widgets carregados) e correr a auditoria Lighthouse.
  - [ ] T2.4 — (Eurico) Registar: Performance, Accessibility, FCP, LCP, TBT, CLS. Guardar captura de ecrã do relatório como evidência.
  - [ ] T2.5 — Preencher a linha da `/visao` autenticada na tabela de métricas da secção 2 do runbook com os valores reais registados.

- [x] T3 — Actualizar a secção 2 do runbook com a nova linha de métricas (AC: 2, 5) — **moldura preenchida; valores deferidos a T2**
  - [x] T3.1 — Adicionar linha nova à tabela (secção 2) para `/visao` **autenticada** (distinta da linha existente de redirect), com placeholders explícitos `_(a medir — sessão Eurico, OBS-3 T2)_` em todas as células de valor (zero valores inventados).
  - [x] T3.2 — Manter a linha existente de `/visao` (→ redirect `/entrar?next=/visao`), anotada claramente como "redirect target, NÃO a `/visao` real".
  - [ ] T3.3 — **[DEFERIDA — parte de remoção, requer valor real T2]** Actualizar/remover a nota de limitação do runbook (§1.3): a nota foi **actualizada** para referenciar a medição autenticada pendente (OBS-3 T2, sessão Eurico) e apontar para a nova §1.4. A **remoção** da nota só ocorre DEPOIS de existir o valor real (T2).

- [ ] T4 — Avaliar e actualizar o Plano Fase 2 (AC: 4)
  - [ ] T4.1 — Com base no valor real de Performance medido em T2, aplicar a decisão condicional da secção 3 do runbook:
    - Performance ≥ 85 → confirmar "não aplicável" no runbook com o valor real.
    - Performance < 85 → marcar "aplicável", rascunhar story de optimização com as acções candidatas (secção 3.1-3.3 do runbook), escalar ao @architect.
  - [ ] T4.2 — Actualizar a secção 3 do runbook para reflectir a decisão tomada e o valor que a suporta.

- [x] T5 — Verificação final e gates (AC: 6)
  - [x] T5.1 — Confirmado via `git status`: apenas `docs/runbooks/lighthouse-mobile.md` (+ a própria story) foram modificados. Zero alterações a `apps/`, `packages/`, `.github/`, migrations.
  - [x] T5.2 — Doc-only: sem alterações de código → `pnpm lint`/`typecheck`/`test`/`build`/`check:rls` mantêm-se nos estados anteriores; não re-corridos (não afectados).

## Dev Notes

### Ficheiro alvo único

O único ficheiro a modificar nesta story é:
- `docs/runbooks/lighthouse-mobile.md` — origem: Story 5.10 (`5.10.responsive-sweep-branding-auth-lighthouse.story.md`).

### Gap exacto a fechar

O runbook já tem:
- Secção 1: procedimento de medição CLI (sem sessão) + alternativa DevTools.
- Secção 2: tabela de métricas com linha para `/visao` **mas com o valor do redirect target** (`/entrar?next=/visao` — Performance 95). A nota da linha 57 admite esta limitação honestamente.
- Secção 3: Plano Fase 2 marcado como "não aplicável" com base em métricas de rotas públicas, mas com cláusula condicional explícita: "Caso uma futura medição da `/visao` **autenticada** (com 7 widgets activos, via DevTools com sessão) desça abaixo de 85, as acções candidatas a Fase 2 seriam..."

O que falta: o valor real da `/visao` autenticada, para que a secção 3 seja incondicionalmente decidida.

### Por que o CLI sem sessão não serve

O `middleware.ts` da app interceta pedidos sem sessão autenticada às rotas `/visao` e faz redirect para `/entrar?next=/visao`. O Lighthouse CLI corre como browser headless sem cookies, pelo que mede o redirect target e não a rota real.

A medição autenticada via DevTools é a alternativa documentada e aprovada (secção 1.2 do próprio runbook: "Alternativa sem CLI: Chrome DevTools → painel Lighthouse → device 'Mobile' + throttling 'Slow 4G / 4× CPU'").

### Precedente de subtask deferida sem evidência inventada

Story 6.8 (export GDPR): as subtasks T1.2 (confirmação do bucket `exports` no Supabase Storage) e T4.6-live (E2E de upload real) ficaram marcadas `[ ]` porque dependiam de acção externa do Eurico (criar o bucket). O agente não inventou evidência de funcionamento. O mesmo padrão aplica-se aqui: a medição real (T2) fica `[ ]` até o Eurico a executar.

[Source: `docs/stories/active/6.8.export-gdpr.story.md` Tasks T1.2 / T4.6; Completion Notes §SUBTASKS DEFERIDAS]

### Widgets carregados na /visao

A `/visao` carrega até 7 widgets via `<WidgetGrid>` (`grid-cols-1 md:grid-cols-2 lg:grid-cols-3`). A widget `tasks_today` tem `order-first` para aparecer ao topo em mobile. Os widgets envolvem chamadas a endpoints `/api/visao/*` (Story 5.5, 7 endpoints), pelo que o LCP pode ser influenciado pelo tempo de resposta em produção.

A medição deve ser feita em produção real (não em localhost) para reflectir o comportamento com latência de rede real e o bundle de produção do Vercel.

[Source: `docs/runbooks/lighthouse-mobile.md` secção 4.3 — `/visao` OK em 390px + 768px; `docs/stories/active/5.5` — 7 endpoints /api/visao/*]

### Acções candidatas do Plano Fase 2 (já documentadas no runbook, secção 3)

Caso Performance < 85:
1. `dynamic(() => import(...))` nos widgets pesados da Visão (carregamento lazy abaixo da dobra).
2. Code splitting por rota do `(app)` (cada vista de Finanças/Tarefas só carrega o seu bundle).
3. Revisão do First Load JS partilhado (≈ 207 kB no baseline) — auditar dependências do shell.

Não implementar nesta story — apenas avaliar a necessidade.

### Ambiente de medição recomendado

- **URL:** `https://expressia.pt` (domínio público, se já activo) ou `https://expressia-black.vercel.app` (fallback se DNS-001 ainda pendente).
- **Build:** produção (Vercel). Não medir em localhost.
- **Throttling:** Mobile, Slow 4G, CPU 4× (equivalente ao Lighthouse CLI com os flags da secção 1.2 do runbook).
- **Sessão:** conta de teste com dados existentes (alguns widgets com conteúdo) para forçar o carregamento real dos 7 widgets.

[Source: `docs/runbooks/lighthouse-mobile.md` secção 1.1 e 1.2; `docs/runbooks/dns-expressia-setup.md`; `mj-handoff-followups-soft-launch-20260615.yaml` §caminho_critico — DNS-001]

### Testing

Esta story não tem testes automatizados — é documentação e medição manual.

- **Evidência obrigatória:** captura de ecrã do relatório Lighthouse com o score de Performance da `/visao` autenticada. Deve acompanhar a actualização do runbook.
- **Gate de qualidade:** o @sm valida que (a) o runbook contém o valor real (não estimado), (b) a linha da `/visao` autenticada é distinta da linha de redirect, (c) a decisão do Plano Fase 2 está documentada com base no valor real, (d) nenhum ficheiro de código foi alterado.
- **Gates de código:** mantêm-se inalterados (sem alterações a `apps/`, `packages/`, etc.). Não é necessário correr `pnpm lint`/`typecheck`/`test`/`check:rls`/`build` para esta story — mas se forem corridos por precaução, devem manter os resultados anteriores.

## Change Log

| Data | Versão | Descrição | Autor |
|------|--------|-----------|-------|
| 2026-06-18 | v1.0 | Draft inicial — gap /visao autenticada identificado no runbook (secção 2 linha 57 + secção 3 condicional) | River (@sm) |
| 2026-06-18 | v1.1-DEV | Scope autónomo (PO GO 8,5/10): T1 (§1.4 procedimento autenticado + veredicto Alternativa B inviável) + T3.1/T3.2 (moldura tabela §2 com placeholders) + nota §1.3/§3 actualizadas. T2/T3.3-remoção/T4 deferidos ao Eurico (medição real). Status → InReview (PO-S1: nunca Done sem valor real). Doc-only, zero código. | Dex (@dev) |
| 2026-06-18 | v1.1-WAIVED | Gate @qa = CONCERNS (REQ-001: núcleo deferido por design) **aceite WAIVED pelo Eurico**. Devolver ao @dev sem efeito útil (nada a corrigir; só falta a medição externa). Story mantém-se **InReview** até medição real. Handoff criado: `mj-handoff-obs3-inreview-await-medicao-20260618`. Sem push (ciclo /sdc sem `--push`). | orchestrator (/sdc) |

## Dev Agent Record

### Agent Model Used

Dex (@dev) — Opus 4.8 (1M context). Modo YOLO autónomo, **scope reduzido** ao trabalho autónomo conforme condição do GO do PO (8,5/10): T1 + moldura T3.1/T3.2; medição real (T2) e decisões dependentes do número (T3.3-remoção, T4) deferidas ao Eurico.

### Debug Log References

Nenhuma falha. Verificação técnica para fundamentar o veredicto da Alternativa B (CLI com sessão):
- `apps/web/src/middleware.ts` — `createServerClient` (`@supabase/ssr`) gere a sessão via cookies SSR; JWT TTL 1h refrescado por request via `getUser()` (§5.1). Confirma que (a) o cookie `sb-*` é httpOnly (não acessível via JS), (b) um cookie estático em `--extra-headers` não dispara o refresh-token flow → medição não-reprodutível/expirada.
- `git status --short` — evidência de âmbito de ficheiros (T5.1).

### Completion Notes List

**Entregue (trabalho autónomo doc-only):**
- **T1.1/T1.2/T1.3** — Nova subsecção **§1.4 "Medição de rotas autenticadas (com sessão)"** no runbook:
  - **Alternativa A (recomendada)** — procedimento passo-a-passo Chrome DevTools → Lighthouse → Device=Mobile, Categories=Performance+Accessibility, Throttling Slow 4G/4× CPU (equivalente aos flags CLI da §1.2), com sessão iniciada (conta de teste com dados para forçar os 7 widgets), medir em produção real, registar 6 métricas + captura de ecrã.
  - **Alternativa B (CLI com sessão) — avaliada e rejeitada como inviável/insegura.** Justificação honesta (cookie `sb-*` httpOnly não extraível por JS; JWT TTL 1h sem refresh via `--extra-headers` → medição não-reprodutível; risco de segurança ao expor token vivo em linha de comandos). **Não inventei nem documentei um comando CLI autenticado** que não verifiquei funcionar (Constitution Article IV).
- **T3.1** — Linha nova na tabela §2 para `/visao` autenticada (7 widgets), com placeholders explícitos `_(a medir — sessão Eurico, OBS-3 T2)_` em **todas** as 6 células de valor. Zero números inventados.
- **T3.2** — Linha de redirect existente mantida, re-anotada como "**redirect target, NÃO a `/visao` real**".
- **T3.3 (parte de actualização)** — Nota de honestidade da §1.3 actualizada para referenciar a medição autenticada pendente (OBS-3 T2) e apontar para a §1.4.
- **§3 Plano Fase 2** — Acrescentada nota de que a avaliação fica **pendente** da medição real (continua condicional); secção 3 mantém-se intacta na sua estrutura condicional.
- **T5.1** — `git status` confirma: só `docs/runbooks/lighthouse-mobile.md` (+ esta story) modificados.

**DEFERIDO ao Eurico (Constitution Article IV — proibido inventar/estimar valores Lighthouse):**
- **T2.x (medição real)** — Deixadas `[ ]`. Exige sessão real no browser; um agente headless não autentica de forma segura (ver veredicto Alternativa B). Eurico mede via §1.4 Alternativa A e regista os 6 valores + captura de ecrã.
- **T2.5** — Preenchimento da linha com valores reais: `[ ]` (depende de T2.4).
- **T3.3 (parte de remoção)** — A **remoção** da nota de limitação da §1.3 só ocorre DEPOIS de existir o valor real. Mantida `[ ]`.
- **T4.x (decisão Plano Fase 2)** — `[ ]`. A decisão "aplicável/não aplicável" para a `/visao` autenticada depende do número real (≥ 85 vs < 85). Secção 3 deixada condicional; não decidida.

**Estado:** InReview (NUNCA Done — regra PO-S1: só Done após medição real do Eurico + evidência).

### File List

**Modificados:**
- `docs/runbooks/lighthouse-mobile.md` — nova §1.4 (procedimento autenticado: Alternativa A recomendada + Alternativa B rejeitada), linha nova na tabela §2 (`/visao` autenticada com placeholders), nota §1.3 actualizada (medição pendente + ref §1.4), nota condicional acrescentada à §3 (avaliação pendente). **Zero valores Lighthouse inventados.**
- `docs/stories/active/OBS-3.lighthouse-visao-autenticada.story.md` — esta story (checkboxes, Dev Agent Record, Change Log, Status).

**Não modificados (confirmados via `git status`):** `apps/`, `packages/`, `.github/`, migrations — zero alterações a código de produção.

## QA Results

### Review Date: 2026-06-18

### Reviewed By: Quinn (Test Architect)

Gate de qualidade executado sobre o trabalho autónomo doc-only (T1 + moldura T3.1/T3.2 + notas §1.3/§3). Avaliação focada na QUALIDADE e CORRECÇÃO do entregue — não como story de código incompleta (o deferimento do núcleo ao Eurico é por design, aprovado pelo PO GO 8,5/10, precedente Story 6.8).

**Validação técnica (verificada contra código de produção):**

- **§1.4 Alternativa A (DevTools com sessão)** — Procedimento correcto e executável pelo Eurico. Fluxo Navigation/Mobile/Performance+Accessibility/Slow 4G+4×CPU corresponde ao painel Lighthouse real; equivalência aos flags CLI da §1.2 (`--throttling-method=simulate` + `cpuSlowdownMultiplier=4`) tecnicamente sólida. Medição em produção real com conta de dados para forçar os 7 widgets — decisão certa.
- **§1.4 Alternativa B (CLI rejeitada)** — Avaliação solidamente fundamentada, **sem furos**, confirmada contra `apps/web/src/middleware.ts`: (1) cookie `sb-*` httpOnly via `createServerClient` (`@supabase/ssr`, linhas 21/54); (2) JWT TTL 1h + refresh por request via `getUser()` (JSDoc linha 7, linha 79) — cookie estático em `--extra-headers` não dispara o refresh-flow (depende do middleware reescrever cookies na response, linhas 62-70); (3) risco de segurança (token vivo em linha de comandos) num SaaS multi-tenant. Recusa honesta de documentar comando CLI não verificado.
- **Honestidade (Constitution Article IV)** — ZERO valores Lighthouse inventados. Os 6 placeholders `_(a medir — … OBS-3 T2)_` na linha autenticada são inequívocos. Nota §1.3 **actualizada** (não removida prematuramente) — correcto face a AC5.
- **Distinção redirect vs autenticada** — Linha de redirect re-anotada "redirect target, NÃO a `/visao` real"; linha autenticada distinta com nota dedicada. Inequívoco.
- **Scope contido (AC6)** — `git status` confirma só `docs/runbooks/lighthouse-mobile.md` (+ a própria story). Diff confinado a §1.3/§1.4/§2/§3, zero alterações a baselines ou §4/§5/§6. Afirmação doc-only verdadeira — gates de código não afectados.
- **Coerência story↔entrega** — Checkboxes `[x]`/`[ ]` correctos; Dev Agent Record, File List e Change Log honestos. Blindagem PO-S1 contra Done prematuro adequada.

**Issue rastreada (não bloqueante da qualidade):** REQ-001 (medium) — o núcleo T2 (medição real) e AC1/AC2/AC4/AC5 ficam deferidos ao Eurico; a story permanece InReview até ao valor real + captura de ecrã.

### Gate Status

Gate: CONCERNS → docs/qa/gates/OBS-3-lighthouse-visao-autenticada.yml

A story está completa no scope autónomo, mas **não pode transitar para Done** até à medição real do Eurico (regra PO-S1). Próximo passo: Eurico mede via §1.4 Alternativa A, regista valores + captura, aplica a árvore de decisão da §3, e actualiza/remove a nota §1.3.
