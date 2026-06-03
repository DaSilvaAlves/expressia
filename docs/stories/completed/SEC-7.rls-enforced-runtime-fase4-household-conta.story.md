# Story SEC-7: Household/Conta — RLS enforced em runtime (2.ª rede, ADR-003 Fatia C)

> **ID:** `SEC-7` (segurança transversal — Fase 4 do ADR-003, Fatia C). Story cross-epic, não pertence a epic numerado.
> **Depende de:** SEC-2 (Done, `98c8176`) — wrapper `withHousehold` + gate de aplicação; SEC-3 (Done, `298a122`) — padrão API handlers; SEC-5 (Done, `d27d9c8`) — domínio Tarefas (API handlers) fechado; SEC-6 (InReview PASS, `18220b6`) — Visão + SSR Tarefas fechados.
> **Scoping prévio:** ADR-003 Adenda §11.3 (@architect, referência Fatia C) — Household/conta + `user_prefs` (confirmação @data-engineer de policies: R-1→R-4, Fase 0 concluída com GO). Fase 0 @data-engineer confirmou: 104 policies intactas, `user_prefs` fechada por `is_household_member AND auth.uid() = user_id` (user-scoped ✓), `aceitar-convite` SECURITY DEFINER — excepção permanente documentada.
> **Handoff de origem:** contexto fornecido directamente pelo utilizador (03/06/2026, superfície 100% verificada).

## Status

**Done v1.3-ARCH-APPROVED (@architect Aria, 03/06/2026 — re-gate adversarial PASS 9,6/10 Alta).** Implementada — 6 ficheiros migrados `getDb()`→`withHousehold` (2.ª rede RLS); `aceitar-convite` intocado (excepção permanente SEC-7); gate db-test estendido ao domínio Household. Os 4 PO-FIX aplicados (PO-FIX-1 CRÍTICO confirmado byte-a-byte). **Gate @architect: 8/8 focos de segurança MET; 12/12 ACs MET; D-SEC7.1/2/3 ratificadas; gates re-corridos reais (db-test 202/202 Postgres, check:rls exit 0, web conta+bem-vindo 79/79, flaky calendario isolado 5/5 não-regressão). Zero vectores residuais.** Gate file: `docs/qa/gates/SEC-7-architect-gate.md`. Próximo: `@devops *push SEC-7`.

> _Validação @po: GO · Readiness 9,0/10 · Confiança Alta (ver "PO Validation" abaixo). Draft inicial: v0.1 (@sm River)._

> _Draft inicial: v0.1 (@sm River, 03/06/2026)._

---

## PO Validation (Pax, 03/06/2026) — GO 9,0/10

Verificação independente byte-a-byte. Superfície, call-sites, exclusão dura, fora-de-âmbito, assinatura `withHousehold` e gate db-test **todos confirmados contra o código real**. 4 PO-FIX de precisão antes de `*develop`:

### PO-FIX-1 (CRÍTICO) — AC1/AC2 não usam `requireAuth`; usam auth RSC inline

**Localização:** AC1 (L69-77), AC2, AC9 (L114), Dev Notes ponto 1 (L192), T1.1 (L144).

O draft afirma que `requireAuth(span)` é a fonte de `{ userId, householdId }` em **todos** os route handlers. **FALSO para 2 dos 5:**

- `api/conta/household/route.ts` (AC1) — usa `createServerSupabaseClient()` + `supabase.auth.getUser()` (L95-99 GET, L241-245 PATCH) + `resolveHouseholdId(user.id)` **inline** (L112/L258). **Não** chama `requireAuth`. Não tem `auth.userId`/`auth.householdId`.
- `api/conta/preferencias/route.ts` (AC2) — idem (getUser L95-98/L202-205 + resolveHouseholdId L111/L218).

Só `invites/route.ts`, `invites/[id]/route.ts`, `members/[userId]/route.ts` usam `requireAuth(span)` → `auth.userId`/`auth.householdId` (confirmado L87/L129, L41, L45).

**Correcção para @dev:** Em `household` e `preferencias`, o callback é:
```typescript
const result = await withHousehold(
  { userId: user.id, householdId },   // user.id do getUser(); householdId do resolveHouseholdId — NÃO auth.userId/auth.householdId
  (tx) => /* operação de domínio */,
);
```
Este é exactamente o padrão RSC do ADR-003 §10.2/§10.3 (`{ userId: user.id, householdId }`), idêntico a SEC-4/SEC-6. Para os 3 handlers mistos mantém-se `{ userId: auth.userId, householdId: auth.householdId }`. T1.1 e AC1 devem reflectir `user.id`+`householdId` (não `auth.*`).

### PO-FIX-2 (MENOR) — `bem-vindo/actions.ts`: `redirect()` fica fora do `withHousehold`

**Localização:** AC6 (L96-98), Dev Notes ponto 7 (L198), T6.1.

`completeOnboarding` faz `db.execute(...)` (L66-70) e **depois** `redirect('/visao?welcome=1')` (L73, lança `NEXT_REDIRECT`, deliberadamente fora de try/catch). Ao migrar, **apenas o `db.execute`** entra no callback `withHousehold`; o `redirect` fica **depois** do `await withHousehold(...)`. Envolver o `redirect` na tx faria o `NEXT_REDIRECT` abortar a transação (rollback) e potencialmente perder a escrita de `onboarding_completed_at`. AC9 ("sem return HTTP dentro do callback") já cobre o espírito — reforçar explicitamente para o `redirect`.

