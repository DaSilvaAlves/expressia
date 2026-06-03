# Architect Gate — SEC-7 (RLS enforced runtime, Fase 4 Fatia C — Household/conta)

> **Gate por:** @architect (Aria) — autor do ADR-003. Lane independente da implementação (@dev Dex).
> **Data:** 2026-06-03
> **Tipo:** Re-gate adversarial INDEPENDENTE (story de segurança — vazamento cross-tenant).
> **Veredicto:** **PASS 9,6/10 — Confiança Alta**
> **Decisão de status:** SEC-7 → Done v1.3-ARCH-APPROVED.

---

## Sumário executivo

ADR-003 Fase 4 Fatia C fecha o domínio Household/conta com a 2.ª rede (RLS viva em runtime via `withHousehold`). 6 ficheiros migrados `getDb()`→`withHousehold`; `aceitar-convite` intocado (excepção permanente SECURITY DEFINER). A 1.ª rede (filtro `household_id` app-enforced, SEC-1) está **preservada byte-a-byte** em todos os call-sites (provado por `git diff`: única alteração é `db.execute`→`tx.execute` + indentação). Gate de aplicação real estendido obrigatoriamente ao domínio Household (+6 testes contra Postgres real). Sem migration (104 policies intactas). Varredura adversarial independente: **zero vectores residuais**.

---

## Verificação dos 8 focos de segurança (varredura byte-a-byte independente)

| # | Foco | Veredicto | Evidência (ficheiro:linha) |
|---|------|-----------|----------------------------|
| 1 | `withHousehold` correcto (withSpan outermost, queries de domínio sobre `tx`) | **MET** | household `route.ts:96/132-166` (GET) + `247/309/334` (PATCH); preferencias `route.ts:94/130/295`; invites `route.ts:86/96` + `131/171`; invites/[id] `route.ts:39/63`; members `route.ts:43/69/97`; bem-vindo `actions.ts:71`. Em todos `withSpan` é outermost e cada query de domínio corre sobre o `tx` do callback — **zero `getDb()` solto dentro de um callback `withHousehold`**. |
| 2 | PO-FIX-1 (household + preferencias usam auth RSC inline, NÃO requireAuth) | **MET** | household `route.ts:101-105` (`getUser`) + `118` (`resolveHouseholdId(user.id)`) + `133` (`{ userId: user.id, householdId }`); idem `247-270`. preferencias `route.ts:99-103`+`116`+`131`; idem `210-227`+`295`. Os 3 mistos usam `requireAuth(span)` → `{ userId: auth.userId, householdId: auth.householdId }` (invites `route.ts:91/97`; invites/[id] `route.ts:44/64`; members `route.ts:48/70`). Shape real confirmado. |
| 3 | 1.ª rede (filtro `household_id`/`user_id`) MANTIDA — nenhum filtro removido | **MET** | `git diff HEAD` prova: `where household_id = ${auth.householdId}::uuid` preservado em invites/members; `where id = ${householdId}::uuid` + `where household_id = ${householdId}::uuid` em household; `where user_id = ${user.id}::uuid` em preferencias. Única mudança no diff: `db.execute`→`tx.execute` + reindentação. Grep confirmou 8 call-sites com filtro intacto. |
| 4 | `insertAuditLog` FORA da tx (R-2: row de audit ainda grava) | **MET** | invites `route.ts:169` (`getDb()`) → `171-188` (`withHousehold` domínio) → `196-208` (`insertAuditLog` fora, try/catch best-effort); invites/[id] `route.ts:61/63-72/80-92`; members `route.ts:65/69-106/113-125`. R-2 smoke provado nos testes: `household_invite_sent` (invites test:104), `household_invite_revoked` ([id] test:84), `household_member_removed` (members test:91). |
| 5 | Exclusão dura: `aceitar-convite` lógica INTOCADA | **MET** | `aceitar-convite/route.ts:114` (`getDb()`) + `117-119` (`accept_invite` SECURITY DEFINER, `user.id` explícito). `git diff` mostra +8 linhas — **só JSDoc** (`21-25` excepção permanente). Lógica byte-a-byte inalterada. Não migrado = correcto. |
| 6 | `getServiceDb()`/service_role intocado; SEM migration nova | **MET** | Grep em `api/conta`: zero `getServiceDb()` real (só menções "NUNCA getServiceDb" em comentários). `git status packages/db/migrations/`: vazio. 104 policies intactas. db-test "service_role bypass intacto" (rls-application:515-534) passa. |
| 7 | Gate db-test estendido (AC11) — não-tautológico, provaria leak | **MET** | `rls-application.test.ts:429-472` household_invites (3 testes: A vê 1/0 de B; filtro cruzado WHERE B→0; INSERT cross-household bloqueado) + `474-513` user_prefs (3 testes user-scoped, PO-FIX-3: prefs de B inseridas via `admin()`, A vê 0; SELECT WHERE user_id=B→0; **caso discriminante L502-512** ambos com prefs, A vê exactamente 1 — prova `auth.uid()=user_id`). Dados de B inseridos com bypass RLS e lidos via `asUser` role authenticated: se a RLS falhasse, os testes falhariam. **NÃO tautológicos.** 202/202 db-test verde contra Postgres real. |
| 8 | `api/me` fora de âmbito (R-4, PostgREST) — não tocado | **MET** | Grep `getDb` em `api/me/route.ts`: única ocorrência é comentário (`L19`). Zero `getDb()` real → 100% PostgREST. Não no `git diff`. Intocado. |

