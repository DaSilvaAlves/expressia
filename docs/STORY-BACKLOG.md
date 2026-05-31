---
title: Story Backlog — Expressia (meu-jarvis)
owner: '@po (Pax)'
created: 2026-05-29
updated: 2026-05-29
---

# Story Backlog — Expressia

> Rastreio centralizado de follow-ups, dívida técnica e oportunidades identificadas
> durante review de stories, desenvolvimento e QA. Gerido por `@po` (`*backlog-add`,
> `*backlog-review`, `*backlog-prioritize`). Stories formais vivem em
> `docs/stories/`; este ficheiro rastreia trabalho diferido e achados transversais.

**Legenda de tipo:** F = follow-up · O = optimization · T = technical-debt · S = security
**Status:** 📋 TODO · 🚧 IN PROGRESS · ⏸️ BLOCKED · ✅ DONE · 💡 IDEA · ❌ CANCELLED

---

## 🔴 HIGH

#### [SEC-MW-F1] Auth gate do middleware não cobre `/tarefas` e `/financas` (bypass NFR8)

- **Source**: @po verificação independente (sessão 5.8, 2026-05-29) — achado originalmente reportado pelo @sm na Story 5.10 (AC6/FUP-5.3.C) e antes registado como carry-over CO-2 da Story 5.4 ("middleware APP_PATH_PREFIXES folding 5.10")
- **Priority**: 🔴 HIGH
- **Type**: S (security)
- **Effort**: 1-2 horas (fix de array trivial + testes de regressão por prefixo)
- **Status**: ✅ DONE — **resolvido via Story 5.0-hotfix (Done, security gate PASS 9.5/10, 2026-05-29; pushed)**. Confirmado byte-a-byte por @po na validação da 5.10 (2026-05-29): `apps/web/src/middleware.ts:44` `APP_PATH_PREFIXES = ['/visao', '/jarvis', '/conta', '/tarefas', '/financas']` + teste de cobertura anti-reincidência em `middleware.test.ts`. Removido do scope da Story 5.10 (FUP-5.3.C).
- **Assignee**: @dev (fix) → @qa (security gate) → @devops (push) — **concluído no ciclo 5.0-hotfix**
- **Sprint**: ~~imediato (antes da Story 5.8)~~ — entregue 2026-05-29
- **Risk if not done**: 🔴 HIGH — utilizadores não autenticados não são redireccionados de `/tarefas/**` (3 páginas) nem `/financas/**` (7 páginas). Viola NFR8 (auth gate). Fuga de dados provavelmente mitigada pela RLS (NFR5 — `getDb()` sem JWT não tem `household_id` claim), MAS o shell SSR + estrutura de navegação renderiza para anónimos e o comportamento exacto do fetch SSR sem sessão NÃO foi confirmado runtime.

- **Description**:
  `apps/web/src/middleware.ts:36` define
  `APP_PATH_PREFIXES = ['/visao', '/jarvis', '/conta']`.
  O comentário do ficheiro (linha 8) afirma que `/(app)/**` "(visão, tarefas,
  finanças, perfil…)" requer sessão válida — mas o array **omite** `/tarefas` e
  `/financas`, ambas adicionadas por Epics 3 e 4 sem actualizar o array. A linha 71
  (`isAppPath = APP_PATH_PREFIXES.some(p => pathname.startsWith(p))`) nunca dá match
  nessas rotas → o redirect para `/entrar` (linha 71-76) nunca dispara.
  O `(app)/layout.tsx:28-30` delega ao `<AppShell>` **sem guarda server-side própria**
  (até afirma na linha 23 "auth gate intacto") → não há segunda linha de defesa ao
  nível da rota. É exactamente o modo de falha que o `PO_FIX_INLINE 4` da Story 2.7
  (comentário `middleware.ts:30-32`) documentou: rotas novas têm de ser adicionadas
  ao array.

- **Rotas afectadas (verificadas via Glob)**:
  - `/tarefas`, `/tarefas/calendario`, `/tarefas/kanban`
  - `/financas`, `/financas/este-mes`, `/financas/variaveis`, `/financas/recorrentes`, `/financas/cartoes`, `/financas/patrimonio`

- **Fix proposto** (decisão final ao @dev/@architect):
  1. Adicionar `'/tarefas'` e `'/financas'` ao `APP_PATH_PREFIXES`.
  2. Teste de regressão que assert um prefixo por rota `(app)/` real — para que rotas
     futuras sem cobertura partam o build (prevenir reincidência do CO-2).
  3. (@architect avalia) defesa em profundidade: guarda server-side no `(app)/layout.tsx`
     além do middleware.

- **Success Criteria**:
  - [ ] `/tarefas/**` e `/financas/**` redireccionam anónimos para `/entrar?next=…`
  - [ ] Teste de regressão cobre os prefixos de todas as rotas `(app)/` existentes
  - [ ] `@qa` confirma runtime o comportamento do fetch SSR anónimo (data leak ruled out)
  - [ ] 5 quality gates GREEN (lint · typecheck · test · build · check:rls)

- **Acceptance**: @qa security gate PASS + @devops push. Remove o achado da Story 5.10
  (AC6/FUP-5.3.C) — passa a estar resolvido isoladamente antes da 5.10 correr.

---

## 🟡 MEDIUM