### PO-FIX-3 (MENOR) — AC11/T8.1: fixtures já existem; user-scoped exige inserir prefs de B

**Localização:** AC11 (L131-133), T8.1, Dev Notes "Sobre `user_prefs`".

Confirmado que a extensão é **viável sem fixtures novos**: `insertHouseholdInvite(sql, householdId, invitedByUserId, email)` e `insertUserPrefs(sql, userId, householdId, overrides)` já existem (`packages/db-test/src/helpers/fixtures.ts:378,470`); `seedTwoHouseholds()` já cria `household_members` (owner A/B) e `households`; `household_invites`/`household_members`/`households`/`user_prefs` já estão em `TABLES_TO_TRUNCATE`. **Nuance user-scoped:** `user_prefs` é PK 1:1 por `user_id` e fechada por `auth.uid() = user_id`. O teste user-scoped deve inserir prefs **para userB** (via `insertUserPrefs(admin(), userB.id, householdB.id)`) e provar que `asUser(userA.id, householdA.id, ...)` vê **0 rows de B** (não inserir prefs de A para "não ver as próprias"). Para o caso household-scoped, preferir `household_invites` (tem fixture directa) sobre `household_members` (criado implicitamente pelo seed — testável mas menos directo). Réplica fiel dos blocos SEC-3/SEC-5 do `rls-application.test.ts`.

### PO-FIX-4 (MENOR) — Mock db-shim: nem todos os ficheiros precisam de `getDb` no mock

**Localização:** AC10 (L122-127), T1.2/T2.2/T6.2.

O snippet do mock (AC10) inclui `getDb` + `withHousehold`. Para os 3 handlers mistos (invites, invites/[id], members) **ambos** são necessários (handler misto). Mas `household`, `preferencias` e `bem-vindo` ficam **sem** `getDb` após a migração (getDb removido) — o mock desses 3 deve expor **só** `withHousehold` (manter `getDb` no mock de um ficheiro que já não o importa é inofensivo mas confuso; o teste `preferencias` AC11 actual afirma "usa getDb não getServiceDb" — esse teste precisa de ser **actualizado** para reflectir `withHousehold`, senão falha após migração). @dev: rever o teste `preferencias/__tests__/route.test.ts:234` ("AC11 — usa getDb()") — passa a ser "usa withHousehold".

### Confirmações byte-a-byte (sem acção)

- Call-sites exactos: household L125/L293 · preferencias L124/L261 · invites L91/L160 (+audit L183 best-effort try/catch) · invites/[id] L57 (+audit L72) · members/[userId] L61 (+audit L100) · bem-vindo L65. **Todos verificados.**
- Exclusão dura `aceitar-convite/route.ts`: `accept_invite(token, user_id)` SECURITY DEFINER, user.id explícito (migration 0022), zero membership do household-alvo → AC7 inequívoco e correcto.
- Fora de âmbito `api/me/route.ts`: 100% PostgREST (`.from('household_members')`), zero `getDb()` → confirmado.
- `withHousehold` em `db-shim.ts:79`, assinatura `(auth: { userId, householdId }, fn)` → confirmado.
- Gate db-test NÃO cobre Household (cobre tasks/transactions/accounts/categories/tags/task_tags/kanban_columns/task_recurrences + service_role bypass) → AC11 extensão obrigatória **correctamente identificada** como diferença estrutural face a SEC-6.
- Os 6 ficheiros têm testes existentes (incl. `bem-vindo/__tests__/actions.test.ts`).
- §10.3 (withSpan outermost, withHousehold dentro) documentado nos Dev Notes (ponto 6) → correcto.

**Veredicto:** GO. Os 4 PO-FIX são de precisão de mecanismo (não de desenho). PO-FIX-1 é o único que muda código face ao escrito (auth source em 2 handlers) — @dev deve aplicá-lo antes de migrar AC1/AC2.

## Executor Assignment

```
executor: "@dev"
quality_gate: "@architect"
quality_gate_tools: ["lint", "typecheck", "test", "build", "check:rls"]
```

## Story

**As a** engenheiro/product owner da Expressia,
**I want** que os handlers e server actions do domínio Household/conta (`api/conta/household`, `api/conta/preferencias`, `api/conta/household/invites`, `api/conta/household/invites/[id]`, `api/conta/household/members/[userId]`, `bem-vindo/actions.ts`) corram as suas leituras/escritas de domínio dentro de `withHousehold(auth, fn)` — activando a RLS viva em runtime (2.ª rede) — mantendo o filtro `household_id` app-enforced (1.ª rede, SEC-1) intacto em todos os call-sites que o têm,
**so that** este domínio tenha a mesma defense-in-depth de duas redes que os domínios Finanças (SEC-3/SEC-4), Tarefas-API (SEC-5) e Visão/SSR-Tarefas (SEC-6) já têm — completando a Fase 4 do ADR-003 para o domínio Household, sem migration SQL (104 policies intactas).

---

## Contexto e âmbito

### O que já existe (não reimplementar)

