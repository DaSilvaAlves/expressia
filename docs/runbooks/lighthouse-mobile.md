# Runbook — Lighthouse mobile + auditoria responsiva (Story 5.10)

**Story de origem:** `docs/stories/active/5.10.responsive-sweep-branding-auth-lighthouse.story.md`
**Trace:** Epic 5 §5/§6 (R-5.8), front-end-spec §10 (responsive strategy) / §13.1 (performance goals), PRD NFR4 (FCP < 2s), Constitution Article IV (medições reais — zero invenção).

Este runbook documenta (1) o procedimento de medição de performance mobile com Lighthouse, (2) os resultados da auditoria responsiva das 15 telas reais, (3) as métricas Lighthouse baseline medidas a 2026-06-15 e o AC numérico adoptado, (4) os breakpoints de referência, e (5) a avaliação de necessidade de um Plano Fase 2.

---

## 1. Procedimento de medição (Lighthouse mobile)

### 1.1 Pré-condição — build + server de produção

As medições representativas exigem o **build de produção** (`pnpm build` + `pnpm start`), nunca o dev server (`next dev` tem overhead de HMR + React DevTools que distorce o score).

```bash
# A partir da raiz do repo
pnpm build
pnpm --filter @meu-jarvis/web start   # http://localhost:3000
```

> **Gotcha conhecido:** correr `pnpm build` e depois `next dev` na mesma pasta `.next` parte o CSS em dev. Se for preciso voltar ao dev server após medir, limpar `.next` e rearrancar.

### 1.2 Ferramenta — Lighthouse CLI

```bash
# Sem instalação global (npx resolve a versão fixada)
npx -y lighthouse@12 http://localhost:3000/<rota> \
  --only-categories=performance,accessibility \
  --form-factor=mobile --screenEmulation.mobile \
  --throttling-method=simulate \
  --throttling.cpuSlowdownMultiplier=4 \
  --chrome-flags="--headless=new --no-sandbox" \
  --output=json --output-path=<saida>.json --quiet
```

Flags-chave (modo mobile representativo):

| Flag | Efeito |
|------|--------|
| `--form-factor=mobile --screenEmulation.mobile` | Emula viewport + user-agent mobile |
| `--throttling-method=simulate` | Throttling Lantern (4G simulado, modelo de rede do Lighthouse) |
| `--throttling.cpuSlowdownMultiplier=4` | CPU 4× mais lenta (gama média mobile) |
| `--only-categories=performance,accessibility` | Reduz tempo (não medimos SEO/PWA neste MVP) |
| `--chrome-flags="--headless=new --no-sandbox"` | Chrome headless sem UI (CI-friendly) |

Alternativa sem CLI: Chrome DevTools → painel Lighthouse → device "Mobile" + throttling "Slow 4G / 4× CPU".

### 1.3 Rotas de referência

| Rota | Porquê |
|------|--------|
| `/` (landing pública) | First impression do produto — porta de entrada (Story 5.10 AC6) |
| `/entrar` | Superfície auth simples (form de login) |
| `/visao` | Rota app mais complexa (até 7 widgets) |

> **Limitação honesta (CLI sem sessão):** `/visao` exige sessão autenticada. Um pedido Lighthouse sem cookies de sessão é interceptado pelo `middleware.ts` e redireccionado para `/entrar?next=/visao` — pelo que o CLI mede, de facto, a **página de destino do redirect** (`/entrar`), não a `/visao` renderizada com widgets. A `/visao` autenticada não é mensurável por CLI sem um fluxo de login programático (fora do scope desta story — DP-5.10.C rejeita E2E Playwright). Para medir a `/visao` real, usar o painel Lighthouse do Chrome DevTools com uma sessão iniciada manualmente. O valor abaixo para `/visao` corresponde ao redirect target.

---

## 2. Métricas Lighthouse (baseline 2026-06-15)

Medições reais, mobile, CPU 4× slowdown, 4G simulado (Lantern), build de produção `pnpm start` em `localhost:3000`. Lighthouse 12.8.2 / Chrome headless.

