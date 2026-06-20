# Story INVITE-E2E: Smoke E2E do ciclo de convite de membro household

## Status

Cancelled (19/06/2026) — feature de Família/convites REMOVIDA por completo do produto e em prod (pivot single-user; commit `080559d`, merge PR #6 `812e785`, migration `0025_drop_family_feature.sql`). Não existe mais ciclo de convite de membro para fazer smoke E2E. Esta story fica sem objeto. Histórico anterior (era InReview a aguardar smoke do Eurico) preservado abaixo para registo. Ref.: handoff `mj-handoff-family-feature-removed-prod-20260619`.

> **Regra de transição de estado (PO-S1 / FIX-3):** esta story só pode passar a **Done** após a execução real do smoke E2E em produção pelo Eurico com 2 contas/sessões distintas e captura de ecrã como evidência de cada checkpoint. O trabalho autónomo do agente (T1 — runbook + T3 — gates doc-only) leva a story **apenas a `InReview`**, NUNCA a `Done`. A execução real (T2) e a AC6 ficam deferidas ao Eurico; só depois de o runbook ser preenchido com evidência real é que a transição `InReview → Done` é permitida. Proibido marcar Done com passos não verificados ou evidência inventada (Constitution Article IV).

## Executor Assignment

```yaml
executor: "@dev"
quality_gate: "@sm"
quality_gate_tools:
  - "verificação manual do runbook preenchido"
  - "capturas de ecrã como evidência obrigatória (cada checkpoint)"
```

## Story

**As a** owner de um household na Expressia,
**I want** saber que o ciclo completo de convite de membro (criar convite → copiar link → convidado autentica → aceita → membership visível → owner remove membro) funciona de ponta a ponta em produção com sessões reais no browser,
**so that** a feature de gestão de household (Story 6.7, implementada e testada a nível unit/RLS/DB) esteja validada E2E antes de ser promovida como funcionalidade disponível aos utilizadores do soft-launch.

## Contexto e âmbito (ler antes das ACs)

A feature de convites/gestão de membros do household está **completamente implementada e versionada** (Story 6.7, mergida). O código existe, as migrations estão aplicadas em produção e os testes unit/RLS/DB passam. O gap que esta story fecha é exclusivamente de validação E2E com sessões reais.

**O que já existe (não é trabalho desta story):**

- Schema DB: tabela `household_invites` (`packages/db/src/schema/tenancy.ts:115-147`) — token único (random 32 bytes hex), `expires_at` (7 dias), `email`, `role`, unique constraint por `(household_id, email)`.
- Função SQL: `accept_invite(p_token, p_user_id)` SECURITY DEFINER (`packages/db/migrations/0022_accept_invite_user_param.sql`) — valida token, expiração, email-match (D-6.7.2), limite de plano (R-6.5), já-membro; cria membership atomicamente.
- Fix ACHADO-1 já aplicado (migration 0022): a assinatura anterior usava `auth.uid()` que é NULL via `getDb()` runtime; agora recebe `p_user_id` explicitamente do handler (padrão app-enforced).
- Endpoints API (todos com unit tests em `__tests__/`):
  - `GET/PATCH /api/conta/household` — lista membros / renomeia household
  - `GET/POST /api/conta/household/invites` — lista pendentes / cria convite (devolve `acceptPath`)
  - `DELETE /api/conta/household/invites/[id]` — revoga convite
  - `POST /api/conta/household/aceitar-convite` — aceita via token
  - `DELETE /api/conta/household/members/[userId]` — remove membro (guard: nunca remove owner → 422 `OWNER_NOT_REMOVABLE`)
- UI gestão (`apps/web/src/app/(app)/conta/household/`): convidar por email+role, link gerado, lista convites pendentes com revogar, lista membros com remover.
- UI aceitação: `apps/web/src/app/aceitar-convite/[token]/page.tsx` (RSC com guard de auth → redirect `/entrar?next=`) + `_components/aceitar-convite.tsx` (botão aceitar → POST).
- Testes existentes: unit tests dos 6 handlers, testes RLS (`accept_invite.test.ts` 9 casos, `household_invites.rls.test.ts`, `household_members.rls.test.ts`).
- Audit log: acções `household_invite_sent/accepted/revoked`, `household_member_removed`.

**Por que a validação E2E não pode ser feita por um agente headless:**

O ciclo E2E requer 2 contas com sessões Supabase reais no browser (cookies `sb-*` httpOnly, gestionados por `@supabase/ssr`). Um agente headless não consegue autenticar-se de forma fiável nem segura (sem Playwright aprovado no projecto; cookie SSR httpOnly não extraível). Precedente: padrão de subtasks deferidas sem evidência inventada — Story OBS-3 (medição Lighthouse autenticada) e Story 6.8 (upload bucket E2E).

**Âmbito:** doc-only — o único entregável do agente é o runbook `docs/runbooks/invite-e2e-smoke.md`. Nenhuma alteração a código de produção ou de testes.

**Nota sobre testes de integração de API (avaliado e rejeitado):** um teste de integração que encadeie os handlers via `fetch()` simulado (Vitest + MSW) não fecha o gap real — o gap é a sessão browser + a UI + o link de convite copiado. Os handlers já têm unit tests exaustivos. Adicionar um teste de integração de API sem browser seria trabalho técnico com retorno zero face ao gap identificado. Rejeitado por proporção (ver Dev Notes §Avaliação teste integração).

## Acceptance Criteria

> Rastreabilidade: catálogo soft-launch `mj-handoff-followups-soft-launch-20260615.yaml` §follow_ups_higiene item INVITE-E2E-SMOKE; Story 6.7 (FR27, D-6.7.2, R-6.5); Constitution Article IV (zero invenção).

1. **Runbook criado** — o ficheiro `docs/runbooks/invite-e2e-smoke.md` existe, contém o procedimento passo-a-passo reproduzível do ciclo completo de convite, com pré-condições, checkpoints de verificação e espaço para evidência (capturas de ecrã) em cada passo.

2. **Pré-condições documentadas** — o runbook especifica explicitamente: (a) 2 contas de utilizador registadas em produção com emails distintos, (b) a Conta A deve ter plano `familia` ou superior (limite de membros ≥ 2 — limite do plano `free`/`pessoal` é 1), (c) URLs de produção válidos (`https://expressia.pt` ou `https://expressia-black.vercel.app`).

3. **Ciclo completo documentado** — o runbook cobre os seguintes passos em sequência, com a indicação exacta da UI/endpoint envolvido:
   - P1: Conta A acede a `/conta/household`, preenche email da Conta B + role `member`, clica "Convidar".
   - P2: Link de convite aparece na lista de pendentes; Conta A copia o link (formato `/aceitar-convite/{token}`).
   - P3: Conta B (sessão distinta, outro browser ou janela privada) abre o link.
   - P4: Conta B não autenticada → redirect automático para `/entrar?next=/aceitar-convite/{token}`.
   - P5: Conta B autentica. Redireccionada de volta para `/aceitar-convite/{token}`.
   - P6: Conta B vê a página de aceitação e clica "Aceitar convite".
   - P7: Conta A actualiza `/conta/household` → Conta B aparece na lista de membros com o role correcto.
   - P8 (opcional — teste de remoção): Conta A clica "Remover" junto à Conta B → Conta B desaparece da lista.

4. **Checkpoints de verificação documentados** — para cada passo, o runbook especifica o que deve ser visível/observável como confirmação de sucesso (ex.: mensagem na UI, item na lista, redirect correcto, página de aceitação renderizada).

5. **Caminhos de erro documentados** — o runbook documenta pelo menos 3 cenários de erro esperados e o comportamento correcto:
   - Token expirado (> 7 dias após criação) → mensagem de erro adequada.
   - Email mismatch (Conta B com email diferente do convite) → mensagem de erro adequada.
   - Convite revogado antes de aceite → comportamento esperado.

6. **Execução real do smoke [DEFERIDA — EURICO]** — Eurico executa o runbook em produção com 2 contas reais, regista evidência (captura de ecrã em cada checkpoint), e actualiza o runbook com os resultados. Proibido inventar ou marcar como feito sem evidência real.

7. **Zero alterações a código de produção** — esta story não toca em `apps/web/src/`, `packages/`, `.github/`, migrations, nem qualquer ficheiro de código de produção ou de testes. O único ficheiro de código criado é `docs/runbooks/invite-e2e-smoke.md`. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm check:rls`, `pnpm build` mantêm-se nos seus estados actuais.

## CodeRabbit Integration

> **CodeRabbit Integration**: Disabled
>
> CodeRabbit CLI não está activo em `core-config.yaml` (precedente stories SEC-1→SEC-11, RGPD-1, OBS-1, OBS-3, 6.8).
> A validação de qualidade usa o processo de revisão manual pelo @sm.

## Tasks / Subtasks

- [x] T1 — Criar o runbook `docs/runbooks/invite-e2e-smoke.md` (AC: 1, 2, 3, 4, 5)
  - [x] T1.1 — Escrever a secção de pré-condições: 2 contas distintas, plano da Conta A (`familia` ou superior), URLs de produção, sessões em browsers/perfis separados.
  - [x] T1.2 — Documentar o ciclo completo P1→P8 (AC3) com os caminhos exactos de UI/endpoints verificados, incluindo: path da UI gestão `/conta/household`, path da UI aceitação `/aceitar-convite/{token}`, redirect `/entrar?next=...` para não autenticados, e endpoint `POST /api/conta/household/aceitar-convite`.
  - [x] T1.3 — Adicionar checkpoints de verificação em cada passo (AC4): o que deve ser visível na UI e o que confirma o sucesso (item na lista, mensagem, redirect, etc.).
  - [x] T1.4 — Documentar os cenários de erro (AC5): token expirado, email mismatch, convite revogado — com o erro SQL subjacente e a mensagem esperada na UI (ver mapa de erros em Dev Notes).
  - [x] T1.5 — Adicionar secção de evidência: tabela de checkpoints com espaço para screenshot/data/resultado (a preencher pelo Eurico em T2).
  - [x] T1.6 — Adicionar nota sobre o comportamento multi-household (Nota de design da migration 0022): aceitar um convite põe o utilizador em 2 households; o `/conta/household` mostra o household do JWT (não o novo). Eurico deve verificar este comportamento no smoke.

- [ ] T2 — **[DEFERIDA — requer sessões reais Eurico]** Executar o smoke E2E em produção e registar resultados (AC: 6)
  - [ ] T2.1 — (Eurico) Preparar 2 contas em produção (`expressia.pt` ou `expressia-black.vercel.app`): Conta A (owner com plano familia) e Conta B (email distinto, conta registada).
  - [ ] T2.2 — (Eurico) Executar os passos P1→P7 do runbook, capturando screenshot em cada checkpoint.
  - [ ] T2.3 — (Eurico) Executar o passo P8 (remoção do membro) e confirmar que Conta B desaparece.
  - [ ] T2.4 — (Eurico) Testar pelo menos um cenário de erro (token expirado OU email mismatch) e confirmar o comportamento esperado.
  - [ ] T2.5 — Preencher a tabela de evidência do runbook com os resultados reais (screenshots, data, resultado PASS/FAIL por checkpoint).

- [x] T3 — Verificação final e gates (AC: 7)
  - [x] T3.1 — Confirmar via `git status` que apenas `docs/runbooks/invite-e2e-smoke.md` (+ a própria story) foram criados/modificados. Zero alterações a `apps/`, `packages/`, `.github/`, migrations.
  - [x] T3.2 — Doc-only: sem alterações de código → `pnpm lint`/`typecheck`/`test`/`build`/`check:rls` mantêm-se nos estados anteriores; não re-corridos (não afectados).

## Dev Notes

### Ficheiros relevantes — feature já implementada

**Schema:**
- `packages/db/src/schema/tenancy.ts:115-147` — `householdInvites`: `id`, `householdId`, `invitedByUserId`, `email`, `role`, `token` (text unique), `expiresAt`, `acceptedAt`, `acceptedByUserId`, `createdAt`. Constraint `uniquePending` por `(householdId, email)`.

**Migration SQL:**
- `packages/db/migrations/0022_accept_invite_user_param.sql` — `accept_invite(p_token text, p_user_id uuid)` SECURITY DEFINER. Erros tipados: `INVITE_NOT_FOUND`, `INVITE_ALREADY_ACCEPTED`, `INVITE_EXPIRED`, `INVITE_EMAIL_MISMATCH`, `ALREADY_MEMBER`, `MEMBER_LIMIT_REACHED`, `AUTH_REQUIRED`. Limite de plano: `pessoal/free`=1, `familia`=4, `pro`=10.

**API Endpoints:**
- `apps/web/src/app/api/conta/household/route.ts` — `GET` (lista membros) / `PATCH` (renomeia household; owner/admin)
- `apps/web/src/app/api/conta/household/invites/route.ts` — `GET` (lista pendentes) / `POST` (cria convite; devolve `acceptPath=/aceitar-convite/{token}`)
- `apps/web/src/app/api/conta/household/invites/[id]/route.ts` — `DELETE` (revoga; owner/admin)
- `apps/web/src/app/api/conta/household/aceitar-convite/route.ts` — `POST` com `{ token }` body; chama `accept_invite(token, user.id)`
- `apps/web/src/app/api/conta/household/members/[userId]/route.ts` — `DELETE` (remove; guard: owner → 422 `OWNER_NOT_REMOVABLE`, mensagem "O dono da família não pode ser removido.")

**UI:**
- `apps/web/src/app/(app)/conta/household/page.tsx` + `_components/household-editor.tsx` — gestão completa (convidar, lista pendentes + revogar, lista membros + remover)
- `apps/web/src/app/aceitar-convite/[token]/page.tsx` (RSC; guard auth: sem sessão → redirect `/entrar?next=/aceitar-convite/{token}`)
- `apps/web/src/app/aceitar-convite/[token]/_components/aceitar-convite.tsx` (Client Component; botão aceitar → POST `/api/conta/household/aceitar-convite`)

**Testes existentes (não alterar):**
- `apps/web/src/app/api/conta/household/__tests__/route.test.ts`
- `apps/web/src/app/api/conta/household/invites/__tests__/route.test.ts`
- `apps/web/src/app/api/conta/household/invites/[id]/__tests__/route.test.ts`
- `apps/web/src/app/api/conta/household/aceitar-convite/__tests__/route.test.ts`
- `apps/web/src/app/api/conta/household/members/[userId]/__tests__/route.test.ts`
- `packages/db-test/src/tests/accept_invite.test.ts` — 9 casos contra Postgres real (Testcontainers)
- `packages/db-test/src/tests/household_invites.rls.test.ts`
- `packages/db-test/src/tests/household_members.rls.test.ts`

### Mapa de erros SQL → comportamento UI esperado

Para documentar no runbook (T1.4):

| Erro SQL | Causa | Comportamento esperado na UI |
|----------|-------|------------------------------|
| `INVITE_EXPIRED` | `expires_at <= now()` (token com > 7 dias) | Mensagem de erro "Convite expirado" |
| `INVITE_EMAIL_MISMATCH` | Email da Conta B ≠ email do convite | Mensagem de erro "Este convite não é para este email" |
| `INVITE_ALREADY_ACCEPTED` | Token já aceite | Mensagem de erro (convite já usado) |
| `INVITE_NOT_FOUND` | Token inválido/adulterado | Mensagem de erro (convite não encontrado) |
| `ALREADY_MEMBER` | Conta B já é membro do household | Mensagem de erro (já é membro) |
| `MEMBER_LIMIT_REACHED` | Household atingiu limite do plano | Mensagem de erro (limite de membros) |

### Nota de design multi-household (a documentar no runbook — T1.6)

Todo o signup cria automaticamente um household próprio (trigger `handle_new_user`). Aceitar um convite adiciona uma membership nova sem remover a existente — o utilizador fica em 2 households. O `/conta/household` mostra o household do JWT (o household original do utilizador convidado, não o novo). Isto NÃO é um bug — é comportamento documentado na migration 0022 (nota de design). O smoke deve verificar e registar este comportamento para informar o produto.

### Plano do smoke E2E — contexto de limitação do plano (pré-condição AC2)

O plano por defeito no signup é `free` (limite 1 membro). Para que a Conta A possa convidar a Conta B, a Conta A precisa de ter plano `familia` (limite 4). Como não existe UI de upgrade (billing congelado), a Conta A usada no smoke deve ser uma conta de teste promovida manualmente via Supabase Dashboard ou `getServiceDb()` para plano `familia`. Documentar no runbook como pré-condição.

### Avaliação teste de integração de API (rejeitado — não entra no âmbito)

**Hipótese avaliada:** criar um teste Vitest que encadeie os handlers (`POST /invites` → `POST /aceitar-convite` → `GET /household` → `DELETE /members/{userId}`) usando `fetch()` ou request handlers simulados.

**Rejeição:** os 6 handlers já têm unit tests exaustivos que cobrem todos os códigos de erro e fluxos principais. O gap identificado é a validação do ciclo E2E **com sessões browser reais** — incluindo o redirect `/entrar?next=...` da RSC, o link de convite copiado, e a UI de aceitação. Um teste de integração de API sem browser não fecha este gap. Adicionar cobertura de teste já existente a nível diferente tem retorno zero face ao custo. Rejeitado por proporção (Constitution §CRITERA).

### Ambiente de execução recomendado (runbook)

- **URL preferida:** `https://expressia.pt` (se DNS-001 activo) ou `https://expressia-black.vercel.app` (fallback).
- **Sessões:** 2 browsers distintos ou perfis distintos no Chrome (ex.: janela normal + janela privada, ou Chrome + Firefox).
- **Conta A:** owner com plano `familia` (ver pré-condição de plano acima).
- **Conta B:** conta registada com email diferente da Conta A.

[Source: `packages/db/migrations/0022_accept_invite_user_param.sql` §nota-de-design multi-household; `docs/handoffs/mj-handoff-followups-soft-launch-20260615.yaml` §INVITE-E2E-SMOKE; `apps/web/src/app/aceitar-convite/[token]/page.tsx`]

### Testing

Esta story não tem testes automatizados — é documentação e smoke manual.

- **Evidência obrigatória:** captura de ecrã de cada checkpoint do ciclo P1→P8 em produção real. Deve acompanhar a actualização do runbook.
- **Gate de qualidade:** o @sm valida que (a) o runbook contém os resultados reais (não estimados), (b) cada checkpoint tem evidência (screenshot + data), (c) os cenários de erro foram testados, (d) nenhum ficheiro de código de produção foi alterado.
- **Gates de código:** mantêm-se inalterados (sem alterações a `apps/`, `packages/`, etc.). Não é necessário correr `pnpm lint`/`typecheck`/`test`/`check:rls`/`build` para esta story — mas se forem corridos por precaução, devem manter os resultados anteriores.

## Change Log

| Data | Versão | Descrição | Autor |
|------|--------|-----------|-------|
| 2026-06-18 | v1.0 | Draft inicial — gap INVITE-E2E-SMOKE identificado no catálogo soft-launch (mj-handoff-followups-soft-launch-20260615.yaml); runbook a criar como entregável autónomo; execução real deferida ao Eurico | River (@sm) |
| 2026-06-18 | v1.1-DEV | T1+T3 (autónomos) concluídos. Criado `docs/runbooks/invite-e2e-smoke.md` (pré-condições, ciclo P1→P8, checkpoints, 3 cenários de erro com mensagens reais, tabela de evidência vazia, nota multi-household). Aplicados 3 FIXES do @po à story (verificados contra código): FIX-1 `accept_invite.test.ts` = 9 casos (não 17); FIX-2 guard de remoção do owner = `OWNER_NOT_REMOVABLE` "O dono da família não pode ser removido." 422 (não `CANNOT_REMOVE_OWNER`); FIX-3 regra de transição reforçada (T1+T3 → InReview, nunca Done). T2/AC6 deferidos ao Eurico. Status → InReview. | Dex (@dev) |
| 2026-06-18 | v1.1-WAIVED | Gate @qa = CONCERNS 9,0/10 (REQ-001: núcleo E2E deferido por design; todas as citações do runbook batem com o código de produção) **aceite WAIVED pelo Eurico**. Devolver ao @dev sem efeito útil (zero defeitos factuais; só falta a execução externa). Story mantém-se **InReview** até ao smoke real (2 sessões browser + screenshots por checkpoint). Handoff criado: `mj-handoff-invite-e2e-inreview-await-smoke-20260618`. Sem push (ciclo /sdc sem `--push`). | orchestrator (/sdc) |
| 2026-06-19 | v1.2-SMOKE-PARCIAL | **Eurico executou o smoke em prod (expressia.pt) — apanhou um BUG REAL.** P1 (criar convite) falhava com 500. Causa-raiz (log Vercel): SQLSTATE **42501** "permission denied for table users" — a policy `household_invites_select_household_or_invited` acedia `auth.users` INLINE; o `INSERT...RETURNING` avaliava-a → rebentava (e o GET /invites também). **Fix aplicado:** migration `0024_fix_invites_select_policy_auth_users.sql` (função `current_user_email()` SECURITY DEFINER + recriar policy). Revisão @data-engineer APROVADO; suite RLS local 12/12; **aplicada em PROD** (db:migrate) — re-teste GET/POST=200, zero 42501. **Provado em prod pós-fix:** criar→link na UI→página `/aceitar-convite/{token}`→guard email-match ("Este convite foi enviado para outro email"). **Por validar:** aceitar numa 2.ª conta + remover membro. **Pendente [@devops]:** commitar a 0024 (viva em prod, por commitar). **Nova feature pedida (Eurico):** ligar envio de email aos convites via Resend → handoff `mj-handoff-invite-email-resend-20260619`. Story mantém-se InReview. | orchestrator (hotfix) |

## Dev Agent Record

### Agent Model Used

Claude Opus 4.8 (1M context) — Dex (@dev), modo YOLO autónomo.

### Debug Log References

Nenhum. Story doc-only — sem execução de código nem gates re-corridos.

### Completion Notes List

- **Natureza doc-only confirmada:** feature de convites/membros já implementada e versionada (Story 6.7). Único entregável de código criado é o runbook em `docs/`. Zero alterações a `apps/`, `packages/`, `.github/`, migrations.
- **3 FIXES do @po verificados contra o código real ANTES de escrever o runbook:**
  - **FIX-1 (citação) — APLICADO:** `packages/db-test/src/tests/accept_invite.test.ts` tem **9** test cases reais (contados via `grep -cE "^\s*(it|test)\("` → 9; linhas 104/127/135/143/152/164/183/195/230), não 17. Corrigido nas Dev Notes (linha do ficheiro de testes) e no Contexto (lista de testes existentes).
  - **FIX-2 (citação crítica) — APLICADO:** o guard de remoção do owner em `members/[userId]/route.ts:87-93` devolve **`OWNER_NOT_REMOVABLE`** com a mensagem **"O dono da família não pode ser removido."** e status **422** — NÃO `CANNOT_REMOVE_OWNER`. Corrigido no Contexto e nas Dev Notes da story; o nome/mensagem REAIS são usados no runbook (checkpoint P8 + mapa de erros §3.4).
  - **FIX-3 (fronteira de estado) — APLICADO:** reforçada a regra PO-S1 na secção Status: T1+T3 (autónomos) levam a story apenas a **InReview**, nunca a Done; T2+AC6 deferidos ao Eurico.
- **NICE-TO-HAVE aplicada:** limite do plano `familia` = **4** membros (confirmado em `0022_accept_invite_user_param.sql:125-130` e enum `plan_tier` em `0000_initial_schema.sql:108`). Usado no runbook §1.1 (não "≥2" genérico).
- **Mensagens de erro reais (mais precisas que o mapa genérico da Dev Notes):** extraídas de `mapAcceptInviteError` em `aceitar-convite/route.ts` — ex.: `INVITE_EXPIRED` → "Este convite expirou. Pede um novo à tua família." (410); `INVITE_EMAIL_MISMATCH` → "Este convite foi enviado para outro email. Entra com a conta certa." (403); convite revogado → `INVITE_NOT_FOUND` "Convite inválido ou inexistente." (404). Documentadas no runbook §3.
- **T2/AC6 deferidos (zero invenção — Constitution Article IV):** a tabela de evidência (runbook §7) ficou VAZIA, a preencher pelo Eurico com screenshots reais de 2 sessões browser. Precedente: OBS-3, Story 6.8.
- **Gates:** doc-only → `pnpm lint`/`typecheck`/`test`/`build`/`check:rls` NÃO afectados e NÃO re-corridos; mantêm-se nos estados anteriores. `git status --short` confirma que só `docs/` foi tocado (runbook novo + esta story).

### File List

- `docs/runbooks/invite-e2e-smoke.md` — **criado** (runbook do smoke E2E do ciclo de convite).
- `docs/stories/active/INVITE-E2E.smoke-ciclo-convite-household.story.md` — **modificado** (3 FIXES do @po, checkboxes T1/T3, Dev Agent Record, Change Log, Status → InReview).

## QA Results

### Review Date: 2026-06-18

### Reviewed By: Quinn (Test Architect)

**Natureza:** story doc-only, scope autónomo. Avaliada a QUALIDADE e CORRECÇÃO do entregue (runbook + coerência da story), não como story de código incompleta — o deferimento do núcleo E2E ao Eurico (T2/AC6) é por design (PO GO 8,5/10; precedente OBS-3 e 6.8). CodeRabbit Disabled em core-config (padrão da série) → revisão manual contra o código de produção.

**Verificação factual do runbook contra o código real (todas PASS):**

| Citação no runbook | Código verificado | Veredicto |
|---|---|---|
| Aceitação: guard auth → redirect `/entrar?next=` URL-encoded | `aceitar-convite/[token]/page.tsx:35-37` | bate |
| `POST /invites` devolve `acceptPath` + expira 7 dias (201) | `invites/route.ts:184,223,225` | bate |
| Link `${origin}${acceptPath}` na UI | `household-editor.tsx:145` | bate |
| Guard owner: `OWNER_NOT_REMOVABLE` / "O dono da família não pode ser removido." / 422 | `members/[userId]/route.ts:87-93` | bate |
| Erros tipados + mensagens PT-PT + HTTP (expirado 410 / mismatch 403 / revogado→NOT_FOUND 404 / já-aceite 409 / já-membro 409 / limite 409 / auth 401) | `aceitar-convite/route.ts:58-83` (`mapAcceptInviteError`) + migration `0022` | bate (8/8) |
| Limite plano `familia`=4 | `0022:125-130` + enum `plan_tier` `0000:108` | bate |
| Email-match case/whitespace-insensitive | `0022:106` | bate |
| Mensagem sucesso "Convite aceite. A levar-te para a tua família…" role status | `aceitar-convite.tsx:56-58` | bate |
| Nota multi-household (2 households, /conta/household mostra o do JWT) | `0022:39-44` (nota de design) | bate |

**Honestidade (Article IV):** tabela de evidência (runbook §7, 12 checkpoints) totalmente em placeholder `_( )_`; subtasks T2.1-T2.5 todas `[ ]`. Zero smoke inventado. Banner §0 e nota §7 proíbem preenchimento sem screenshots reais. CONFORME.

**Coerência story↔entrega:** 3 FIXES do @po verificados — FIX-1 (`accept_invite.test.ts` = 9 casos, confirmado via grep), FIX-2 (`OWNER_NOT_REMOVABLE`, confirmado), FIX-3 (regra PO-S1 reforçada). Checkboxes, File List, Change Log v1.1-DEV e Status=InReview honestos.

**Scope contido:** `git status` confirma só `docs/` tocado (runbook novo + story nova). Zero código de produção. Gates de código inalterados, correctamente não re-corridos.

**Issues rastreadas:**
- REQ-001 (medium): núcleo E2E (T2/AC6 + tabela §7) deferido ao Eurico por design — impede Done até existir evidência real.
- DOC-001 (low): citação de linha do badge de plano (§1.2 → 32-37 é o mapa PLAN_LABELS; renderização em 231-233). Não afecta correcção factual.

### Gate Status

Gate: CONCERNS → docs/qa/gates/INVITE-E2E-smoke-ciclo-convite-household.yml

**Veredicto:** CONCERNS — trabalho autónomo completo, factualmente exacto e honesto; a story mantém-se InReview com blindagem PO-S1/FIX-3. NÃO transitar para Done sem a execução real do smoke pelo Eurico (2 sessões browser + screenshots por checkpoint).

— Quinn, guardião da qualidade 🛡️