- `withHousehold<T>(auth, fn)` em `packages/db/src/client.ts:119` (`pgSql.begin` → transação real, rollback no throw; injecta `sub`+`household_id`+`role` nos claims JWT via `SET LOCAL`), re-exportado por `apps/web/src/lib/agent/db-shim.ts:79`. Produção desde SEC-2. **Assinatura: `withHousehold({ userId, householdId }, (tx) => …)` — precisa de `userId` E `householdId`.**
- Padrão de migração de **route handler** provado em SEC-2/3/5: `withHousehold(auth, tx => helper(tx, …))`, `getDb()` removido se sem outro uso.
- Padrão de **server action** — idêntico ao route handler: `withHousehold({ userId, householdId }, tx => ...)`.
- `requireAuth(span)` — fonte de `{ userId, householdId }` para rotas API com `withSpan`.
- `insertAuditLog` — best-effort, fora do `withHousehold` em `getDb()` (PO-FIX-2 / D-SEC3): esta função não é household-scoped; envolvê-la quebraria a semântica audit (que deve gravar mesmo se a tx de domínio falhar). Padrão consolidado em SEC-3/SEC-5.

### Superfície SEC-7 — ficheiros a migrar

| # | Ficheiro | `getDb()` em | Notas |
|---|----------|--------------|-------|
| 1 | `apps/web/src/app/api/conta/household/route.ts` | L125, L293 | 2 call-sites |
| 2 | `apps/web/src/app/api/conta/preferencias/route.ts` | L124, L261 | 2 call-sites (user_prefs — user-scoped, fechado por `is_household_member AND auth.uid()=user_id`) |
| 3 | `apps/web/src/app/api/conta/household/invites/route.ts` | L91, L160 | + `insertAuditLog` L183 (best-effort, fica fora do `withHousehold`) |
| 4 | `apps/web/src/app/api/conta/household/invites/[id]/route.ts` | L57 | + `insertAuditLog` L72 (fora) |
| 5 | `apps/web/src/app/api/conta/household/members/[userId]/route.ts` | L61 | + `insertAuditLog` L100 (fora) |
| 6 | `apps/web/src/app/bem-vindo/actions.ts` | L65 | server action onboarding |

> O @dev localiza cada call-site pelo handler/função, não por offset rígido. Os offsets acima são guia de navegação, não contrato de linha.

### Exclusão dura — `aceitar-convite` NÃO migra (excepção permanente)

`apps/web/src/app/api/conta/household/aceitar-convite/route.ts` — tem `getDb()` mas chama `accept_invite()` SECURITY DEFINER (migration `0022:55-59`). Opera sobre o household de que o utilizador ainda **não é membro** no momento da chamada → `withHousehold` scoparia o household errado **e** seria inútil (DEFINER ignora RLS do caller). Excepção permanente do mesmo tipo que `insertAuditLog`/`incrementQuota`. **NÃO tocar neste ficheiro.**

### Fora de âmbito — `api/me/route.ts` (R-4 RESOLVIDO)

`apps/web/src/app/api/me/route.ts` usa **exclusivamente** `createServerSupabaseClient` (PostgREST, `.from('household_members')`), ZERO `getDb()` directo → já é RLS-via-JWT. Não precisa de `withHousehold`. Documentado nos Dev Notes como fora de âmbito — não confundir com a superfície SEC-7.

### Nota Fase 0 @data-engineer — R-1 (informativa, sem acção)

R-1: a branch `auth.users` na policy SELECT de `invites` não é exercitada pelo endpoint (usa `is_household_member`). Nota informativa — sem acção no código. Documentada nos Dev Notes.

---

## Acceptance Criteria

### AC1 — `api/conta/household/route.ts`: ambos os call-sites correm dentro de `withHousehold` (2.ª rede)

Os 2 call-sites `getDb()` (L125 e L293) migram para `withHousehold`. `auth = requireAuth(span)` já fornece `{ userId, householdId }`:

```typescript
const result = await withHousehold(
  { userId: auth.userId, householdId: auth.householdId },
  (tx) => /* operação de domínio usando tx */,
);
```

`getDb()` removido do ficheiro (sem outro uso); import passa de `getDb`→`withHousehold` (via `@/lib/agent/db-shim`). `withSpan` outermost, `withHousehold` dentro (§10.3). Guards, status codes e mensagens PT-PT inalterados.

### AC2 — `api/conta/preferencias/route.ts`: ambos os call-sites correm dentro de `withHousehold` (2.ª rede)

Os 2 call-sites `getDb()` (L124 e L261) migram para `withHousehold`. Embora `user_prefs` seja user-scoped (fechada por `is_household_member AND auth.uid() = user_id`), a tabela pertence ao domínio do household — a 2.ª rede adiciona defesa sem remover a 1.ª. `getDb()` removido; import `getDb`→`withHousehold`. Guards, status codes, mensagens PT-PT inalterados.

### AC3 — `api/conta/household/invites/route.ts`: call-sites de domínio dentro de `withHousehold`; `insertAuditLog` FORA

Os call-sites `getDb()` de domínio (L91, L160) migram para `withHousehold`. O `insertAuditLog` (L183) **mantém-se em `getDb()` fora do callback** (padrão SEC-3/SEC-5 — best-effort, deve gravar mesmo se a tx de domínio falhar/reverter). `getDb()` mantém-se no ficheiro apenas para `insertAuditLog`; import expõe ambos. Guards, status codes, mensagens PT-PT inalterados.

### AC4 — `api/conta/household/invites/[id]/route.ts`: call-site de domínio dentro de `withHousehold`; `insertAuditLog` FORA