**8/8 focos MET. Varredura adversarial além do catálogo:** verifiquei (a) lifecycle sub-rotas (`invites/[id]`, `members/[userId]`, `aceitar-convite`) — todas household-scoped ou exclusão dura justificada; (b) janela TOCTOU em members (role-lookup + DELETE em txs separadas) — inofensiva porque o DELETE é idempotente, household-scoped (`where household_id AND user_id`) e protegido pela RLS; (c) `withHousehold` nunca envolve `return NextResponse` (AC9) — confirmado nos 6 ficheiros. **Zero vectores residuais.**

---

## Acceptance Criteria

**12/12 MET.** AC1-AC7 (migração + exclusão dura) verificados por leitura; AC8 (1.ª rede + service_role + sem migration) por `git diff` + grep; AC9 (import shim, early-returns fora do callback) por leitura; AC10 (mock withHousehold + R-2 smoke audit) por leitura dos 7 testes; AC11 (gate db-test Household) por leitura + execução real (202/202); AC12 (gates verdes) por re-execução.

---

## DEV-DECISIONs

| Decisão | Veredicto | Fundamentação arquitectural |
|---------|-----------|------------------------------|
| **D-SEC7.1** — withHousehold por bloco; decisão HTTP fora; household GET partilha 1 wrapper (household+members) | **RATIFICADA** | Réplica fiel do padrão SEC-3 (early-returns fora do callback). GET partilha tx (mesma sessão RLS, eficiente); PATCH/members usam wrappers separados com 403/404/422 entre eles fora do callback. TOCTOU em members inofensiva (DELETE idempotente + household-scoped + RLS). `route.ts:132-166/309-347`, members `route.ts:69-106`. |
| **D-SEC7.2** — preferencias GET: lazy-init UPSERT + SELECT no mesmo withHousehold; parsing Zod fora | **RATIFICADA** | Ambas operações domínio user_prefs na mesma sessão RLS — partilhar a tx é correcto e mantém atomicidade do lazy-init→read. Parsing/fallback fora do callback respeita AC9. `route.ts:130-150`. |
| **D-SEC7.3** — mock `(_auth, fn) => fn({ execute: mockExecute })` | **RATIFICADA** | Preserva `toHaveBeenCalledTimes` (1 callback/withHousehold, fake db partilhado). Padrão SEC-2/4/5/6 consolidado. Verificado nos 7 testes. |

---

## Gates (re-corridos — números reais, não confiados no relatório do @dev)

| Gate | Resultado | Re-corrido / Cache |
|------|-----------|--------------------|
| `pnpm lint` | exit 0 | FULL TURBO cache (source inalterado desde run do dev) |
| `pnpm typecheck` | exit 0 (10/10) | FULL TURBO cache |
| `pnpm check:rls` | **exit 0** (20 tabelas, incl. user_prefs/households/household_members/household_invites) | **RE-CORRIDO real** |
| `pnpm --filter @meu-jarvis/db-test test` | **202/202** (37 ficheiros, Postgres Testcontainers, incl. extensão SEC-7) | **RE-CORRIDO real (gate de segurança crítico)** |
| `pnpm --filter @meu-jarvis/web test` (conta+bem-vindo) | **79/79** (8 ficheiros) | **RE-CORRIDO real (superfície SEC-7)** |
| Flaky `tarefas/calendario/page.test.tsx` | 5/5 isolado (1894ms) | **RE-CORRIDO isolado — não-regressão confirmada** (timeout sob carga paralela, pré-existente, fora da superfície SEC-7; protocolo SEC-5/SEC-6) |
| `pnpm build` | exit 0 | FULL TURBO cache do @dev (sem alteração de config; padrão SEC-3/SEC-4) |

---

## Observação de housekeeping (não-bloqueante)

O documento **ADR-003 não existe como ficheiro físico** no repo (`docs/adr/` ausente; grep `ADR-003` retorna zero ficheiros). É referenciado por todas as stories SEC-1→7 como source-of-truth mas vive apenas como contexto conceptual partilhado pelo utilizador. **Recomendação:** materializar o ADR-003 em `docs/adr/ADR-003-rls-runtime-enforcement.md` consolidando §3 (contrato withHousehold), §10.2/§10.3 (padrão migração RSC/route), §11.3 (Fatias A-C + excepções R-1..R-4). Não bloqueia SEC-7 (a Fase 4 está agora completa para todos os domínios), mas a auditabilidade futura beneficia de um artefacto durável. Não é trabalho desta story.

---

## Veredicto final

**PASS 9,6/10 — Confiança Alta.** Defense-in-depth de duas redes agora completa no domínio Household/conta, alinhada com Finanças (SEC-3/4), Tarefas-API (SEC-5) e Visão/SSR (SEC-6). A 1.ª rede provada intacta por diff; a 2.ª rede provada viva por gate de aplicação real (202/202). Exclusão dura correcta. Zero migration. As 3 DEV-DECISIONs ratificadas. Desconto de 0,4 puramente preventivo (housekeeping ADR físico ausente + janela TOCTOU teórica inofensiva em members — documentada, não accionável).

**SEC-7 → Done v1.3-ARCH-APPROVED.** Próximo: `@devops *push SEC-7`.
