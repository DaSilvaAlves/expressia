# meu-jarvis UI/UX Specification

**Autora:** Uma (UX Design Expert)
**Data:** 2026-05-04
**Versão:** 1.0 (MVP — Fase 1, PT-PT exclusivo)
**Estado:** Draft (pré-validação @architect, pré-implementação)
**Inputs:** `docs/prd.md` v1.1, `docs/project-brief.md` v1.1, `JARVIS.txt` (anti-inspiração)

Este documento define a experiência visual, padrões de interacção, sistema de design e copy do `meu-jarvis`. Serve de base para `@architect` (front-end architecture) e `@dev` (implementação). Toda a copy de exemplo aqui apresentada é production-ready em PT-PT.

---

## 1. Visão UX e Princípios

### 1.1 UX Vision

`meu-jarvis` é um assistente que reduz fricção operacional na vida de famílias e profissionais portugueses. A experiência tem que comunicar **calma, controlo e confiança** — três valores raros em produtos AI contemporâneos. Onde o ChatGPT comunica capacidade infinita e o Néctar comunica energia hype-tech, `meu-jarvis` comunica "isto está sob controlo, eu trato disto".

A arquitectura visual é **chat-first com habitat secundário**: o chat é o ponto onde a maior parte do tempo é gasto, mas existem dashboards (Visão), módulos (Tarefas, Finanças) e configurações para os momentos em que o utilizador quer ver, organizar ou ajustar manualmente. O chat é o motor; a UI é a casa.

### 1.2 Princípios de Design (5)

1. **Calma sobre energia** — palette neutra, espaços brancos generosos, animações curtas (<200ms), tipografia editorial. Anti-padrão: gradientes neon, vibração ChatGPT, escuro+amarelo Néctar.
2. **Chat-first, mas nunca refém** — toda a acção possível via chat é também possível via UI. Utilizador em pânico ou cansado pode sempre clicar.
3. **Preview-then-confirm** — quando confiança AI < 70% ou acção é destrutiva, mostrar cartão de confirmação. Edit-in-place no preview, não modal.
4. **Undo first-class** — toast com botão "Anular" durante 30s após cada acção do agente. Falha graciosa não é "perdoa-me", é "anula isso".
5. **Manipulação directa** — drag-and-drop em Kanban e calendário. Edição inline em listas. Menos cliques, menos modais.

### 1.3 Personas (do PRD)

| Persona | Idade/Contexto | Necessidade UX |
|---------|----------------|----------------|
| João e Sofia | 38/35, casal Lisboa, 2 filhos | Vista partilhada de família, orçamento conjunto auto-actualizado, copy clara |
| Inês | 36, advogada freelancer Porto | Densidade informacional alta, separação despesas pessoais/ENI, atalhos teclado |
| Diogo | 29, engenheiro Aveiro | Atalhos teclado, dark mode, comportamento previsível, exposição de keyboard shortcuts |

### 1.4 Goals de Usabilidade

- **Aprendizagem rápida:** novo utilizador completa o primeiro prompt útil em < 90s após registo
- **Eficiência:** power user (Diogo) cria tarefa+finança via chat em < 5s desde cursor no chat até confirmação
- **Prevenção de erros:** zero acções destrutivas sem undo ou confirmação explícita
- **Memorização:** utilizador que volta após 14 dias completa fluxo principal sem reler tutorial

---

## 2. Branding

### 2.1 Naming

**Recomendação:** **Manter `meu-jarvis` como codename interno; lançar publicamente como "Astro"**.

| Opção | Avaliação | Verdict |
|-------|-----------|---------|
| `meu-jarvis` (actual) | Reconhecível mas: (1) "Jarvis" é trademark Marvel/Stark, risco legal; (2) tom masculino-só; (3) "meu" é PT-BR-coded em ambiguidade ("o meu Jarvis" PT-PT vs "meu Jarvis" PT-BR); (4) não é distintivo em SEO. | **Reject como nome público** |
| **Astro** | Curto (5 letras), pronunciável idêntico em todos os mercados PT, evoca orientação/bússola/céu (calmo, confiável), sem baggage AI. Disponível como domínio com sufixo (`astro.pt`, `useastro.pt`). Não compete com "Astro" framework web (mercado diferente). | **Recomendado** |
| Aurelia | Bonito, clássico PT, mas longo (7 letras) e tom feminino-só. Risco SEO com nome próprio comum. | Rejeitada |
| Hélio | Curto, PT-rooted, evoca sol/calor — mas próximo demais de "AI helper" cliché. | Rejeitada |
| Bússola | Conceptualmente perfeito (orientação) mas longo, difícil pronunciar internacionalmente, soa institucional. | Rejeitada |

**Posicionamento copy do nome:**
- Hero copy: *"Astro — o assistente que organiza a tua vida em português."*
- Tagline: *"Uma frase. Tudo organizado."*
- NÃO usar: "AI", "inteligente", "revolucionário", "automático", "Jarvis", referências Iron Man.

> **Decisão final pendente do Eurico.** Restante deste documento usa `Astro` como nome de produto e `meu-jarvis` como codename de repo.

### 2.2 Logo Concept

**Descrição textual** (handoff para designer visual):