O call-site `getDb()` (L57) migra para `withHousehold`. O `insertAuditLog` (L72) **mantém-se em `getDb()` fora do callback** (mesmo padrão). `getDb()` mantém-se apenas para `insertAuditLog`. Guards, status codes inalterados.

### AC5 — `api/conta/household/members/[userId]/route.ts`: call-site de domínio dentro de `withHousehold`; `insertAuditLog` FORA

O call-site `getDb()` (L61) migra para `withHousehold`. O `insertAuditLog` (L100) **mantém-se em `getDb()` fora do callback**. `getDb()` mantém-se apenas para `insertAuditLog`. Guards, status codes inalterados.

### AC6 — `bem-vindo/actions.ts`: server action migra para `withHousehold` (2.ª rede)

O call-site `getDb()` (L65) migra para `withHousehold({ userId, householdId }, tx => ...)`. A fonte de `userId`/`householdId` na server action (ex.: `getUser()` + `resolveHouseholdId`) mantém-se inalterada. `getDb()` removido se sem outro uso; import actualizado. Comportamento do fluxo de onboarding inalterado.

### AC7 — `aceitar-convite/route.ts` INTOCADO (excepção permanente documentada)

`apps/web/src/app/api/conta/household/aceitar-convite/route.ts` **não é modificado**. A excepção é permanente: SECURITY DEFINER opera sobre household de que o utilizador ainda não é membro; `withHousehold` scoparia errado e seria inútil. Um comentário no ficheiro (ou nos Dev Notes) documenta a excepção para futuros modificadores.

### AC8 — 1.ª rede MANTIDA; `getServiceDb()`/helpers puros NÃO tocados

- Onde a 1.ª rede (filtro `household_id`) já existe nos call-sites migrados, **mantém-se** — `withHousehold` é aditivo, nunca remove.
- Nenhum ficheiro passa a usar `getServiceDb()` (grep: zero introduções).
- `getServiceDb()` / jobs Inngest — intocáveis.
- Sem migration SQL nova (104 policies intactas desde `0001_rls_policies.sql` — NÃO correr `db:migrate`).

### AC9 — Import via `db-shim.ts`; auth/guards/early-returns INALTERADOS

- `withHousehold` importado de `@/lib/agent/db-shim` (nunca directo de `@meu-jarvis/db/client`).
- `requireAuth` (routes com `withSpan`) / `createServerSupabaseClient`+`getUser`+`resolveHouseholdId` (server actions) e todos os early-returns/respostas de erro ficam **exactamente como estão**.
- Nenhum `return NextResponse` / `return …` de lógica HTTP dentro de um callback `withHousehold` — toda a decisão de resposta fica fora do callback.
- `insertAuditLog` (AC3/AC4/AC5) fora do `withHousehold`, em `getDb()` — sem quebrar a semântica audit best-effort.

### AC10 — Testes: mock `withHousehold` + smoke audit log (R-2 obrigatório)

Para cada ficheiro migrado com teste existente, o mock de `@/lib/agent/db-shim` inclui `withHousehold` (padrão SEC-2/4/5/6):

```typescript
vi.mock('@/lib/agent/db-shim', () => ({
  getDb: () => fakeDb,          // mantido nos ficheiros com insertAuditLog (handler misto)
  withHousehold: (_auth: unknown, fn: (tx: unknown) => unknown) => fn(fakeDb),
}));
```

**R-2 (smoke audit obrigatório — Fase 0 @data-engineer):** Os ficheiros que chamam `insertAuditLog` (AC3, AC4, AC5) têm de confirmar, após migração, que a row de audit **continua a gravar**. Cada um destes testes deve incluir ≥1 asserção de que `insertAuditLog` (ou o mock equivalente) é chamado após a operação de domínio. Documenta a decisão de manter `insertAuditLog` fora da tx (padrão SEC-3/SEC-5 ratificado — best-effort não pode ser engolido pela tx de domínio).

### AC11 — Gate de aplicação cobre o domínio Household (extensão obrigatória)

O gate de aplicação real `packages/db-test/src/tests/rls-application.test.ts` deve ser **estendido** para cobrir o domínio Household com ≥1 tabela household-scoped (ex.: `household_members` ou `invites`) e ≥1 caso user-scoped (`user_prefs`) — provando isolamento cross-household A/B em runtime com a role `authenticated`. Réplica do padrão SEC-3/SEC-5/SEC-6 (caso A não vê dados do caso B). Esta extensão é **obrigatória** (ao contrário de SEC-6 que herdou cobertura completa — Household não estava coberto por SEC-3/SEC-5).

### AC12 — Gates de qualidade TODOS VERDES; sem migration

`pnpm lint` · `pnpm typecheck` · `pnpm test` (web + db-test Docker) · `pnpm build` · `pnpm check:rls` — todos exit 0. **Sem migration SQL nova** (104 policies intactas — NÃO correr `db:migrate`).

---

## Tasks / Subtasks

- [x] **T1 — `api/conta/household/route.ts`** (AC1, AC8, AC9, AC10)
  - [x] T1.1 Migrados os 2 call-sites `getDb()` (GET household+members; PATCH role-check+update) para `withHousehold({ userId: user.id, householdId }, (tx) => …)` (PO-FIX-1: auth RSC inline, NÃO `auth.*`); `getDb` removido; import `getDb`→`withHousehold`.
  - [x] T1.2 Test: mock passa de `getDb` para `withHousehold` (invoca callback com fake db); contrato de resposta verde.