| Rota | Performance | Accessibility | FCP | LCP | TBT | CLS |
|------|:-----------:|:-------------:|:---:|:---:|:---:|:---:|
| `/` (landing) | **99** | **95** | 0,8 s | 1,0 s | 140 ms | 0 |
| `/entrar` | **96** | **95** | 0,8 s | 2,6 s | 120 ms | 0 |
| `/visao` (→ redirect `/entrar?next=/visao`) | 95 | 95 | 0,9 s | — | — | 0 |

### 2.1 AC numérico adoptado (DP-5.10.A = B)

O baseline de Performance medido (95–99 em mobile) está **acima de 85** em todas as rotas públicas mensuráveis. Pela árvore de decisão DP-5.10.A = B (baseline ≥ 85 → AC dura "≥ 85"):

- **AC de Performance adoptado: Lighthouse Performance ≥ 85 (mobile).** Baseline `/` = 99, `/entrar` = 96 — folga confortável.
- **Accessibility: ≥ 95 (AC dura, front-end-spec §9 WCAG AA).** Medido = 95 em todas as rotas — cumpre exactamente o target.
- **FCP (NFR4): < 2 s em 4G simulado.** Medido = 0,8–0,9 s — muito abaixo do limite.

> Não há AC interim "≥ 80" nem necessidade de escalação a @architect (baseline ≥ 85 — caminho A da DP-5.10.A=B).

---

## 3. Plano Fase 2 (performance)

**Não aplicável.** O baseline de Performance ≥ 95 em todas as rotas mensuráveis excede o target ≥ 85 com folga, pelo que **não é necessário** um plano Fase 2 (dynamic imports, code splitting por rota, optimização de bundle AI SDK) nesta fase do MVP.

Caso uma futura medição da `/visao` **autenticada** (com 7 widgets activos, via DevTools com sessão) desça abaixo de 85, as acções candidatas a Fase 2 seriam, por ordem de impacto esperado:

1. `dynamic(() => import(...))` nos widgets pesados da Visão (carregamento lazy abaixo da dobra).
2. Code splitting por rota do `(app)` (cada vista de Finanças/Tarefas só carrega o seu bundle).
3. Revisão do First Load JS partilhado (≈ 207 kB no baseline) — auditar dependências do shell.

Estas acções ficam registadas como follow-up condicional, **não** como trabalho desta story.

---

## 4. Auditoria responsiva — resultados (AC1)

Método: smoke manual documentado (DP-5.10.C = A) por inspecção dirigida do código de layout + verificação visual em DevTools responsive. Breakpoints auditados: **mobile 390px** (iPhone 14) e **tablet 768px** (iPad). Critérios por tela: (a) sem overflow horizontal / texto cortado; (b) touch targets ≥ 44×44px; (c) layout não quebra (sem sobreposição/colunas esmagadas); (d) navegação acessível (hamburger/FAB em mobile — Story 5.3).

Legenda: **OK** = sem quebras · **FIX** = quebra corrigida inline nesta story · **SCOPE-OUT** = melhoria adiada para Epic 6 (documentada).

### 4.1 Pública (1 tela)

| Tela | Mobile 390px | Tablet 768px | Notas |
|------|:------------:|:------------:|-------|
| `/` (landing nova — AC6) | OK | OK | `max-w-md` centrado, CTAs full-width `min-h-11` (44px ✓), wordmark `font-serif`, claim `text-balance`. Lighthouse A11y 95. |

### 4.2 Auth (3 telas — branding já via tokens, Story 6.1)

| Tela | Mobile 390px | Tablet 768px | Notas |
|------|:------------:|:------------:|-------|
| `/entrar` | OK | OK | Card `max-w-sm` centrado; inputs full-width `py-2`; tokens `bg-canvas`/`bg-surface`. |
| `/registar` | OK | OK | Idem `/entrar`; form mais longo, scroll vertical natural. |
| `/recuperar` | OK | OK | Form mínimo; sem overflow. |

> Auditoria auth puramente visual/responsiva (sem trabalho de branding — antigo AC2 entregue pela Story 6.1).

### 4.3 App (11 telas)