#### [FUP-5.8.A] Tokens `*Subtle` de status sem equivalente dark — leak cosmético no `<ThemeToggle>`

- **Source**: @architect QA gate Story 5.8 (2026-05-29) — ratificação D-5.8.2
- **Priority**: 🟡 MEDIUM (cosmético)
- **Type**: F (follow-up)
- **Status**: 📋 TODO
- **Assignee**: @ux-design-expert (define os hex) → @dev (materializa)
- **Description**:
  `colorsLight` tem 19 tokens, `colorsDark` 16 — os 3 `*Subtle` de status
  (`successSubtle`/`warningSubtle`/`dangerSubtle`) não existem em `.dark`
  (`globals.css`) nem `colorsDark` (`tokens.ts`), porque o front-end-spec §3.2 não
  os define (recusa de invenção CORRECTA — Article IV). Mas `theme-toggle.tsx:121`
  (`bg-success-subtle text-success`) e `:129` (`bg-danger-subtle text-danger`) USAM
  estes tokens. Como as CSS vars só estão em `:root` e `:root`≡`.dark`≡`<html>`, por
  herança CSS resolvem ao hex CLARO em dark mode → os banners "Guardado."/"Erro" do
  toggle renderizam chip pastel claro sobre fundo escuro. Transitório (3s), página de
  baixo tráfego, texto legível — não-bloqueante.
- **Fix proposto**: @ux-design-expert define os 3 hex dark subtle; @dev adiciona-os
  a `colorsDark` (`tokens.ts`) + `.dark` (`globals.css`); o parity test
  (`tokens-parity.test.ts`) passa a exigir simetria 19/19 (remover `DARK_OMITTED`).
- **Acceptance**: 3 `*Subtle` dark definidos + materializados; banners do toggle
  coerentes em dark mode; parity test actualizado; 5 gates GREEN.

---

## 🟢 LOW

#### [OBS-5.7-1] Slot `WidgetCard.headerActions` órfão

- **Source**: @architect QA gate Story 5.7 (2026-05-28)
- **Priority**: 🟢 LOW
- **Type**: F (follow-up)
- **Status**: ✅ DONE — **resolvido pela Story 5.9 (D-5.9.4, gate @architect PASS 9.2/10, pushed 2026-05-29)**. Slot `headerActions` removido do `WidgetCard.tsx`; grep confirmou zero callers no código.
- **Description**: Slot `headerActions` reservado no `WidgetCard` ficou sem consumidor após a 5.7. Absorvido pela Story 5.9 (DP-5.9.D=B — remoção).
- **Acceptance**: ~~slot consumido ou removido~~ → removido.

#### [FUP-5.8.B] `audit-dark-mode.ts` não cobre tokens semânticos sem equivalente `.dark`

- **Source**: @architect QA gate Story 5.8 (2026-05-29) — ratificação D-5.8.2
- **Priority**: 🟢 LOW
- **Type**: F (follow-up)
- **Status**: 📋 TODO
- **Assignee**: @dev
- **Description**: `scripts/audit-dark-mode.ts` (`BREAKING_PATTERNS`) só detecta
  classes da palette Tailwind (`bg-white`, `bg-gray-100`, `text-black`...), NÃO
  classes de tokens semânticos usadas sem var em `.dark` (ex.: `bg-success-subtle`).
  Coverage gap que deixou passar o leak da FUP-5.8.A. Considerar estender o scan
  para cruzar classes `bg-*-subtle` (ou `var(--*)`) com a presença da var em `.dark`.
- **Acceptance**: o audit flagga um token semântico usado sem `.dark` counterpart.

#### [OBS-5.9-1] CTA do `<EmptyState>` usa `<a href>` (full-page nav) em vez de SPA-nav

- **Source**: @architect QA gate Story 5.9 (2026-05-29) — ratificação D-5.9.2; encaminhado a @ux por Eurico (2026-05-29)
- **Priority**: 🟢 LOW
- **Type**: F (follow-up) — UX-polish do design system
- **Assignee**: @ux-design-expert
- **Status**: 📋 TODO
- **Description**: O CTA do `<EmptyState>` em `packages/ui` usa `<a href>` (navegação
  full-page) em vez de client-side nav, decisão **correcta no MVP** para manter o
  package framework-agnóstico (sem dep `next`). Item de polish independente — **não
  pertence ao Epic 6 (Onboarding e Billing)**. Reavaliar quando houver capacidade de
  design. Relacionado: ilustrações SVG reais no `<EmptyState>` (prop `illustration`
  já existe, aceita `null` no MVP; Epic 5 previa ilustrações de designer em fase
  posterior).
- **Fix sugerido**: slot render-prop para o CTA (o caller injecta `<Link>` quando
  quiser nav client-side) — preserva a agnosticidade do package. Opcionalmente
  adicionar ilustrações SVG às 4 variantes.
- **Acceptance**: CTA do `<EmptyState>` suporta nav client-side sem o package
  passar a depender de `next`; (opcional) ilustrações SVG nas variantes.

---

## Estatísticas

| Métrica | Valor |
|---------|-------|
| Total de itens | 5 |
| 🔴 HIGH | 1 (✅ done) |
| 🟡 MEDIUM | 1 |
| 🟢 LOW | 3 |
| 📋 TODO | 3 |
| ✅ DONE | 2 |