- [x] **T2 — `api/conta/preferencias/route.ts`** (AC2, AC8, AC9, AC10)
  - [x] T2.1 Migrados os 2 call-sites `getDb()` (GET lazy-init+select; PATCH upsert) para `withHousehold` (PO-FIX-1: auth RSC inline `{ userId: user.id, householdId }`); `getDb` removido; import actualizado.
  - [x] T2.2 Test: mock `withHousehold` (substitui `getDb`/`getServiceDb`); teste AC11 actualizado getDb→withHousehold (PO-FIX-4); testes verdes.

- [x] **T3 — `api/conta/household/invites/route.ts` (handler misto)** (AC3, AC8, AC9, AC10)
  - [x] T3.1 Migrados os 2 call-sites de domínio (GET select; POST insert) para `withHousehold`; `insertAuditLog` mantém `getDb()` fora do callback; `getDb` mantido no import (handler misto).
  - [x] T3.2 Test: mock `withHousehold` + `getDb`; R-2 smoke — asserção `insertAuditLog` chamado c/ `household_invite_sent` após operação de domínio.

- [x] **T4 — `api/conta/household/invites/[id]/route.ts` (handler misto)** (AC4, AC8, AC9, AC10)
  - [x] T4.1 Migrado o call-site de domínio (DELETE) para `withHousehold`; `insertAuditLog` mantém `getDb()` fora; `getDb` mantido no import.
  - [x] T4.2 Test: mock `withHousehold` + `getDb`; R-2 smoke — asserção `insertAuditLog` c/ `household_invite_revoked`.

- [x] **T5 — `api/conta/household/members/[userId]/route.ts` (handler misto)** (AC5, AC8, AC9, AC10)
  - [x] T5.1 Migrados os 2 call-sites de domínio (role lookup + DELETE) para `withHousehold` (decisões 404/422 fora do callback — AC9); `insertAuditLog` mantém `getDb()` fora; `getDb` mantido no import.
  - [x] T5.2 Test: mock `withHousehold` + `getDb`; R-2 smoke — asserção `insertAuditLog` c/ `household_member_removed`.

- [x] **T6 — `bem-vindo/actions.ts`** (AC6, AC8, AC9, AC10)
  - [x] T6.1 Migrado o call-site `getDb()` para `withHousehold({ userId: user.id, householdId }, (tx) => …)`; fonte = `getUser()` + `resolveHouseholdId` inline (confirmado); `redirect()` FORA do `withHousehold` (PO-FIX-2).
  - [x] T6.2 Test: mock `withHousehold`; fluxo de onboarding (UPSERT 1 call + redirect) verde.

- [x] **T7 — `aceitar-convite/route.ts`: confirmar exclusão + comentário** (AC7)
  - [x] T7.1 Confirmado por leitura que `aceitar-convite/route.ts` mantém `getDb()` + `accept_invite()` SECURITY DEFINER (intocado na lógica). Adicionado comentário de excepção permanente SEC-7 no header JSDoc.

- [x] **T8 — Gate de aplicação: extensão domínio Household** (AC11)
  - [x] T8.1 Estendido `packages/db-test/src/tests/rls-application.test.ts` com 2 describe blocks SEC-7: `household_invites` household-scoped (3 testes: isolamento A/B, filtro cruzado, INSERT cross-household bloqueado) + `user_prefs` user-scoped (3 testes, PO-FIX-3: prefs de B inseridas, A vê 0 rows). 202 testes db-test verdes.

- [x] **T9 — Quality gates** (AC12)
  - [x] T9.1 `pnpm lint` ✓ (exit 0) · T9.2 `pnpm typecheck` ✓ (10/10) · T9.3 `pnpm --filter @meu-jarvis/web test` ✓ (1079/1080; 1 flaky pré-existente `calendario/page.test.tsx` timeout sob carga — passa isolado 1551ms, não-regressão) · T9.4 `pnpm --filter @meu-jarvis/db-test test` (Docker, incl. extensão T8.1) ✓ (202/202) · T9.5 `pnpm build` ✓ (exit 0) · T9.6 `pnpm check:rls` ✓ (16 tabelas). Sem `db:migrate`.

---

## Dev Notes

### Referências-chave (leitura obrigatória)

| Recurso | Localização | Porquê |
|---------|-------------|--------|
| Padrão route handler (mutações) | `api/conta/household/route.ts` (actual) + `api/tasks/route.ts:89` (GET migrado SEC-2) | Forma EXACTA: `withHousehold(auth, tx => op(tx, …))` |
| `withHousehold` (assinatura + mecânica) | `db-shim.ts:79` (re-export) · `client.ts:119` (`pgSql.begin`, claims `sub`+`household_id`) | **Precisa de `userId` E `householdId`** |
| Padrão `insertAuditLog` fora da tx | SEC-3 (`api/financas/*`) e SEC-5 (`api/tasks/*`) completados | `getDb()` para audit; `withHousehold` para domínio. Handler misto = import expõe ambos |
| Gate de aplicação | `packages/db-test/src/tests/rls-application.test.ts` | T8.1 — extensão obrigatória para Household |
| ADR | `docs/adr/ADR-003-…md` §10.3 (padrão migração `withSpan`+`withHousehold`), §11.3 (Fatia C) | Scoping + excepção `aceitar-convite` |

### Pontos críticos