| Tela | Mobile 390px | Tablet 768px | Notas |
|------|:------------:|:------------:|-------|
| `/visao` | OK | OK | `<WidgetGrid>` `grid-cols-1 md:grid-cols-2 lg:grid-cols-3` (1 coluna em mobile); `tasks_today` flutua ao topo (`order-first`). |
| `/jarvis` | OK | OK | Chat fullscreen; input fixo; sem overflow. |
| `/tarefas` | OK | OK | Lista densa; `main` com `overflow-x-hidden` (rede de segurança do AppShell). |
| `/tarefas/kanban` | OK | OK | `overflow-x-auto` + scroll-snap horizontal — colunas deslizam em mobile (padrão intencional, não quebra). |
| `/tarefas/calendario` | FIX | OK | `WeekNavigation`: spacer de simetria `w-[140px]` passou a `hidden sm:block` (evitava pressão sobre o label em ≤390px). Semana via `overflow-x-auto`. |
| `/financas/este-mes` | FIX | OK | `MonthNavigation`: spacer de simetria `w-[150px]` passou a `hidden sm:block` (mesma razão). |
| `/financas/variaveis` | OK | OK | Lista de transacções; sem larguras fixas problemáticas. |
| `/financas/recorrentes` | OK | OK | Idem. |
| `/financas/cartoes` | OK | OK | Cards em grid responsivo. |
| `/financas/patrimonio` | OK | OK | Agregação por banco; sem overflow. |
| `/conta/preferencias` | OK | OK | Form de preferências; controlos full-width. |

> `/financas` (raiz) é um `redirect('/financas/este-mes')` — não é tela distinta, não conta para o total de 11.

### 4.4 Componentes shared auditados (Stories 5.8 / 5.9)

| Componente | Mobile | Tablet | Notas |
|------------|:------:|:------:|-------|
| `<AppShell>` (sidebar drawer + FAB) | OK | OK | Sidebar como drawer overlay < 1024px; FAB chat bottom-right (Story 5.3/5.4). |
| `<EmptyState>` (`@meu-jarvis/ui`, Story 5.9) | OK | OK | Centrado, `max-w` legível. |
| `<UndoToast>` / `UndoToastBridge` (Story 5.9) | OK | OK | Toast fixo bottom; não sobrepõe o FAB em mobile. |
| Dark mode (Story 5.8) | OK | OK | Sem leak de cores hardcoded nas telas novas/corrigidas (grep negativo). |

### 4.5 Itens SCOPE-OUT (Epic 6)

- **Bottom tab bar mobile** (front-end-spec §10.3): a navegação mobile actual usa o drawer da sidebar (hamburger). Uma `bottomTabBar` dedicada "app-like" é uma melhoria de Epic 6 — fora do scope da 5.10 (front-end-spec §10.1 define mobile como "funcional", não "app-like").

**Resultado AC1:** 15 telas (1 pública + 3 auth + 11 app) × 2 breakpoints auditadas. 2 FIX inline (spacers de navegação `hidden sm:block`); 0 quebras não-documentadas; 1 melhoria SCOPE-OUT documentada.

---

## 5. Breakpoints de referência (front-end-spec §10.2)

| Nome | Largura | Dispositivo de referência | Auditado nesta story |
|------|---------|---------------------------|:--------------------:|
| mobile | 0–639px | iPhone 14 (390px) | Sim (390px) |
| tablet | 640–1023px | iPad (768px) | Sim (768px) |
| desktop | 1024–1439px | Laptop | Não (revisto em stories anteriores) |
| wide | 1440px+ | Monitor | Não |

Tailwind: as variantes `sm:` (≥640px), `md:` (≥768px), `lg:` (≥1024px) mapeiam estes limites. O `<WidgetGrid>` usa `md:`/`lg:` para a transição 1→2→3 colunas.

---

## 6. Notas de execução

- **CI Lighthouse:** fora de scope (DP-5.10.B = B — "opcional" no epic). Estas medições são manuais/documentadas; um gate CI com `@lhci/cli` é um follow-up possível pós-baseline.
- **Re-medir:** repetir a secção 1 sempre que se alterar o shell, o bundle partilhado, ou se adicionar dependências de runtime pesadas à landing/auth/visão.