- **Símbolo:** uma única forma — um círculo com um traço vectorial interior que sugere uma seta de bússola apontando NE (norte-nordeste, equivalente visual a "para a frente"). Geometria simples, executável em 16×16px sem perder legibilidade.
- **Versões:** símbolo solo (favicon, app icon), símbolo + wordmark horizontal, wordmark solo.
- **Wordmark:** "Astro" em Lora SemiBold 600, letter-spacing -0.01em, com o "A" partilhando o ângulo da seta interior do símbolo (ligadura subtil).
- **Cor primária:** Atlântico (#1F4F6A) sobre fundo claro; off-white (#F7F4EE) sobre fundo escuro.
- **Anti-padrão explícito:** nada de cérebros, nada de circuitos, nada de partículas, nada de gradientes.

### 2.3 Tom Visual

| Inspiração (alvo) | Anti-inspiração (evitar) |
|-------------------|--------------------------|
| Linear (densidade calma, sidebar limpa, atalhos) | Néctar (escuro+amarelo, hype) |
| Things 3 (espaço branco, tipografia generosa) | ChatGPT (neon, gradientes, vibe lab) |
| MyMind (warmth, paleta orgânica) | Notion AI (overload de features) |
| Stripe Dashboard (dados densos sem agressão) | Copilot (cinzentos cliché Microsoft) |

**Atributos:** calmo, sóbrio, confiável, contemporâneo, mediterrânico, editorial.

---

## 3. Design Tokens

Tokens preparados para Tailwind CSS (`tailwind.config.ts`) e CSS variables (`:root` + `.dark`). Formato compatível com shadcn/ui.

### 3.1 Cores — Modo Claro (default)

| Nome semântico | Token CSS | Hex | Uso |
|----------------|-----------|-----|-----|
| Background | `--bg-canvas` | `#FAFAF7` | Fundo de página (off-white, ligeiro creme) |
| Surface | `--bg-surface` | `#FFFFFF` | Cartões, painéis elevados |
| Surface muted | `--bg-muted` | `#F0EEE8` | Linhas zebra, hover states subtis |
| Border | `--border-default` | `#E5E2D9` | Divisores, contornos |
| Border strong | `--border-strong` | `#C8C3B5` | Inputs com foco, contornos enfatizados |
| Text primary | `--text-primary` | `#1A1A1A` | Texto principal |
| Text secondary | `--text-secondary` | `#525252` | Texto suporte, labels |
| Text muted | `--text-muted` | `#8A857A` | Placeholders, metadados |
| Primary (Atlântico) | `--primary` | `#1F4F6A` | Acção principal, links, CTA |
| Primary hover | `--primary-hover` | `#163A4F` | Hover do primary |
| Primary subtle | `--primary-subtle` | `#E6EEF3` | Background de chips/badges primários |
| Accent (Cortiça) | `--accent` | `#B5754A` | Destaque editorial, premium, Família tier |
| Accent subtle | `--accent-subtle` | `#F4ECE3` | Background de chips/badges accent |
| Success | `--success` | `#3F7D58` | Confirmação, saldo positivo |
| Success subtle | `--success-subtle` | `#E5F0E9` | Background de toast sucesso |
| Warning | `--warning` | `#B8862E` | Avisos, atrasos suaves |
| Warning subtle | `--warning-subtle` | `#F8EFD9` | Background de toast warning |
| Danger | `--danger` | `#A33A2E` | Erros, eliminação, saldo negativo |
| Danger subtle | `--danger-subtle` | `#F5E2DE` | Background de toast erro |

### 3.2 Cores — Modo Escuro

| Nome semântico | Token CSS | Hex | Notas |
|----------------|-----------|-----|-------|
| Background | `--bg-canvas` | `#0F1311` | Verde-petróleo muito escuro (não preto puro — anti-Néctar) |
| Surface | `--bg-surface` | `#171C1A` | Cartões |
| Surface muted | `--bg-muted` | `#1F2624` | Hover, zebra |
| Border | `--border-default` | `#2A322F` | |
| Border strong | `--border-strong` | `#3A4541` | |
| Text primary | `--text-primary` | `#F0EEE8` | |
| Text secondary | `--text-secondary` | `#B5B0A4` | |
| Text muted | `--text-muted` | `#7A766C` | |
| Primary (Atlântico claro) | `--primary` | `#5C9BBE` | Versão lifted para contraste em dark |
| Primary hover | `--primary-hover` | `#7AB1D0` | |
| Primary subtle | `--primary-subtle` | `#1E3343` | |
| Accent (Cortiça claro) | `--accent` | `#D29465` | |
| Accent subtle | `--accent-subtle` | `#3A2D20` | |
| Success | `--success` | `#7DB585` | |
| Warning | `--warning` | `#D4A85D` | |
| Danger | `--danger` | `#D17068` | |

### 3.3 Tipografia

**Famílias:**
- **UI / Body:** `Inter` (variable) — fallback `system-ui, -apple-system, sans-serif`
- **Editorial / Display:** `Lora` (variable, serif) — fallback `Georgia, serif`
- **Numérico / Monospace:** `JetBrains Mono` — fallback `ui-monospace, monospace`

**Justificação:** Inter é o standard contemporâneo para densidade UI; Lora adiciona warmth editorial em headers e empty states (anti-feel "tech lab"); JetBrains Mono garante alinhamento perfeito de valores monetários e datas.

**Type Scale (1.250 modular, base 16px):**

| Element | Size | Line height | Weight | Family | Uso |
|---------|------|-------------|--------|--------|-----|
| Display | 40px / 2.5rem | 48px | 600 | Lora | Onboarding hero, empty states |
| H1 | 32px / 2rem | 40px | 600 | Lora | Título de página principal |
| H2 | 24px / 1.5rem | 32px | 600 | Inter | Secção de página |
| H3 | 20px / 1.25rem | 28px | 600 | Inter | Sub-secção, card title |
| H4 | 16px / 1rem | 24px | 600 | Inter | Card secundário |
| Body | 15px / 0.9375rem | 24px | 400 | Inter | Texto principal |
| Body small | 13px / 0.8125rem | 20px | 400 | Inter | Metadados, labels |
| Caption | 12px / 0.75rem | 16px | 500 | Inter | Tags, badges |
| Mono | 14px / 0.875rem | 20px | 500 | JetBrains Mono | Valores €, datas, atalhos |
| Mono small | 12px / 0.75rem | 16px | 500 | JetBrains Mono | Metadados numéricos |

**Note:** todos os valores monetários (€1.234,56) e datas (14/03/2026) usam JetBrains Mono para alinhamento perfeito em colunas de tabelas.

### 3.4 Spacing Scale

Sistema 4px base. Tailwind defaults compatíveis.

| Token | px | rem | Uso típico |
|-------|----|----|------------|
| `space-0` | 0 | 0 | Reset |
| `space-1` | 4 | 0.25 | Gap entre ícone e label |
| `space-2` | 8 | 0.5 | Gap dentro de chip |
| `space-3` | 12 | 0.75 | Gap em listas densas |
| `space-4` | 16 | 1 | Padding standard de cartão |
| `space-5` | 20 | 1.25 | Gap entre cartões |
| `space-6` | 24 | 1.5 | Padding de secção |
| `space-8` | 32 | 2 | Espaço entre secções |
| `space-10` | 40 | 2.5 | Espaço entre módulos da página |
| `space-12` | 48 | 3 | Margem superior de página |
| `space-16` | 64 | 4 | Spacing hero |

### 3.5 Border Radius

| Token | px | Uso |
|-------|----|----|
| `radius-sm` | 4 | Inputs, badges densos |
| `radius-md` | 8 | Botões, chips |
| `radius-lg` | 12 | Cartões |
| `radius-xl` | 16 | Modais, sheets |
| `radius-2xl` | 24 | Hero cards, onboarding |
| `radius-full` | 9999 | Avatars, dot indicators |

### 3.6 Shadows

Sombras suaves, calibradas para fundo creme (não para preto puro Material).

| Token | Valor | Uso |
|-------|-------|-----|
| `shadow-xs` | `0 1px 2px rgba(26,26,26,0.04)` | Inputs em foco |
| `shadow-sm` | `0 2px 4px rgba(26,26,26,0.05)` | Cartões em repouso |
| `shadow-md` | `0 4px 12px rgba(26,26,26,0.08)` | Cartões hover, dropdowns |
| `shadow-lg` | `0 12px 32px rgba(26,26,26,0.10)` | Modais, sheets |
| `shadow-xl` | `0 24px 48px rgba(26,26,26,0.12)` | Toasts, popovers críticos |

### 3.7 Transitions

| Token | Duration | Easing | Uso |
|-------|----------|--------|-----|
| `transition-fast` | 120ms | `cubic-bezier(0.4, 0, 0.2, 1)` | Hover, focus |
| `transition-default` | 180ms | `cubic-bezier(0.4, 0, 0.2, 1)` | Mudanças de estado |
| `transition-slow` | 240ms | `cubic-bezier(0.4, 0, 0.2, 1)` | Sheets, modais |
| `transition-spring` | 320ms | `cubic-bezier(0.34, 1.56, 0.64, 1)` | Drag-drop, undo toast |

`prefers-reduced-motion`: todas as durações reduzidas a 0ms; transformações trocadas por opacity-only.

---

## 4. Component Library

### 4.1 Decisão

**Escolha:** **shadcn/ui + Radix UI primitives + Tailwind CSS + Lucide Icons.**

| Critério | shadcn/ui | Material UI | Mantine | Custom from scratch |
|----------|-----------|-------------|---------|---------------------|
| Ownership de código | Total (copy-paste) | Vendored | Vendored | Total |
| Acessibilidade out-of-box | Excelente (Radix) | Excelente | Boa | Tem que construir |
| Customização | Trivial | Complexa | Razoável | Trivial mas caro |
| Time to MVP | Rápido | Médio | Rápido | Lento |
| Performance bundle | Excelente | Pesado | Médio | Excelente |
| Aderência ao branding `Astro` | Total | Difícil | Difícil | Total |

shadcn/ui dá-nos componentes Radix com Tailwind, sem dependência runtime — código vive no nosso repo, podemos reescrever variantes sem fork. Critico dado o tom calmo/editorial específico que queremos (Material seria too much, Mantine too generic).

**Icons:** Lucide (lightweight, consistente, MIT). Banimos emojis em UI funcional (PRD §3.1 tom sóbrio).

### 4.2 Componentes Core (35)

#### Tier 1 — Foundations (8)
1. **Button** — variants: `primary`, `secondary`, `ghost`, `danger`, `link`. Sizes: `sm`, `md`, `lg`. States: rest, hover, focus, active, disabled, loading.
2. **Input** — text, email, password, number-EUR (com formatação automática `€1.234,56`), search.
3. **Textarea** — auto-grow, max-rows, contador de caracteres opcional.
4. **Select** — single, com search, com grupos.
5. **Checkbox** — labelled, indeterminate state.
6. **Radio Group** — orientação horizontal/vertical.
7. **Switch** — para toggles binários (modo escuro, widget on/off).
8. **Label** — paired com inputs, com tooltip opcional.

#### Tier 2 — Composition (12)
9. **Card** — header, content, footer slots. Variants: `default`, `elevated`, `outlined`.
10. **Sheet** — side drawer (Radix Dialog). Right (default) ou bottom (mobile).
11. **Dialog** — modal central com overlay escuro 60%.
12. **Popover** — para context menus, date pickers compactos.
13. **Tooltip** — delay 400ms, fontes Inter 12px.
14. **Dropdown Menu** — para acções de linha em listas.
15. **Tabs** — horizontal, com underline animado.
16. **Toast** — variants: `default`, `success`, `warning`, `danger`. Slot para acção (botão "Anular").
17. **Badge** — variants: `default`, `success`, `warning`, `danger`, `accent`. Sizes: `sm`, `md`.
18. **Avatar** — com fallback para iniciais. Size: `xs`, `sm`, `md`, `lg`.
19. **Progress** — linear, com valor opcional.
20. **Skeleton** — loaders por componente (card, list-row, chat-message).

#### Tier 3 — Patterns Específicos (15)
21. **ChatMessage** — variants: `user`, `agent`. Slots: avatar, conteúdo, timestamp, acções (copiar, undo).
22. **ChatInput** — textarea auto-grow, sugestões inline acima do input, atalho `Cmd+Enter` para enviar.
23. **PreviewCard** — cartão de confirmação preview-then-confirm. Conteúdo editável inline + botões "Confirmar" / "Editar" / "Cancelar".
24. **TaskCard** — usado em lista, Kanban, calendário. Estados: aberta, completa, atrasada. Drag handle visível em Kanban/calendário.
25. **TransactionRow** — uma linha financeira. Colunas: data, descrição, categoria, valor, conta. Valor a vermelho (saída) ou verde (entrada).
26. **CategoryChip** — pill com cor da categoria + label. 12 cores predefinidas para 12 categorias default.
27. **DateField** — input + popover calendário. Formato `DD/MM/YYYY`, locale `pt-PT`.
28. **MoneyField** — input com prefixo `€`, formatação automática `1.234,56` à medida que utilizador escreve.
29. **RecurrencePicker** — composição (DateField + Select de frequência + sub-opções condicionais).
30. **EmptyState** — ilustração leve em SVG, headline Lora, copy Inter, botão de acção.
31. **WidgetCard** — usado no dashboard Visão. Header com título + menu (toggle off, configurar), content, footer opcional com link "Ver todos →".
32. **KanbanColumn** — composição (header com título + count + menu, lista vertical de TaskCard, drop zone visual).
33. **CalendarWeekView** — composição (header com 7 dias, grid 7 colunas, eventos como TaskCard compactos).
34. **NavSidebar** — nav vertical com secções: módulos (Visão, Chat, Tarefas, Finanças), conta (Perfil, Plano, Convites). Collapsible.
35. **CommandPalette** — `Cmd+K` activa overlay com search + acções rápidas (Diogo persona).

### 4.3 Estados de Componente (Standard)

Todos os componentes interactivos implementam: `default`, `hover`, `focus-visible` (ring 2px primary), `active`, `disabled`, `loading` (onde aplicável).

---

## 5. Wireframes — 14 Core Screens

Wireframes em formato textual estruturado. Toda copy é production-ready PT-PT.

### 5.1 Login

**Propósito:** autenticar utilizador existente.

**Layout (centro vertical, max-width 400px):**

```
┌────────────────────────────────────────────────┐
│                                                 │
│                  [Logo Astro]                    │
│                                                 │
│        Bem-vindo de volta.                       │ ← Lora 32px
│        Continua de onde paraste.                 │ ← Inter 15px secondary
│                                                 │
│  ┌──────────────────────────────────────┐       │
│  │ Email                                 │       │
│  │ [exemplo@dominio.pt]                  │       │
│  └──────────────────────────────────────┘       │
│                                                 │
│  ┌──────────────────────────────────────┐       │
│  │ Palavra-passe                         │       │
│  │ [••••••••]            [👁 mostrar]    │       │
│  └──────────────────────────────────────┘       │
│                                                 │
│         [Entrar]                                │ ← Button primary fullwidth
│                                                 │
│  ───── ou ─────                                 │
│                                                 │
│  [G  Continuar com Google]                      │ ← Button secondary
│  [   Continuar com Apple]                       │
│                                                 │
│  Esqueceste-te da palavra-passe?                │ ← Link
│  Ainda não tens conta? Cria uma.                │
│                                                 │
└────────────────────────────────────────────────┘
```

**Estados:**
- Loading: botão "Entrar" mostra spinner + texto "A entrar...".
- Erro: banner abaixo do input afectado: *"Email ou palavra-passe incorrectos. Tenta de novo ou recupera a tua palavra-passe."* (não revelar qual está errado — segurança).
- Sucesso: redirect para `/visao` (último estado salvo) ou `/onboarding` se primeira sessão.

**Responsivo:** mobile manda card a fullscreen, padding 24px.

**Copy proibida:** "Login" (anglicismo), "Logar" (PT-BR), "Olá!" (demasiado familiar).

---

### 5.2 Sign-up

**Propósito:** criar conta nova.

**Layout (centro, max-width 400px):**

```
┌────────────────────────────────────────────────┐
│                  [Logo Astro]                    │
│                                                 │
│        Cria a tua conta.                         │ ← Lora 32px
│        14 dias grátis. Sem cartão.               │ ← Inter 15px secondary
│                                                 │
│  ┌──────────────────────────────────────┐       │
│  │ Nome                                  │       │
│  │ [Como queres ser tratado]             │       │
│  └──────────────────────────────────────┘       │
│                                                 │
│  ┌──────────────────────────────────────┐       │
│  │ Email                                 │       │
│  │ [exemplo@dominio.pt]                  │       │
│  └──────────────────────────────────────┘       │
│                                                 │
│  ┌──────────────────────────────────────┐       │
│  │ Palavra-passe                         │       │
│  │ [Mínimo 8 caracteres]                 │       │
│  └──────────────────────────────────────┘       │
│  ✓ Mais de 8 caracteres                         │ ← Validação live
│  ✓ Pelo menos 1 número                          │
│                                                 │
│  ☐ Aceito os Termos e a Política de Privacidade│
│                                                 │
│         [Criar conta]                           │
│                                                 │
│  ───── ou ─────                                 │
│  [G  Continuar com Google]                      │
│  [   Continuar com Apple]                       │
│                                                 │
│  Já tens conta? Entrar.                         │
└────────────────────────────────────────────────┘
```

**Microcopy notes:**
- "14 dias grátis. Sem cartão." é a frase de aquisição-chave. Curta, factual, sem hype.
- Nome opcional? Não — é como o agente trata o utilizador no chat ("Olá, João.").
- Termos como link inline, não checkbox separado para cada.

**Estados de erro:**
- Email já registado: *"Já existe uma conta com este email. Queres entrar ou recuperar a palavra-passe?"* (com 2 links).
- Password fraca: validação live, sem submit possível.

---

### 5.3 Onboarding (3 passos)

**Propósito:** orientar novo utilizador, criar household, demonstrar diferenciador multi-intent.

**Layout (fullscreen, progressbar topo, conteúdo centro):**

```
┌────────────────────────────────────────────────┐
│  [Logo]                          Passo 1 de 3   │
│  ━━━━━━━━━━─────────────────────────────         │ ← Progress bar 33%
│                                                 │
│         Como te chamamos?                        │ ← Lora 32px center
│         Vai aparecer no chat e nos              │
│         convites do teu agregado.               │ ← Body secondary
│                                                 │
│        ┌──────────────────────────────┐         │
│        │ João                          │         │
│        └──────────────────────────────┘         │
│                                                 │
│        Qual é o nome do teu agregado?           │
│        Pode ser "Casa dos Santos",              │
│        "Família Rodrigues" ou "Eu" se          │
│        preferes usar sozinho.                   │
│                                                 │
│        ┌──────────────────────────────┐         │
│        │ Casa dos Santos               │         │
│        └──────────────────────────────┘         │
│                                                 │
│  [Saltar tudo]                  [Continuar →]   │
└────────────────────────────────────────────────┘
```

**Passo 2 — Demo do cérebro multi-intent:**

```
┌────────────────────────────────────────────────┐
│  [Logo]                          Passo 2 de 3   │
│  ━━━━━━━━━━━━━━━━━━━━━━━━──────                  │ ← 66%
│                                                 │
│         Escreve uma frase. Vais ver.             │ ← Lora 32px
│                                                 │
│         O Astro vai detectar tudo o que          │
│         tens dentro dessa frase e organizar     │
│         por ti. Experimenta com isto:           │
│                                                 │
│   ┌──────────────────────────────────────┐      │
│   │ Reunião com a Marta amanhã às 15h.   │      │
│   │ Paguei €78,70 no continente.          │      │
│   │ Lembra-me de pagar a renda dia 8.    │      │
│   └──────────────────────────────────────┘      │
│              [Mostrar o que acontece]            │
│                                                 │
│   ↓ Ao carregar, mostra preview:                 │
│                                                 │
│   ✓ Tarefa criada: "Reunião com a Marta"        │
│     amanhã às 15:00                             │
│   ✓ Despesa registada: €78,70 no Continente     │
│     (Mercearia)                                 │
│   ✓ Recorrente criada: Renda, todo o dia 8      │
│                                                 │
│  [Saltar tudo]                    [Continuar →] │
└────────────────────────────────────────────────┘
```

**Passo 3 — Plano:**

```
┌────────────────────────────────────────────────┐
│  [Logo]                          Passo 3 de 3   │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━            │ ← 100%
│                                                 │
│         Tens 14 dias grátis.                     │ ← Lora 32px
│         Sem cartão, sem compromisso.             │
│                                                 │
│   No fim, podes:                                │
│   • Ficar no plano Grátis (1 módulo, 50 prompts)│
│   • Subir para Pessoal €4,90/mês                │
│   • Ou Família €8,88/mês — até 4 pessoas       │ ← Highlighted card
│                                                 │
│   Não decides agora. Só te avisamos no dia 12   │
│   por email. Sem surpresas.                     │
│                                                 │
│                  [Começar a usar]                │
└────────────────────────────────────────────────┘
```

**Microcopy:** "Não decides agora. Só te avisamos no dia 12 por email. Sem surpresas." — calmo, factual, anti-pressão de venda.

**Estados:**
- Saltar tudo é sempre possível. Trial activa-se de qualquer forma.
- Após "Começar a usar" → redirect para `/visao` com toast: *"Bem-vindo, João. O Astro está pronto."*

---

### 5.4 Visão (Dashboard)

**Propósito:** primeira impressão diária, agregar widgets configuráveis.

**Layout (3 colunas em desktop, 1 em mobile):**

```
┌─[Sidebar]──┬─────────────────────────────────────────────┐
│ Logo Astro │  Bom dia, João. Hoje é segunda, 14/03/2026. │ ← Lora 24px
│            │  ─────────────────────────────────────────  │
│ ▾ Visão    │                                             │
│   Chat     │  ┌── Briefing diário ──────────────┐ ⚙ ×    │
│ ▾ Tarefas  │  │ 3 tarefas para hoje, 2 pagam-     │       │
│   Lista    │  │ se em automático. €78,70 gastos   │       │
│   Kanban   │  │ ontem. Sem atrasos pendentes.    │       │
│   Calendár.│  └─────────────────────────────────┘       │
│ ▾ Finanças │                                             │
│   Mensal   │  ┌── Tarefas hoje ─────────┐ ┌── Gastos ──┐ │
│   Cartões  │  │ ☐ Reunião Marta 15:00  │ │ Este mês: │ │
│   Patrim.  │  │ ☐ Devolver livro       │ │ €1.247,30 │ │
│            │  │ ☐ Comprar pão           │ │ −18% vs   │ │
│ ─────────  │  │                         │ │ Fev        │ │
│ ⚙ Conta    │  │ Ver todas →             │ │ Ver mês →  │ │
│ 👥 Convidar│  └─────────────────────────┘ └────────────┘ │
│            │                                             │
│ Plano:     │  ┌── Próximas recorrências ────────┐        │
│ Grátis     │  │ 17/03  Renda                €650,00 │   │
│ [Subir]    │  │ 19/03  Internet            €34,99  │   │
│            │  │ 22/03  Cartão Millennium  €289,00 │   │
│ ─────────  │  └─────────────────────────────────┘       │
│ João S.    │                                             │
│ [Avatar]   │  ┌── Tarefas atrasadas ────────────┐ ⚙ ×   │
│            │  │ ⚠ 2 tarefas a aguardar:          │       │
│            │  │ ☐ Renovar passaporte (há 3 dias)│       │
│            │  │ ☐ Confirmar IRS (há 1 dia)      │       │
│            │  └─────────────────────────────────┘       │
│            │                                             │
│            │  [+ Adicionar widget]                        │ ← Ghost btn
└────────────┴─────────────────────────────────────────────┘
```

**Estado vazio (utilizador novo):**

```
[Empty state grande, centro do main]

           [Ilustração SVG calma — bússola]

         Ainda não há nada para mostrar.

         Carrega no chat e diz "criar tarefa de
         comprar pão amanhã" para começar.

              [Abrir o chat]
```

**Widgets disponíveis (toggle on/off):**
- Briefing diário (default ON)
- Tarefas hoje (default ON)
- Gastos do mês (default ON)
- Próximas recorrências (default ON)
- Tarefas atrasadas (default ON, hidden se vazio)
- Saldo por conta (default OFF)
- Calendário semana (default OFF)

**Estados de loading:** skeleton por widget independente (não bloqueia layout).

**Responsivo:**
- Tablet: 2 colunas.
- Mobile: 1 coluna, sidebar vira hamburger menu, chat acessível por FAB no canto inferior direito.

---

### 5.5 Chat (principal)

**Propósito:** ponto de entrada para todas as acções AI.

**Layout (2 painéis em desktop, fullscreen em mobile):**

```
┌─[Sidebar]──┬──────────────────────────┬─[Right rail]────┐
│            │  Chat                     │ Histórico       │
│            │  ─────────────────────────│                 │
│            │                           │ Hoje            │
│            │  [Avatar] João  10:23     │ • Manhã 10:23   │
│            │  Reunião com a Marta      │                 │
│            │  amanhã às 15h. Paguei    │ Ontem           │
│            │  €78,70 no Continente.   │ • Tarde 17:14   │
│            │                           │                 │
│            │  [○ Astro]  10:23         │ Sexta 11/03     │
│            │  Detectei 2 acções:       │ • 09:01         │
│            │                           │ • 14:32         │
│            │  ┌─ PreviewCard ────────┐ │                 │
│            │  │ ✓ Tarefa             │ │ [Ver tudo]     │
│            │  │   Reunião com Marta  │ │                 │
│            │  │   📅 15/03 15:00     │ │                 │
│            │  │                       │ │                 │
│            │  │ ✓ Despesa            │ │                 │
│            │  │   €78,70 Continente  │ │                 │
│            │  │   Mercearia          │ │                 │
│            │  │                       │ │                 │
│            │  │ [Editar][Confirmar] │ │                 │
│            │  └───────────────────────┘ │                 │
│            │                           │                 │
│            │  ────── 12:14 ────────    │                 │
│            │                           │                 │
│            │  [Avatar] João  12:14     │                 │
│            │  Quanto gastei em         │                 │
│            │  restaurantes este mês?   │                 │
│            │                           │                 │
│            │  [○ Astro]                │                 │
│            │  Em Março gastaste        │                 │
│            │  €124,50 em Restauração   │                 │
│            │  (8 transacções).         │                 │
│            │  ┌─ Mini chart ─┐          │                 │
│            │  │ ▁▃▂▅▁▂▃▁     │          │                 │
│            │  └─────────────┘           │                 │
│            │                           │                 │
│            │  ─────────────────────    │                 │
│            │  Sugestões:               │                 │
│            │  [Mostrar tarefas hoje]   │                 │
│            │  [Resumo do mês]           │                 │
│            │  [Adicionar lembrete]     │                 │
│            │                           │                 │
│            │  ┌─────────────────────┐  │                 │
│            │  │ Escreve aqui...      │  │                 │
│            │  │                       │  │                 │
│            │  └─────────────────────┘  │                 │
│            │  📎 ⌘+↵ enviar     [Enviar]│                 │
└────────────┴──────────────────────────┴─────────────────┘
```

**Padrões críticos:**
- **Sugestões inline acima do input:** 3 chips de prompts contextuais. Clicar preenche input.
- **Streaming:** mensagem do agente aparece com cursor `▊` a piscar enquanto stream activo. Cursor remove-se quando completo.
- **Preview card embedded:** quando confidence < 70% ou acção destrutiva, em vez de executar e mostrar resultado, mostra `PreviewCard` com botões Editar/Confirmar/Cancelar.
- **Toast undo:** após confirmação, toast canto inferior: *"Criadas 2 acções."* + botão "Anular" + countdown 30s.
- **Atalhos:** `Cmd/Ctrl+Enter` envia. `Cmd/Ctrl+K` abre command palette. `↑` no input vazio repete último prompt.

**Empty state primeira vez:**

```
              [Ilustração — bússola]

         Olá, João. Em que posso ajudar?

   Tenta uma destas:
   [Criar tarefa para amanhã]
   [Ver as minhas finanças deste mês]
   [Adicionar uma despesa]
```

**Estados de erro:**
- Falha de rede: mensagem do agente substituída por: *"Não consegui responder agora. A ligação caiu. Tenta de novo daqui a um bocado."* + botão "Tentar de novo".
- LLM timeout (>10s): *"Estou a demorar mais do que o costume. Posso continuar ou queres cancelar?"* + botões.
- Cross-tenant tentativa: silencioso (logged) — apenas mostra resposta normal "Não encontrei nada".

---

### 5.6 Tarefas — Lista

**Propósito:** ver/filtrar/editar tarefas em vista linear densa.

**Layout (sidebar + main, sem right rail):**

```
┌─[Sidebar]──┬────────────────────────────────────────────┐
│            │  Tarefas                            [+ Nova]│
│            │  ─────────────────────────────────────────  │
│            │  [Lista] [Kanban] [Calendário]   ← Tabs     │
│            │                                             │
│            │  🔍 [Procurar...]   Filtros: [Estado ▾] [Tag▾]│
│            │                                             │
│            │  Hoje · 14/03/2026                          │ ← Section H
│            │  ☐  Reunião com a Marta      15:00  #trabalho│
│            │  ☐  Devolver livro à biblioteca   #pessoal   │
│            │  ☐  Comprar pão                              │
│            │                                             │
│            │  Amanhã · 15/03/2026                        │
│            │  ☐  Pagar IRS antes do prazo  #financeiro    │
│            │  ☐  Levar miúdos ao dentista 16:30 #família │
│            │                                             │
│            │  Esta semana                                │
│            │  ☐  Rever orçamento Q1 (Quarta)            │
│            │  ☐  Confirmar férias com a Sofia (Sexta)   │
│            │                                             │
│            │  Atrasadas (2)                              │ ← Em vermelho
│            │  ☐  Renovar passaporte  ⚠ há 3 dias        │
│            │  ☐  Confirmar IRS  ⚠ há 1 dia              │
│            │                                             │
│            │  Concluídas hoje (3) ▾                      │ ← Collapsed
│            │                                             │
└────────────┴────────────────────────────────────────────┘
```

**Interacções:**
- Click na checkbox: completa, anima fade + strike-through, soa nada, toast *"Concluída."* + Anular 30s.
- Click no título: edição inline.
- Click direito (ou `…` icon hover): menu com Editar / Eliminar / Adiar / Mudar prioridade.
- Hover de uma row: fundo `bg-muted`, mostra icon `…` à direita.

**Estados:**
- Empty: *"Nenhuma tarefa para mostrar. Diz ao chat 'criar tarefa de X' ou clica em [+ Nova]."*
- Filtrado vazio: *"Sem tarefas com este filtro. Limpa filtros ou cria uma."*

**Responsivo:** mobile mantém layout, esconde tags por defeito (mostra ao tap).

---

### 5.7 Tarefas — Kanban

**Propósito:** organizar tarefas por estado (workflow visual).

**Layout (4-6 colunas configuráveis, scroll horizontal em mobile):**

```
┌─[Sidebar]──┬────────────────────────────────────────────┐
│            │  Tarefas                            [+ Nova]│
│            │  [Lista] [Kanban] [Calendário]              │
│            │                                             │
│            │  🔍 [Procurar...] [Tag▾]    [⚙ Configurar] │
│            │                                             │
│            │  ┌─Por fazer─┐ ┌─A fazer─┐ ┌─Espera─┐ ┌─Feito─┐│
│            │  │    8       │ │    3     │ │   2    │ │  12   ││ ← Counters
│            │  ├────────────┤ ├──────────┤ ├────────┤ ├───────┤│
│            │  │ ┌────────┐ │ │┌───────┐ │ │┌──────┐│ │┌─────┐ ││
│            │  │ │Reunião │ │ ││Pagar │ │ ││Conf. ││ ││Devol.│ ││
│            │  │ │Marta   │ │ ││IRS   │ │ ││IRS   ││ ││livro │ ││
│            │  │ │📅 15/03│ │ ││📅16/3│ │ ││⚠ -1d ││ ││✓     │ ││
│            │  │ └────────┘ │ │└───────┘ │ │└──────┘│ │└─────┘ ││
│            │  │ ┌────────┐ │ │ ...      │ │        │ │        ││
│            │  │ │Comprar │ │ │          │ │        │ │        ││
│            │  │ │pão     │ │ │          │ │        │ │        ││
│            │  │ └────────┘ │ │          │ │        │ │        ││
│            │  │            │ │          │ │        │ │        ││
│            │  │ [+]        │ │ [+]      │ │ [+]    │ │ [+]    ││ ← Add inline
│            │  └────────────┘ └──────────┘ └────────┘ └───────┘│
└────────────┴────────────────────────────────────────────────┘
```

**Padrões críticos:**
- **Drag-and-drop:** arrastar TaskCard entre colunas. Cursor aparece com sombra grande do cartão. Drop zone visual: coluna fica com border-dashed primary.
- **Add inline:** clicar `[+]` no fundo da coluna abre input inline para criar tarefa nesse estado directamente.
- **Configurar colunas:** sheet lateral permite renomear, adicionar, remover colunas (até 6, mínimo 3).
- **Empty column:** texto subtle: *"Arrasta aqui."*
- **Sem scroll vertical infinito:** colunas com mais de 50 cartões mostram "Ver mais 12 →" no fundo.

**Atrasadas:** TaskCard com border-left vermelho 3px e icon ⚠.

**Responsivo:** mobile transforma em scroll horizontal, snap por coluna, pinch-zoom-out mostra 2 colunas lado a lado.

---

### 5.8 Tarefas — Calendário Semanal

**Propósito:** ver tarefas distribuídas pela semana, drag para reagendar.

**Layout (week-view 7 colunas):**

```
┌─[Sidebar]──┬────────────────────────────────────────────┐
│            │  Tarefas                            [+ Nova]│
│            │  [Lista] [Kanban] [Calendário]              │
│            │                                             │
│            │  ◀ Semana de 14 a 20 de Março ▶  [Hoje]    │
│            │                                             │
│            │  ┌─Seg─┬─Ter─┬─Qua─┬─Qui─┬─Sex─┬─Sáb─┬─Dom─┐│
│            │  │ 14  │ 15  │ 16  │ 17  │ 18  │ 19  │ 20  ││
│            │  ├─────┼─────┼─────┼─────┼─────┼─────┼─────┤│
│            │  │     │     │     │     │     │     │     ││
│            │  │Reun │Devol│Rever│Pagar│Conf.│     │     ││
│            │  │Mart.│livro│orç. │renda│férias│    │     ││
│            │  │15:00│     │     │auto │     │     │     ││
│            │  │     │     │     │     │     │     │     ││
│            │  │Comp │Dent.│     │     │     │     │     ││
│            │  │pão  │16:30│     │     │     │     │     ││
│            │  │     │mid. │     │     │     │     │     ││
│            │  │     │     │     │     │     │     │     ││
│            │  │     │     │     │     │     │     │     ││
│            │  │     │     │     │     │     │     │     ││
│            │  └─────┴─────┴─────┴─────┴─────┴─────┴─────┘│
│            │                                             │
│            │  Sem horário (3) ▾                          │ ← All-day pool
└────────────┴────────────────────────────────────────────┘
```

**Padrões críticos:**
- **Drag entre dias:** arrastar TaskCard para outra coluna actualiza `due_date` persistentemente.
- **Tarefas sem horário:** pool no fundo, drag de um dia para o pool remove horário; drag inverso adiciona horário (popover pergunta hora).
- **Recorrentes:** badge `↻` no canto superior do card.
- **Hoje destacado:** coluna do dia actual com fundo `primary-subtle`.

**Responsivo:**
- Tablet: 4 dias visíveis, scroll horizontal.
- Mobile: vista de 1 dia + navegação swipe entre dias.

---

### 5.9 Finanças — Overview Mensal

**Propósito:** ver entradas, saídas, projecção 30 dias, distribuição por categoria.

**Layout:**

```
┌─[Sidebar]──┬────────────────────────────────────────────┐
│            │  Finanças                                    │
│            │  [Mensal] [Variáveis] [Recorrentes] [Cartões] [Património]│
│            │                                             │
│            │  ◀ Março 2026 ▶                             │
│            │  ─────────────────────────────────────────  │
│            │                                             │
│            │  ┌───────────┬───────────┬───────────┐     │
│            │  │ Entradas  │ Saídas    │ Saldo     │     │
│            │  │ €2.450,00 │ €1.247,30 │ +€1.202,70│     │
│            │  │ 2 fontes  │ 38 trans. │ verde     │     │
│            │  └───────────┴───────────┴───────────┘     │
│            │                                             │
│            │  Projecção 30 dias                           │
│            │  ┌──────────────────────────────────────┐  │
│            │  │  Saldo previsto a 14/04: +€543,20    │  │
│            │  │  ─────────────                       │  │
│            │  │  Inclui: 2 recorrentes (€684,99) +   │  │
│            │  │  3 prestações (€275,00) já agendadas │  │
│            │  └──────────────────────────────────────┘  │
│            │                                             │
│            │  Por categoria                               │
│            │  ┌──────────────────────────────────────┐  │
│            │  │ ▓▓▓▓▓▓▓▓ Habitação        €650,00 52% │  │
│            │  │ ▓▓▓▓ Mercearia            €287,40 23% │  │
│            │  │ ▓▓ Restauração            €124,50 10% │  │
│            │  │ ▓ Combustível             €87,30   7% │  │
│            │  │ ▓ Saúde                    €54,00   4% │  │
│            │  │ ▓ Outros                  €44,10   4% │  │
│            │  └──────────────────────────────────────┘  │
│            │                                             │
│            │  Por dia                                     │
│            │  ┌──────────────────────────────────────┐  │
│            │  │  ▁▃▂▅▁▂▃▁▂▆▁▂▃▂▁ ...                  │  │
│            │  │  1   5   10   14 (hoje)              │  │
│            │  └──────────────────────────────────────┘  │
│            │                                             │
└────────────┴────────────────────────────────────────────┘
```

**Padrões críticos:**
- Todos os valores monetários em JetBrains Mono, alinhamento à direita.
- Saldo positivo verde, negativo vermelho.
- Click numa categoria faz drill-down para `Variáveis` filtrado.
- Hover na barra de dia revela tooltip com detalhe.

**Estado vazio:** *"Sem dados para Março 2026. Diz ao chat 'gastei X em Y' para começar."*

---

### 5.10 Finanças — Variáveis

**Propósito:** gerir transacções pontuais (gastos/entradas).

**Layout (lista densa estilo Stripe):**

```
┌─[Sidebar]──┬────────────────────────────────────────────┐
│            │  Finanças › Variáveis        [+ Adicionar] │
│            │                                             │
│            │  🔍 [Procurar...] [Categoria▾] [Conta▾] [Mês▾]│
│            │                                             │
│            │  Data       Descrição           Cat.  Conta    Valor│
│            │  ─────────────────────────────────────────  │
│            │  14/03/26  Continente Almada    Mer.  Mil.  −€78,70│
│            │  14/03/26  Galp Algés           Comb. Cart. −€42,00│
│            │  13/03/26  Salário Sofia        Vencim. CGD +€1.250,00│
│            │  13/03/26  Pingo Doce            Mer.  Mil.  −€34,12│
│            │  12/03/26  Vacina veterinário   Saúde Cart. −€54,00│
│            │  11/03/26  Restaurante Ramiro   Rest. Cart. −€89,40│
│            │  ...                                        │
│            │                                             │
│            │  [Carregar mais]                            │
└────────────┴────────────────────────────────────────────┘
```

**Hover row:** mostra ícones inline `editar` e `eliminar`. Click row abre sheet lateral com detalhe completo + edição.

**Add manual (sheet lateral):**

```
┌─ Nova despesa ─────────────────────────┐
│                                         │
│  Tipo: ◉ Saída  ◯ Entrada               │
│                                         │
│  Valor *                                │
│  [€        78,70]                       │ ← MoneyField
│                                         │
│  Descrição *                            │
│  [Continente Almada]                    │
│                                         │
│  Data *                                 │
│  [14/03/2026]                           │ ← DateField
│                                         │
│  Categoria                              │
│  [Mercearia ▾]                          │
│                                         │
│  Conta / cartão                         │
│  [Cartão Millennium ▾]                  │
│                                         │
│              [Cancelar] [Guardar]       │
└─────────────────────────────────────────┘
```

**Microcopy proibida:** "deletar" → eliminar. "Salvar" → Guardar. "Despesa" sim, "gasto" sim.

---

### 5.11 Finanças — Recorrentes

**Propósito:** gerir transacções repetitivas (renda, salário, subscrições).

**Layout:**

```
┌─[Sidebar]──┬────────────────────────────────────────────┐
│            │  Finanças › Recorrentes      [+ Adicionar] │
│            │                                             │
│            │  Próximos 30 dias                           │
│            │  ┌──────────────────────────────────────┐  │
│            │  │ 17/03  Renda                €650,00  │  │
│            │  │ 19/03  Internet (Vodafone)  €34,99   │  │
│            │  │ 22/03  Cartão Millennium    €289,00  │  │
│            │  │ 25/03  Spotify Família      €17,99   │  │
│            │  │ 28/03  Vencimento João    +€1.450,00 │  │
│            │  │ 28/03  Vencimento Sofia   +€1.250,00 │  │
│            │  └──────────────────────────────────────┘  │
│            │                                             │
│            │  Todas as recorrências                       │
│            │  ─────────────────────────────────────────  │
│            │  Renda                                       │
│            │     Todo o dia 8 · €650,00 · CGD            │
│            │     Próxima: 08/04                          │
│            │     [Editar] [Pausar] [Eliminar]            │
│            │  ─────────────────────────────────────────  │
│            │  Vencimento João                             │
│            │     Último dia útil · ~€1.450,00 · CGD     │
│            │     Próxima: 28/03                          │
│            │  ─────────────────────────────────────────  │
│            │  Vodafone                                    │
│            │     Todo o dia 19 · €34,99 · Cartão Mill.   │
│            │     ...                                     │
└────────────┴────────────────────────────────────────────┘
```

---

### 5.12 Finanças — Cartões e Fatura

**Propósito:** gerir cartões de crédito, ver fatura corrente, prestações.

**Layout:**

```
┌─[Sidebar]──┬────────────────────────────────────────────┐
│            │  Finanças › Cartões           [+ Adicionar]│
│            │                                             │
│            │  ┌────────────────────────────────────────┐│
│            │  │ Millennium Visa Gold                    ││ ← Card grande
│            │  │ ──── ──── ──── 4521                    ││
│            │  │                                         ││
│            │  │ Fatura corrente (Março)                 ││
│            │  │ €289,00 / €2.500,00 (limite)           ││
│            │  │ ──────────                              ││
│            │  │ ▓▓▓▓░░░░░░░░░░░ 12% utilizado          ││
│            │  │                                         ││
│            │  │ Fecho a 22/03 · Pagamento a 05/04      ││
│            │  └────────────────────────────────────────┘│
│            │                                             │
│            │  Transacções desta fatura (12)              │
│            │  14/03  Continente             −€78,70      │
│            │  13/03  Pingo Doce              −€34,12      │
│            │  12/03  Vet                     −€54,00      │
│            │  ... [Ver todas →]                          │
│            │                                             │
│            │  Prestações activas                          │
│            │  ┌──────────────────────────────────────┐  │
│            │  │ Sofá da IKEA                         │  │
│            │  │ €100,00/mês · prestação 4 de 12       │  │
│            │  │ Próxima: 22/03 · Total: €1.200,00    │  │
│            │  ├──────────────────────────────────────┤  │
│            │  │ TV Samsung                            │  │
│            │  │ €175,00/mês · prestação 2 de 6        │  │
│            │  │ ...                                   │  │
│            │  └──────────────────────────────────────┘  │
│            │                                             │
│            │  ◀ Outras faturas: Fev | Jan | Dez ▶       │
└────────────┴────────────────────────────────────────────┘
```

---

### 5.13 Finanças — Património

**Propósito:** ver saldo agregado por banco/conta.

**Layout:**

```
┌─[Sidebar]──┬────────────────────────────────────────────┐
│            │  Finanças › Património      [+ Conta]      │
│            │                                             │
│            │  Total                                       │
│            │  €12.847,30                                 │ ← Lora 40px
│            │  +€324,00 vs início do mês                  │ ← Verde small
│            │                                             │
│            │  Por conta                                   │
│            │  ┌──────────────────────────────────────┐  │
│            │  │ CGD · D/O                            │  │
│            │  │ João · ──── 1234        €4.523,40    │  │
│            │  │ ─────────────                        │  │
│            │  │ Última actualização manual: 12/03    │  │
│            │  │ [Ver transacções]                    │  │
│            │  ├──────────────────────────────────────┤  │
│            │  │ Millennium · D/O                     │  │
│            │  │ Sofia · ──── 5678       €2.184,90    │  │
│            │  │ ...                                   │  │
│            │  ├──────────────────────────────────────┤  │
│            │  │ Activobank · Poupança                │  │
│            │  │ Conjunta                €5.139,00    │  │
│            │  │ ...                                   │  │
│            │  └──────────────────────────────────────┘  │
└────────────┴────────────────────────────────────────────┘
```

---

### 5.14 Configurações da Conta

**Propósito:** perfil, plano, billing, household, export, eliminação.

**Layout (sheet/page com tabs verticais à esquerda do main):**

```
┌─[Sidebar]──┬───────────┬───────────────────────────────┐
│            │ ▾ Conta   │  Plano                         │
│            │   Perfil  │  ─────────────────────────────  │
│            │   Plano  ●│                                 │
│            │   Billing │  Plano actual: Família          │
│            │ ▾ Househ. │  €8,88/mês · próxima cobrança  │
│            │   Membros │  a 14/04/2026                   │
│            │   Convites│                                 │
│            │ ▾ Dados   │  Membros: 3 de 4                │
│            │   Export  │  [Convidar +1]                  │
│            │   Eliminar│                                 │
│            │           │  ──────                          │
│            │           │  Mudar plano                     │
│            │           │  ┌──────────────────────────┐   │
│            │           │  │ Grátis                    │   │
│            │           │  │ €0/mês · 1 módulo         │   │
│            │           │  │ [Mudar para este]         │   │
│            │           │  ├──────────────────────────┤   │
│            │           │  │ Pessoal                   │   │
│            │           │  │ €4,90/mês · 1 utilizador  │   │
│            │           │  │ [Mudar para este]         │   │
│            │           │  ├──────────────────────────┤   │
│            │           │  │ ★ Família (actual)        │   │
│            │           │  │ €8,88/mês · 4 utilizadores│   │
│            │           │  ├──────────────────────────┤   │
│            │           │  │ Pro                       │   │
│            │           │  │ €14,90/mês · API + audit  │   │
│            │           │  │ [Subir para este]         │   │
│            │           │  └──────────────────────────┘   │
│            │           │                                 │
│            │           │  ──────                          │
│            │           │  [Cancelar subscrição]          │ ← Danger ghost
└────────────┴───────────┴─────────────────────────────────┘
```

**Aba Eliminar conta:**

```
Eliminação de conta

A eliminação é definitiva. Vais perder:
• Todas as tarefas, finanças e conversas com o agente
• Acesso ao agregado e aos seus membros
• Histórico de faturas (continuamos a guardar 5 anos
  por obrigação fiscal PT)

Após confirmares:
• Marcamos a tua conta para eliminação em 30 dias
• Durante esses 30 dias, podes reverter a qualquer momento
• Após 30 dias, todos os dados são eliminados em definitivo
  (excepto o exigido por lei fiscal PT)

[Pedir eliminação]
```

Click "Pedir eliminação" abre dialog de confirmação com input *"Escreve ELIMINAR para confirmar"*.

---

### 5.15 Convidar Membros do Household

**Propósito:** owner convida outros utilizadores.

**Layout (sheet lateral ou dialog):**

```
┌─ Convidar membros ──────────────────────┐
│                                          │
│  Tens o plano Família.                   │
│  Já estão 3 de 4 lugares ocupados.       │
│                                          │
│  Email do convidado *                    │
│  [exemplo@dominio.pt]                    │
│                                          │
│  Nome (opcional)                          │
│  [Como aparece no agregado]              │
│                                          │
│  Permissões                               │
│  ◉ Pode ver e editar tudo                │
│  ◯ Só pode ver                           │
│                                          │
│  Mensagem pessoal (opcional)             │
│  ┌────────────────────────────────────┐  │
│  │ Olha, criei isto para nos ajudar  │  │
│  │ a organizar a casa.                │  │
│  └────────────────────────────────────┘  │
│                                          │
│              [Cancelar] [Enviar convite]│
└──────────────────────────────────────────┘
```

**Email enviado (texto):**

> **Olá,**
>
> O João convidou-te para te juntares ao agregado **Casa dos Santos** no Astro.
>
> Vais poder partilhar tarefas, agenda e finanças com ele.
>
> *"Olha, criei isto para nos ajudar a organizar a casa."*
>
> [**Aceitar convite**] (válido por 7 dias)
>
> O Astro é uma ferramenta portuguesa para organizar a vida em família. Mais em astro.pt.

**Estados:**
- Limite atingido: convite bloqueado, copy: *"Atingiste o limite de membros do plano Família (4). Sobe para Pro ou remove um membro existente."*
- Convite pendente: aparece na lista *"João Silva · Convidado · expira em 5 dias [reenviar] [cancelar]"*.

---

## 6. Padrões de Interacção AI

### 6.1 Chat Input

```
┌──────────────────────────────────────────────────┐
│  Sugestões: [Ver tarefas hoje] [Resumo do mês]   │ ← Chips clicáveis
│                                                   │
│  ┌──────────────────────────────────────────┐    │
│  │ Escreve aqui...                            │    │ ← Auto-grow textarea
│  │                                            │    │ ← min 1 row, max 8
│  └──────────────────────────────────────────┘    │
│  📎 anexar     ⌘+↵ enviar           [Enviar]     │
└──────────────────────────────────────────────────┘
```

**Comportamentos:**
- Empty state: placeholder *"Escreve aqui..."* (não *"O que queres fazer?"* — demasiado interrogativo).
- Sugestões dinâmicas: 3 chips contextuais baseadas em hora do dia / módulo activo / histórico recente.
- Atalhos no footer: discreto, fonte mono 12px, cor `text-muted`.
- Anexar: ícone clip — desabilitado no MVP, tooltip *"Em breve"*.

### 6.2 Mensagem do Agente

```
┌─[Avatar Astro]─────────────────────────────┐
│  10:23                                       │
│                                              │
│  Detectei 2 acções na tua frase:             │ ← Body 15px
│                                              │
│  ┌─ PreviewCard ─────────────────────────┐  │
│  │  Tarefa          [editar]              │  │
│  │  Reunião com Marta                     │  │
│  │  📅 15/03/2026 · 15:00                 │  │
│  │                                         │  │
│  │  Despesa         [editar]              │  │
│  │  €78,70 · Continente · Mercearia      │  │
│  │  📅 14/03/2026                          │  │
│  │                                         │  │
│  │  [Cancelar]  [Confirmar tudo]          │  │
│  └─────────────────────────────────────────┘  │
│                                              │
│  [📋 copiar]  [↶ desfazer]                   │ ← Ações da mensagem
└──────────────────────────────────────────────┘
```

**Variantes de mensagem:**
- Texto simples (resposta a pergunta consultiva): apenas avatar + texto.
- PreviewCard (acção destrutiva ou confidence < 70%): forma acima.
- Streaming: cursor `▊` a piscar no fim do texto, remove ao completar.
- Erro: avatar com tom warning, texto em `text-warning`.

### 6.3 Toast Undo

```
┌──────────────────────────────────────┐
│  Criadas 2 acções.       [Anular]    │ ← Bottom-right, 30s countdown
│  ───────────────                      │ ← Progress bar 30s
└──────────────────────────────────────┘
```

**Comportamento:**
- Aparece após cada acção do agente.
- Posição: bottom-right, slide-in de baixo (240ms spring).
- Auto-dismiss após 30s.
- Click "Anular" reverte e mostra toast confirmação: *"Anulado."* (5s).
- Empilha até 3 toasts simultâneos; mais que isso colapsa em *"3 acções"*.

### 6.4 Streaming

- Mensagem do agente aparece com cursor `▊` (caracter unicode) a piscar 1Hz.
- Texto cresce do start ao end como typewriter (não 1 caracter por vez — chunks de 5-10 caracteres).
- `prefers-reduced-motion`: desactiva typewriter, texto aparece instantâneo no fim.

### 6.5 Estados de Erro

| Estado | Copy PT-PT |
|--------|------------|
| Rede caiu | *"Não consegui responder agora. A ligação caiu. Tenta de novo daqui a um bocado."* |
| Timeout LLM | *"Estou a demorar mais do que o costume. Posso continuar ou queres cancelar?"* |
| Confidence muito baixo | *"Não tenho a certeza do que querias dizer. Podes reformular ou dizer-me passo a passo?"* |
| Acção falhou (ex: DB down) | *"Não consegui guardar isto. Tenta outra vez ou guarda manualmente em Tarefas."* |
| Limite de plano atingido | *"Atingiste os 50 prompts deste mês do plano Grátis. Sobe para Pessoal a €4,90 ou espera até 1 de Abril."* |

---

## 7. Empty States

Padrão consistente: ilustração SVG suave + headline Lora + copy curta + CTA único.

### Lista de empty states

| Ecrã | Headline | Copy | CTA |
|------|----------|------|-----|
| Visão (utilizador novo) | "Ainda não há nada para mostrar." | "Carrega no chat e diz 'criar tarefa de comprar pão amanhã' para começar." | [Abrir o chat] |
| Tarefas — lista | "Sem tarefas para mostrar." | "Diz ao chat ou clica em [+ Nova]." | [+ Nova tarefa] |
| Tarefas — Kanban (coluna vazia) | (subtle text) | *"Arrasta aqui."* | — |
| Finanças — variáveis | "Sem despesas registadas." | "Diz ao chat 'gastei €X em Y' ou adiciona manualmente." | [+ Adicionar] |
| Finanças — recorrentes | "Sem recorrências." | "Renda, salário, subscrições — adiciona uma vez e o Astro trata do resto." | [+ Adicionar] |
| Finanças — cartões | "Ainda não tens cartões." | "Adiciona um cartão para acompanhar a fatura, prestações e saldo." | [+ Adicionar] |
| Finanças — património | "Adiciona a tua primeira conta." | "Banco, saldo inicial — em 30 segundos vês o teu património." | [+ Conta] |
| Chat (primeira sessão) | "Olá, João. Em que posso ajudar?" | (3 sugestões clicáveis) | — |
| Filtro vazio | "Sem resultados para este filtro." | "Limpa filtros ou tenta outras palavras." | [Limpar filtros] |

### First-time UX

- Banner dismissível no topo dos primeiros 7 dias: *"Estás a fazer o trial. Tens 12 dias para experimentar tudo. Sem cartão até decidires."*
- Tooltip em primeira interacção com cada módulo (max 1 por módulo).
- Sem onboarding modal repetitivo. Tutoriais sob demanda em `Configurações › Ajuda`.

---

## 8. Microcopy Guidelines PT-PT

### 8.1 Vocabulário Obrigatório

| Termo correcto PT-PT | Proibido |
|----------------------|----------|
| utilizador | usuário |
| ficheiro | arquivo |
| eliminar / apagar | deletar |
| guardar | salvar |
| actualizar | atualizar (sem c) — usar `actualizar` |
| acção | ação (sem c) — usar `acção` |
| facto | fato (que é "suit") |
| morada | endereço |
| telemóvel | celular |
| cartão | cartão (ok ambos) |
| prestações | parcelas |
| renda | aluguel |
| supermercado / mercearia | mercado (PT-BR) |
| autocarro | ônibus |
| comboio | trem |
| pequeno-almoço | café da manhã |
| écran (ou ecrã) | tela |
| rato | mouse |
| sítio web | site (ok) — preferir "página" / "sítio" para variar |
| computador / portátil | notebook |
| terça | terça-feira (ok) |
| quartas / sextas | (ok) |

### 8.2 Tom em Botões

- **Acção primária:** verbo no infinitivo. *"Guardar"*, *"Confirmar"*, *"Continuar"*, *"Entrar"*, *"Criar conta"*.
- **Acção secundária:** *"Cancelar"*, *"Voltar"*, *"Saltar"*.
- **Acção destrutiva:** verbo claro. *"Eliminar"*, *"Cancelar subscrição"*.
- **Acção AI:** *"Anular"* (não "desfazer" no contexto de undo de acção do agente — *anular* é mais PT-PT e mais directo).
- **Sem reticências, sem exclamações, sem emojis em botões.**

### 8.3 Tom em Erros

- **Estrutura:** [o que aconteceu] + [o que fazer]. Sem desculpas.
- *"Não consegui guardar isto. Tenta outra vez ou guarda manualmente."* ✓
- *"Ups! Algo correu mal. 😅"* ✗ (proibido — vibe ChatGPT)
- *"Erro: [stack trace]"* ✗ (apenas em logs, nunca user-facing)

### 8.4 Tom em Sucessos

- **Curto, factual, sem celebração.**
- *"Tarefa criada."* ✓
- *"Boa! Tarefa criada com sucesso! 🎉"* ✗
- *"Concluída."* ✓
- *"Yay! Concluíste a tarefa! Continua assim!"* ✗

### 8.5 Tom em Tooltips

- Frase curta, sem ponto final.
- *"Anular esta acção (30s)"*
- *"Atalho: ⌘K"*
- *"Próxima cobrança a 14/04"*

### 8.6 Tom em Labels

- Substantivo, capital inicial.
- *"Email"*, *"Palavra-passe"*, *"Data"*, *"Categoria"*.
- Não: *"Endereço de e-mail completo"* (verbose).

### 8.7 Lista de Frases Proibidas

| Proibido | Razão |
|----------|-------|
| "Olá! 👋" | Demasiado informal, anglicismo gestual |
| "Yay!" / "Boa!" | Hype americano |
| "Ups!" | Pueril |
| "Vamos lá!" | Imperativo coach hype |
| "Comece" / "Começe" | PT-BR — usar "Começa" (tu) |
| "Você" | PT-BR — usar "tu" ou impessoal |
| "Acompanhe" | Verbo morto — preferir "Vê", "Acompanha" |
| "Algo correu mal" | Ambíguo — dizer o que falhou |
| "Por favor" excessivo | UX é instrução, não súplica |

---

## 9. Acessibilidade (WCAG AA)

### 9.1 Compliance Target

**WCAG 2.1 AA** obrigatório no MVP (PRD §3.4, NFR10 GDPR + standard PT/UE).

### 9.2 Requisitos

**Visual:**
- Contraste de cor: texto normal >= 4.5:1, texto grande (18px+) >= 3:1, UI components >= 3:1. Verificado em todos os tokens (claro e escuro).
- Indicadores de foco: ring 2px `--primary` com offset 2px, sempre visível em `:focus-visible`. Nunca apenas cor — sempre contorno.
- Tamanho de texto: nunca < 12px. Body default 15px (acima do mínimo recomendado 14px).
- Não usar cor sozinha para transmitir informação (saldo negativo: vermelho + sinal `−`; tarefa atrasada: vermelho + ícone ⚠).

**Interacção:**
- Navegação por teclado: 100% das funcionalidades acessíveis sem rato. `Tab` segue fluxo lógico. `Esc` fecha modais/sheets.
- Atalhos: `Cmd/Ctrl+K` command palette; `Cmd/Ctrl+Enter` enviar chat; `?` mostrar atalhos disponíveis.
- Screen reader: ARIA labels em todos os ícones-só-botão; `aria-live="polite"` em toasts e mensagens de chat; `aria-busy="true"` em loaders; landmarks (`<nav>`, `<main>`, `<aside>`).
- Touch targets: mínimo 44x44px em mobile.
- `prefers-reduced-motion`: respeitado — animações reduzidas para 0ms ou opacity-only.

**Conteúdo:**
- Alt text em todas as imagens significativas. Decorativas: `alt=""`.
- Estrutura de headings: 1× H1 por página, depois descendente. Sem skipping (não H1→H3).
- Form labels: cada input tem `<label>` associado (não placeholder-only).
- Erros de form: `aria-describedby` aponta para mensagem de erro inline.

### 9.3 Testing Strategy

- **Automated:** axe-core integrado em CI (failure se score < 95).
- **Lighthouse:** target >= 90 em accessibility (PRD Epic 5 quality gate).
- **Manual:** smoke test com NVDA + VoiceOver antes de cada release.
- **Real users:** beta com pelo menos 1 utilizador com leitor de écran (Diogo network ou recrutamento ACAPO).

---

## 10. Responsive Strategy

### 10.1 Decisão: Desktop-first responsivo

**Justificação:** PRD §3.6 explicita "desktop primário, tablet completo, mobile funcional". Personas João/Sofia/Inês usam predominantemente desktop em casa/escritório; mobile é caso de uso secundário (consulta rápida). Diogo usa ambos. Não há intent de competir com o Néctar mobile-first iOS na Fase 1.

**Mobile NÃO é app-like.** É a web responsive funcional. Apps nativos são Fase 2-3.

### 10.2 Breakpoints

| Breakpoint | Min width | Max width | Target devices |
|------------|-----------|-----------|----------------|
| Mobile | 0 | 639px | Smartphones |
| Tablet | 640px | 1023px | iPad, tablets Android |
| Desktop | 1024px | 1439px | Laptops, monitores 14"-22" |
| Wide | 1440px+ | — | Monitores 24"+, ultrawide |

### 10.3 Adaptação por Breakpoint

**Layout:**
- Wide/Desktop: sidebar fixa (240px) + main + right rail opcional (300px).
- Tablet: sidebar collapsible (icon-only 64px) + main fullwidth.
- Mobile: sidebar como hamburger drawer + main fullwidth + chat acessível por FAB.

**Navegação:**
- Desktop: sidebar permanente.
- Tablet: sidebar collapsible (default collapsed).
- Mobile: bottom tab bar (Visão / Chat / Tarefas / Finanças / Conta).

**Conteúdo (prioridade):**
- Visão Desktop: 3 colunas de widgets.
- Visão Tablet: 2 colunas.
- Visão Mobile: 1 coluna; widget "Tarefas hoje" sempre primeiro.

**Interacção:**
- Drag-and-drop: completo em desktop/tablet. Mobile usa long-press + swipe entre colunas (Kanban) ou date picker (calendário).
- Hover states: substituídos por active states em touch.
- Tooltips: substituídos por aria-label em touch.

---

## 11. Modo Claro vs Escuro

### 11.1 Default

**Modo claro é o default.** Razões:
1. Anti-Néctar (Néctar é dark-only).
2. Tom calmo/editorial alinha melhor com base creme #FAFAF7.
3. Personas João/Sofia/Inês não pediram dark.
4. Diogo pediu dark — disponível, mas não é o default.

### 11.2 Toggle

- Localização: `Configurações › Aparência` + atalho rápido no menu do avatar (canto inferior sidebar).
- Opções: Claro / Escuro / Sistema (segue `prefers-color-scheme`).
- Default: Sistema. Se `prefers-color-scheme` indica dark, default activa dark.
- Persistência: por utilizador no DB + localStorage como fallback.

### 11.3 Implementação

- CSS variables com `:root` (claro) e `.dark` (escuro).
- Tailwind `dark:` variants.
- Ícones que precisam de inversão: logo, ilustrações de empty state (servir `.svg` separados ou usar `currentColor`).
- Sem flash of incorrect theme (FOIT): SSR detecta cookie de preferência antes de hydratação.

### 11.4 Testes Obrigatórios

- Cada componente revisto em ambos os modos.
- Sem leak de cores claras em dark mode (PRD Epic 5 AC4).
- Contraste AA verificado em ambos.

---

## 12. Animação e Micro-interacções

### 12.1 Princípios

1. **Funcional, não decorativa.** Cada animação tem propósito (feedback, orientação, hierarquia).
2. **Curta.** 120-240ms é a janela. Acima de 320ms é ruído.
3. **Calma.** Easing predominante `cubic-bezier(0.4, 0, 0.2, 1)` (ease-out). Spring só em drag/undo.
4. **Respeita `prefers-reduced-motion`.** Reduzido a 0ms ou opacity-only.

### 12.2 Animações-chave

| Nome | Descrição | Duração | Easing |
|------|-----------|---------|--------|
| Hover button | Background fade | 120ms | ease-out |
| Focus ring | Aparece instantâneo, fade-in | 120ms | ease-out |
| Toast slide-in | De fora-direita para dentro | 240ms | spring |
| Toast slide-out | Inverso após 30s ou anulação | 180ms | ease-out |
| Sheet open | Slide do lado | 240ms | ease-out |
| Modal open | Fade + scale 0.96→1 | 180ms | ease-out |
| TaskCard complete | Fade strike-through + slide-out 200ms depois | 200ms+200ms | ease-out |
| Drag-drop card | Pickup elevation, drop settle | 120ms+200ms | spring |
| Streaming cursor | Blink 1Hz | 500ms | linear |
| PreviewCard expand | Auto-height grow | 240ms | ease-out |
| Skeleton shimmer | Translate background gradient | 1500ms loop | linear |
| Page transition | Fade-only entre módulos | 120ms | ease-out |

### 12.3 Não fazer

- Confetti em tarefa completa.
- Spring em hover.
- Parallax.
- Auto-play de vídeo/animação em empty state.

---

## 13. Performance

### 13.1 Goals (do PRD)

- **First Contentful Paint:** < 2s em 4G (NFR4)
- **Time to Interactive:** < 3s em desktop, < 5s em mobile 4G
- **Interaction Response:** < 100ms para acções locais; < 500ms para CRUD (NFR2)
- **Animation FPS:** 60fps consistente
- **Lighthouse score:** >= 85 em mobile (Epic 5 quality gate), >= 95 desktop

### 13.2 Estratégias de Design

- **Skeleton loaders por widget independente** (não bloqueia layout).
- **Optimistic UI:** acções locais (toggle checkbox, drag-drop) reflectem instantâneo, rollback se falha.
- **Lazy-load** de módulos não-críticos (Finanças carrega ao primeiro acesso, não no boot).
- **Prefetch** de rotas adjacentes (mouse hover em link de sidebar).
- **Image optimization:** SVG para ícones; PNG/AVIF para empty state ilustrações; sem hero images grandes.
- **Font subset:** Inter e Lora carregados via `font-display: swap`, subset latin-ext (PT requer á, ç, ã, etc.).
- **Code splitting:** chat panel é route-level lazy.

---

## 14. Dependências de Implementação

Para handoff a `@architect` e `@dev`. Estas são recomendações UX — `@architect` valida compatibilidade técnica.

### Stack UI

| Camada | Recomendação | Versão | Razão |
|--------|--------------|--------|-------|
| Framework | Next.js 15 App Router | latest | PRD CON1 |
| CSS | Tailwind CSS | 3.4+ | Componentes shadcn |
| Components | shadcn/ui | latest | Ownership + acessibilidade |
| Primitives | Radix UI | latest | A11y out-of-box |
| Icons | Lucide React | latest | Lightweight, consistente |
| Drag-drop | @dnd-kit/core + @dnd-kit/sortable | latest | A11y por defeito (vs react-dnd) |
| Calendar | react-day-picker | latest | Locale `pt-PT`, leve |
| Date utilities | date-fns + date-fns/locale/pt | latest | Tree-shakeable, locale `pt` |
| Number/Money formatting | `Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' })` | nativo | Sem dependência |
| Forms | react-hook-form + zod | latest | Validação + a11y |
| Animations | Framer Motion | latest | Spring, reduced-motion |
| Toasts | Sonner | latest | shadcn-compatible, fila inteligente |
| Charts (mini) | Recharts ou TremorJS | latest | Para dashboard Finanças mensal |
| Command palette | cmdk | latest | shadcn-compatible |
| Markdown rendering (chat) | react-markdown + remark-gfm | latest | Renderizar respostas LLM |

### Fonts

- Inter Variable (variable font, latin-ext): 1 ficheiro `.woff2`, ~120KB.
- Lora Variable (variable font, latin-ext): 1 ficheiro `.woff2`, ~140KB.
- JetBrains Mono Variable: 1 ficheiro `.woff2`, ~100KB.

Servidos via `next/font` (auto-optimization, zero CLS).

### Assets

- Logo SVG (símbolo solo + horizontal + vertical): handoff a designer visual.
- Empty state SVGs (8 variantes): handoff a designer visual.
- Favicon set (16, 32, 192, 512, apple-touch): handoff a designer visual.

---

## 15. Próximos Passos

### 15.1 Decisões pendentes do Eurico

1. **Naming:** confirmar `Astro` como nome público ou pedir alternativa.
2. **Paleta:** validar Atlântico (#1F4F6A) + Cortiça (#B5754A) ou pedir variação.
3. **Default theme:** confirmar claro como default (vs escuro).
4. **Logo:** aprovar conceito (símbolo bússola minimal) ou contratar designer visual externo.

### 15.2 Handoffs

| Para | Item | Prioridade |
|------|------|-----------|
| `@architect` | Validar stack UI (shadcn/ui, Radix, Tailwind, dnd-kit) e integrar em `architecture.md` | Alta |
| `@architect` | Decidir SSR strategy (theme detection, locale) | Alta |
| Designer visual externo | Criar logo Astro, favicon set, 8 empty state illustrations | Média (não bloqueia Epic 1) |
| `@po` | Validar este spec contra PRD UI Goals (§3) | Alta |
| `@sm` | Criar stories de Epic 5 (UI shell) com este spec como dependência | Após validação @po |
| `@dev` (futuro) | Bootstrap shadcn/ui + setup tokens em `tailwind.config.ts` | Após Epic 1 foundation |

### 15.3 Trabalho fora deste spec

- **Storybook:** quando começar Epic 5, montar Storybook para component library viva.
- **Visual regression testing:** Chromatic ou Percy quando CI estabilizar (Epic 6).
- **Design tokens automation:** considerar Style Dictionary para multi-platform se Fase 2 trouxer apps nativos.
- **Internationalisation:** **fora do MVP** — confirmar com Eurico que arquitectura permite adicionar i18n no futuro sem refactor (PRD CON3 diz não, mas hooks técnicos de string extraction são gratuitos).

### 15.4 Design Handoff Checklist

- [x] Princípios UX documentados
- [x] Branding proposto (naming, logo concept, paleta, tipografia)
- [x] Design tokens (cores, spacing, type, radius, shadows, transitions)
- [x] Component library escolhida e listada (35 componentes core)
- [x] Wireframes textuais dos 14 core screens com copy PT-PT real
- [x] Padrões de interacção AI (chat, preview, undo, streaming, erros)
- [x] Empty states com copy PT-PT
- [x] Microcopy guidelines PT-PT (vocabulário, tom, frases proibidas)
- [x] Acessibilidade WCAG AA definida e testável
- [x] Responsive strategy (desktop-first, breakpoints, adaptação)
- [x] Modo claro/escuro (default, toggle, implementação)
- [x] Animação e micro-interacções
- [x] Performance goals e estratégias
- [x] Dependências de implementação listadas
- [x] Próximos passos e handoffs definidos

---

## 16. Change Log

| Data | Versão | Descrição | Autora |
|------|--------|-----------|--------|
| 2026-05-04 | 1.0 | Draft inicial — front-end-spec MVP completo, PT-PT exclusivo | Uma (UX Design Expert) |

---

*Spec preparado por Uma (UX Design Expert AIOX) em 2026-05-04 a partir de `docs/prd.md` v1.1 e `docs/project-brief.md` v1.1. Cada decisão é rastreável a um FR/UI Goal/Constraint do PRD conforme Constitution Article IV — No Invention. Toda copy de exemplo é production-ready em PT-PT.*