1. **`withHousehold` exige `userId` E `householdId`.** Routes têm-nos via `requireAuth`. Server action `bem-vindo/actions.ts` obtém-nos via `getUser()` + `resolveHouseholdId` (ou equivalente) — confirmar a fonte antes de migrar T6.
2. **Handler misto (AC3/AC4/AC5):** `insertAuditLog` usa `getDb()` **fora** do callback `withHousehold`. Nunca envolver `insertAuditLog` dentro da tx de domínio — a semântica audit é best-effort (deve gravar mesmo que a tx reverta). O import mantém `getDb` e `withHousehold`.
3. **`aceitar-convite` — excepção permanente.** A lógica SECURITY DEFINER opera sobre um household de que o utilizador ainda não é membro. `withHousehold` scoparia o household errado (o RLS do chamador é irrelevante porque DEFINER ignora). Esta excepção é permanente e está documentada no ADR.
4. **`api/me/route.ts` fora de âmbito (R-4).** Usa PostgREST (`.from('household_members')`), zero `getDb()` directo — já é RLS-via-JWT. Não confundir com superfície SEC-7. Não tocar.
5. **R-1 (informativo, sem acção).** A branch `auth.users` na policy SELECT de `invites` não é exercitada pelo endpoint (usa `is_household_member`). Nota de contexto, não requer alteração de código.
6. **`withSpan` outermost, `withHousehold` dentro (§10.3).** Manter a ordem para evitar overhead de contexto desnecessário dentro da tx.
7. **Sem early-returns dentro do callback `withHousehold`.** Toda a decisão de resposta HTTP (status codes, JSON) fica fora — o callback só executa e devolve o resultado de domínio.

### REQ-INLINE-1

`getDb`, `withHousehold` e `sql` vêm **sempre** de `@/lib/agent/db-shim`, **nunca** directamente de `@meu-jarvis/db` ou `@meu-jarvis/db/client`. Todos os imports dos ficheiros migrados devem usar este shim. Parâmetros bound sempre com `${value}::uuid`, nunca concatenação de string.

### Sobre `user_prefs` (user-scoped, AC2)

A tabela `user_prefs` é fechada por `is_household_member AND auth.uid() = user_id` (confirmado Fase 0 @data-engineer). A 2.ª rede via `withHousehold` é **aditiva e válida**: o contexto household é relevante para provar que o membro activo pertence ao household da sessão. A 1.ª rede (filtro `user_id = auth.userId` app-enforced, se existir no call-site) mantém-se inalterada.

### Sobre `api/me` e `aceitar-convite` (fora de âmbito)

- `api/me/route.ts` — PostgREST, RLS-via-JWT já activo. Fora de âmbito SEC-7; não tocar.
- `aceitar-convite/route.ts` — excepção permanente SECURITY DEFINER. Fora de âmbito SEC-7; não tocar.

### Convenções

Imports `@/` absolutos · sem `any` (`unknown` + guards) · PT-PT em comentários/erros · `prepare:false` intocado · REQ-INLINE-1 · parâmetros bound sempre (`${value}::uuid`), nunca concatenação.

### Riscos (para @architect no gate)

| Risco | Mitigação |
|-------|-----------|
| `insertAuditLog` envolvido por engano dentro de `withHousehold` | AC3/AC4/AC5 explícitos; T3.2/T4.2/T5.2 smoke audit; handler misto obrigatório |
| `aceitar-convite` migrado por engano | T7.1 — confirmar por leitura que não foi tocado |
| `bem-vindo/actions.ts` sem fonte de `householdId` | T6.1 — confirmar a fonte antes de migrar; typecheck apanha se indefinido |
| 1.ª rede removida nos call-sites com filtro existente | AC8 — grep `household_id` antes/depois (≥) |
| `withHousehold` envolve return HTTP | AC9 — toda decisão de resposta fora do callback |
| Gate db-test não estendido para Household | T8.1 — obrigatório; @architect confirma por leitura do ficheiro |
| `api/me` confundido com superfície | Dev Notes explícitos; grep zero `getDb` em `api/me/route.ts` |

---

## Testing

| Camada | Ferramenta | Ficheiros |
|--------|-----------|-----------|
| Routes Household/conta (unit + contrato) | Vitest node (`apps/web`) | `api/conta/household/__tests__/*`, `api/conta/preferencias/__tests__/*`, `api/conta/household/invites/__tests__/*`, `api/conta/household/invites/[id]/__tests__/*`, `api/conta/household/members/[userId]/__tests__/*` |
| Server action onboarding | Vitest (`apps/web`) | `bem-vindo/__tests__/*` (se existir) |
| Smoke audit log R-2 | Vitest (`apps/web`) | T3.2, T4.2, T5.2 — nos testes de cada handler misto |
| Gate de aplicação RLS (2.ª rede — extensão obrigatória) | Vitest + Testcontainers (`db-test`) | `packages/db-test/src/tests/rls-application.test.ts` (extensão: domínio Household ≥2 casos) |
| Gate estático | `pnpm check:rls` | — |

---

## CodeRabbit Integration

> **CodeRabbit Integration**: Disabled — sem `coderabbit_integration` em `core-config.yaml`. Validação via @architect adversarial gate (padrão SEC-1/2/3/4/5/6).

---

## Dev Agent Record (Dex, 03/06/2026)

### Resumo da implementação

ADR-003 Fase 4 Fatia C (Household/conta) — 6 ficheiros migrados de `getDb()` para `withHousehold` (2.ª rede RLS, aditiva à 1.ª rede app-enforced SEC-1, que ficou INALTERADA). `aceitar-convite/route.ts` intocado (excepção permanente — SECURITY DEFINER). Sem migration (104 policies intactas). Gate db-test estendido obrigatoriamente ao domínio Household.

### Os 4 PO-FIX aplicados

- **PO-FIX-1 (CRÍTICO) — confirmado byte-a-byte:** `household/route.ts` e `preferencias/route.ts` NÃO usam `requireAuth`. Li ambos: ambos usam `createServerSupabaseClient()` + `supabase.auth.getUser()` + `resolveHouseholdId(user.id)` inline. O objecto passado ao wrapper é `{ userId: user.id, householdId }` (do `getUser()` + `resolveHouseholdId`), NÃO `auth.userId`/`auth.householdId`. Os 3 handlers mistos (invites, invites/[id], members) usam `requireAuth` → `{ userId: auth.userId, householdId: auth.householdId }`.
- **PO-FIX-2 — aplicado:** em `bem-vindo/actions.ts` só o `db.execute` entrou no callback `withHousehold`; o `redirect('/visao?welcome=1')` ficou FORA (após o `await withHousehold(...)`) — evita rollback do `NEXT_REDIRECT`.
- **PO-FIX-3 — aplicado:** no gate db-test, o caso user-scoped insere prefs de userB (`insertUserPrefs(admin(), userB.id, householdB.id)`) e prova que userA vê 0 rows; +1 teste household-scoped `household_invites`.
- **PO-FIX-4 — aplicado:** mock dos 3 ficheiros migrados (`household`, `preferencias`, `bem-vindo`) expõe SÓ `withHousehold`; os 3 handlers mistos mantêm `getDb` + `withHousehold`. Teste `preferencias/__tests__/route.test.ts` AC11 actualizado (getDb→withHousehold).

### Decisões de implementação (para @architect ratificar)

- **[DEV-DECISION D-SEC7.1]** Em handlers com múltiplas queries de domínio e early-returns intermédios (`household` GET household+members; `members` role-lookup→404/422→DELETE; `household` PATCH role-check→403→UPDATE), usei `withHousehold` separados por bloco de query, com a decisão de resposta (404/403/422) SEMPRE FORA do callback (AC9). Em `household` GET, as duas leituras (household + members) partilham um único `withHousehold` (mesma sessão RLS) retornando `{ householdRows, memberRows }`. Razão: minimizar nº de transações onde as queries são contíguas, mas nunca pôr lógica HTTP dentro da tx. Réplica do padrão SEC-3 (retorno discriminado / early-returns fora do callback).
- **[DEV-DECISION D-SEC7.2]** `preferencias` GET: o lazy-init UPSERT + o SELECT subsequente ficaram no MESMO `withHousehold` (callback async retornando o resultado do SELECT). Razão: ambos são domínio user_prefs na mesma sessão; o parsing/fallback (`WidgetsEnabledSchema`/`ThemeSchema`) fica fora do callback.
- **[DEV-DECISION D-SEC7.3]** Mock de teste de `withHousehold`: `(_auth, fn) => fn({ execute: mockExecute })` — invoca o callback síncronamente com o fake db partilhado, preservando as asserções `toHaveBeenCalledTimes` existentes (cada `withHousehold` chama o callback uma vez; o nº de `execute` por callback mantém-se). Padrão SEC-2/4/5/6.

### Gates (resultados reais, 03/06/2026)

| Gate | Resultado |
|------|-----------|
| `pnpm lint` | exit 0 — No ESLint warnings or errors |
| `pnpm typecheck` | exit 0 — 10/10 packages |
| `pnpm check:rls` | exit 0 — 16 tabelas (incl. household_members/household_invites/user_prefs) |
| `pnpm --filter @meu-jarvis/web test` | 1079/1080 — 1 flaky pré-existente (`calendario/page.test.tsx`, timeout 5000ms sob carga paralela); passa isolado em 1551ms → não-regressão confirmada (mesmo protocolo SEC-5/SEC-6) |
| `pnpm --filter @meu-jarvis/db-test test` | 202/202 (Docker UP, Testcontainers) — incl. extensão SEC-7 (6 testes novos: 3 household_invites + 3 user_prefs) |
| `pnpm build` | exit 0 |

### File List

**Modificados (código):**
- `apps/web/src/app/api/conta/household/route.ts` — GET + PATCH migrados; import `getDb`→`withHousehold`; `getDb` removido
- `apps/web/src/app/api/conta/preferencias/route.ts` — GET + PATCH migrados; import `getDb`→`withHousehold`; `getDb` removido
- `apps/web/src/app/api/conta/household/invites/route.ts` — GET + POST domínio em `withHousehold`; `getDb` mantido p/ audit; import expõe ambos
- `apps/web/src/app/api/conta/household/invites/[id]/route.ts` — DELETE domínio em `withHousehold`; `getDb` mantido p/ audit
- `apps/web/src/app/api/conta/household/members/[userId]/route.ts` — role-lookup + DELETE em `withHousehold`; `getDb` mantido p/ audit
- `apps/web/src/app/bem-vindo/actions.ts` — UPSERT em `withHousehold`; redirect fora (PO-FIX-2); import `getDb`→`withHousehold`
- `apps/web/src/app/api/conta/household/aceitar-convite/route.ts` — comentário de excepção permanente SEC-7 (lógica intocada — AC7)

**Modificados (testes):**
- `apps/web/src/app/api/conta/household/__tests__/route.test.ts` — mock getDb→withHousehold
- `apps/web/src/app/api/conta/preferencias/__tests__/route.test.ts` — mock→withHousehold; teste AC11 actualizado (PO-FIX-4)
- `apps/web/src/app/api/conta/household/invites/__tests__/route.test.ts` — mock +withHousehold; R-2 smoke audit
- `apps/web/src/app/api/conta/household/invites/[id]/__tests__/route.test.ts` — mock +withHousehold; R-2 smoke audit
- `apps/web/src/app/api/conta/household/members/[userId]/__tests__/route.test.ts` — mock +withHousehold; R-2 smoke audit
- `apps/web/src/app/bem-vindo/__tests__/actions.test.ts` — mock getDb→withHousehold
- `packages/db-test/src/tests/rls-application.test.ts` — +2 describe blocks SEC-7 (household_invites + user_prefs); +2 imports de fixtures

## Change Log

| Data | Versão | Descrição | Autor |
|------|--------|-----------|-------|
| 2026-06-03 | 0.1 | Draft inicial — ADR-003 Fase 4 Fatia C (Household/conta). 6 ficheiros migram (`api/conta/household`, `api/conta/preferencias`, `api/conta/household/invites`, `invites/[id]`, `members/[userId]`, `bem-vindo/actions.ts`). Excepção permanente: `aceitar-convite` SECURITY DEFINER (não migra). Fora de âmbito: `api/me` (PostgREST, RLS-via-JWT). Padrão handler misto (AC3/AC4/AC5): `insertAuditLog` em `getDb()` fora do `withHousehold` (best-effort, padrão SEC-3/SEC-5). R-2 smoke audit obrigatório. Gate db-test: extensão obrigatória domínio Household (tabela household-scoped + user_prefs user-scoped, isolamento cross-household A/B). Sem migration (104 policies intactas). | River (@sm) |
| 2026-06-03 | 1.1 | **Validação @po — GO 9,0/10 confiança Alta.** Verificação byte-a-byte dos 6 call-sites + ADR §10.3/§11.3 + gate db-test + harness. 4 PO-FIX inline (secção "PO Validation"): PO-FIX-1 CRÍTICO (AC1/AC2 `household`+`preferencias` usam auth RSC inline `{userId:user.id, householdId}`, NÃO `requireAuth`/`auth.*`); PO-FIX-2 (`bem-vindo` `redirect` fora do `withHousehold`); PO-FIX-3 (AC11 fixtures `insertHouseholdInvite`/`insertUserPrefs` já existem; user-scoped exige inserir prefs de B); PO-FIX-4 (mock: 3 ficheiros migrados ficam só com `withHousehold`; actualizar teste `preferencias` AC11 getDb→withHousehold). Status → Ready for Dev v1.1. | Pax (@po) |
| 2026-06-03 | 1.2-DEV | **Implementação @dev — Ready for Review.** 6 ficheiros migrados `getDb()`→`withHousehold` (2.ª rede RLS aditiva, 1.ª rede SEC-1 inalterada); `aceitar-convite` intocado + comentário de excepção (AC7). Os 4 PO-FIX aplicados (PO-FIX-1 confirmado byte-a-byte por leitura dos 2 ficheiros RSC-inline). Gate db-test estendido ao domínio Household (+6 testes: household_invites household-scoped + user_prefs user-scoped, isolamento A/B). 3 [DEV-DECISION] D-SEC7.1/2/3 (ver Dev Agent Record). 6/6 gates GREEN (web 1079/1080 + 1 flaky pré-existente isolado-OK; db-test 202/202 Docker UP; lint/typecheck/build/check:rls exit 0). Sem migration. Próximo: `@architect *qa-gate SEC-7`. | Dex (@dev) |
| 2026-06-03 | 1.3-ARCH-APPROVED | **Re-gate adversarial @architect — PASS 9,6/10 confiança Alta → Done.** Varredura INDEPENDENTE byte-a-byte dos 7 ficheiros de código + 7 de teste. 8/8 focos de segurança MET: (1) withHousehold correcto/withSpan outermost/queries sobre tx; (2) PO-FIX-1 auth RSC inline confirmado nos 2 RSC + requireAuth nos 3 mistos; (3) 1.ª rede household_id preservada byte-a-byte (provado por git diff — só db.execute→tx.execute); (4) insertAuditLog fora da tx + R-2 smoke nos 3 mistos; (5) aceitar-convite lógica intocada (só JSDoc); (6) zero getServiceDb real + zero migration (104 policies); (7) gate db-test não-tautológico (dados de B via admin lidos via asUser — falharia se RLS falhasse); (8) api/me PostgREST intocado. 12/12 ACs MET. D-SEC7.1/2/3 RATIFICADAS. Gates re-corridos reais: check:rls exit 0, db-test 202/202 (Postgres Testcontainers), web conta+bem-vindo 79/79, flaky calendario isolado 5/5 (não-regressão); lint/typecheck/build FULL TURBO cache válido. Zero vectores residuais. Gate file: `docs/qa/gates/SEC-7-architect-gate.md`. Obs housekeeping (não-bloqueante): ADR-003 não existe como ficheiro físico — recomendado materializar. Próximo: `@devops *push SEC-7`. | Aria (@architect) |
