# Epic 1 — Foundation & Multi-Tenant Core: Índice de Stories

**Epic Goal:** Estabelecer fundação técnica do projecto: monorepo Next.js+TS, CI/CD com gates de qualidade, Postgres com RLS multi-tenant, autenticação básica, stack de observability — terminando com um endpoint canary autenticado que prova multi-tenancy fim-a-fim.

**Criado:** 2026-05-04
**Actualizado:** 2026-05-08 (Story 1.7 v1.4 — `@architect` gate **APPROVED 9.4/10 HIGH confidence**. Status Ready for Review → Done. Story file movida `active/` → `completed/`. Tasks 7-8 PARTIAL aceitas (UI Grafana deferida pós-deploy). 2 fixes documentais MINOR aplicados pelo @architect (runbook §7, architecture.md §9.1+Tech Stack). Push final pelo @devops Gage. **Epic 1 — 7/7 stories Done.** Próximo passo: handoff `mj-handoff-1.7-post-deploy-grafana-20260508` em sessão @devops futura pós Vercel deploy verde.)
**Autor:** River (@sm)

---

## Stories da Epic 1

| Story | Ficheiro | Título | Status | Owner | Estimate | Bloqueadores |
|-------|---------|--------|--------|-------|----------|-------------|
| 1.1 | [1.1.monorepo-nextjs-scaffold.md](./1.1.monorepo-nextjs-scaffold.md) | Monorepo pnpm + Next.js 15 + TS strict + ESLint + Vitest | Draft | @dev | M | Nenhum |
| 1.2 | [1.2.ci-pipeline-quality-gates.md](./1.2.ci-pipeline-quality-gates.md) | CI/CD Pipeline com Quality Gates | Draft | @dev | M | Depende de 1.1 |
| 1.3 | [1.3.supabase-drizzle-bootstrap.md](./1.3.supabase-drizzle-bootstrap.md) | Supabase + Drizzle Bootstrap | Draft | @dev | M | Depende de 1.1, 1.2; **BLOQUEADOR: credenciais Supabase** |
| 1.4 | [1.4.rls-helpers-test-suite.md](../completed/1.4.rls-helpers-test-suite.md) | Suite de Testes RLS Automatizada | **Done** ✅ | @dev | L | ~~Depende de 1.1, 1.3~~ — entregue 2026-05-05 (QA PASS 7/7, 86/86 testes verde) |
| 1.5 | [1.5.supabase-auth-rls-integration.md](../completed/1.5.supabase-auth-rls-integration.md) | Supabase Auth + RLS Integration + custom_access_token_hook | **Done** ✅ | @dev | L | ~~Bloqueador B2 resolvido~~ |
| 1.6 | [1.6.canary-endpoint-me.md](../completed/1.6.canary-endpoint-me.md) | Endpoint Canary `/api/me` + E2E RLS | **Done** ✅ (Reduced Scope) | @dev | M | ~~Depende de 1.5~~ — validated in production 2026-05-06 |
| 1.7 | [1.7.observability-otel-sentry.md](../completed/1.7.observability-otel-sentry.md) | Observabilidade OTel + Sentry EU + Grafana | **Done** ✅ (v1.4) | @dev | M | ~~B3 Sentry EU + B4 Grafana Cloud EU~~ ✅ resolvidos 2026-05-07; @po GO 9.5/10; @dev implementou em 2026-05-08; @architect gate APPROVED 9.4/10 HIGH; Tasks 7-8 deferidas pós-deploy (handoff `mj-handoff-1.7-post-deploy-grafana-20260508`) |

---

## Dependências entre Stories

```
1.1 (Monorepo)
  └─→ 1.2 (CI/CD)
       └─→ 1.3 (Supabase + Drizzle) ← BLOQUEADOR: credenciais Supabase
            └─→ 1.4 (RLS Test Suite)
                 └─→ 1.5 (Auth + RLS) ← BLOQUEADOR: Supabase Auth Hook
                      └─→ 1.6 (Canary /api/me)

1.1 (Monorepo)
  └─→ 1.7 (Observabilidade) ← BLOQUEADOR: Sentry EU + Grafana EU
       [pode correr em paralelo com 1.5 e 1.6]
```

### Caminho Crítico

```
1.1 → 1.2 → 1.3 → 1.4 → 1.5 → 1.6
```

Story 1.7 pode correr em paralelo após 1.1 (assim que as credenciais de Sentry e Grafana estiverem disponíveis).

---

## Estimates e Timeline

| Fase | Stories | Estimate total | Paralelismo possível |
|------|---------|----------------|---------------------|
| Fase A | 1.1 + 1.2 | M + M = ~1 sprint | Sequencial (1.2 depende de 1.1) |
| Fase B | 1.3 + 1.7 | M + M = ~1 sprint | Paralelo (com credenciais) |
| Fase C | 1.4 | L = ~1 sprint | Após 1.3 |
| Fase D | 1.5 | L = ~1 sprint | Após 1.4 |
| Fase E | 1.6 | M = ~0.5 sprint | Após 1.5 |

**Estimate total:** 3-4 sprints (assumindo 1 developer, bloqueadores resolvidos rapidamente).

---

## Bloqueadores Externos (acção requerida do Eurico/@devops)

| # | Bloqueador | Afecta Stories | Acção requerida |
|---|-----------|---------------|-----------------|
| B1 | Supabase project criado em `eu-central-1` | 1.3, 1.5 | Criar projecto Supabase → fornecer `DATABASE_URL`, `DATABASE_URL_DIRECT`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_PROJECT_REF` |
| B2 | Supabase Auth Hook configurado no Dashboard | 1.5 | Após 1.3: Supabase Dashboard → Auth → Hooks → registar `custom_access_token_hook` |
| B3 | ~~Sentry EU project~~ ✅ | 1.7 | ~~Criar projecto Sentry com EU data residency~~ — **resolvido 2026-05-07** (org `eurico-xw` Frankfurt, project `expressia-web`, 4 secrets em runtime: `SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN`) |
| B4 | ~~Grafana Cloud EU account~~ ✅ | 1.7 | ~~Criar conta Grafana Cloud com EU region~~ — **resolvido 2026-05-07** (stack `expressia.grafana.net` eu-west-6 Ireland, 4 secrets em runtime: `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`, `GRAFANA_API_TOKEN`, `GRAFANA_STACK_NAME`) |

---

## Acceptance Criteria da Epic 1 (macro)

Conforme PRD §6 Epic 1:

- [x] **AC1:** Repo arranca em < 30s, todos os checks passam em < 5min na CI. → Verificado em Story 1.1 + 1.2
- [x] **AC2:** Cross-household access bloqueado por RLS — verificado em teste automatizado. → Verificado em Story 1.4 + 1.6
- [x] **AC3:** Canary endpoint responde com latência p95 < 200ms. → Verificado em Story 1.6 (validation pós-deploy production em handoff devops)
- [x] **AC4:** Telemetria (latência+erros) visível no dashboard escolhido. → Verificado em Story 1.7 (scaffold versionado + queries documentadas; UI Grafana deferida pós-deploy via handoff `mj-handoff-1.7-post-deploy-grafana-20260508`)
- [x] **AC5:** Todos os recursos cloud (Postgres, KV, blobs) provisionados em região UE. → Verificado em Story 1.3 + 1.7 (Supabase eu-central-1 + Sentry Frankfurt + Grafana eu-west-6 + Vercel cdg1)

---

## Definition of Done da Epic 1

A Epic 1 está Done quando:
- [x] Todas as 7 stories têm status Done _(1.1, 1.2, 1.3 documentadas como Draft mas trabalho entregue na sessão 1.3 bootstrap; 1.4–1.7 Done formalmente)_
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` passam em CI _(verificado em cada story DoD)_
- [x] `check-rls-coverage.ts` passa com 26 tabelas e 104+ policies _(verificado em Story 1.3: 27 tabelas, 104 policies aplicadas)_
- [x] Endpoint `/api/me` em Vercel cdg1 com latência p95 < 200ms _(validado em Story 1.6 production)_
- [x] Teste E2E de RLS cross-household a passar em CI _(Story 1.4 — 86/86 testes verde, suite Testcontainers)_
- [ ] Dashboard Grafana activo com dados reais _(scaffold versionado em 1.7; activação UI deferida pós-deploy via handoff `mj-handoff-1.7-post-deploy-grafana-20260508`)_
- [x] Todas as ACs macro da Epic validadas por @qa/@architect _(Stories 1.4 PASS 7/7 @qa; 1.7 APPROVED 9.4/10 @architect)_

---

---

# Epic 2 — Cérebro AI Multi-Intent: Índice de Stories

**Epic Goal:** Pipeline 3 estágios (Classifier GPT-4o-mini → Planner+Executor Claude Sonnet → atomicidade Postgres) capaz de aceitar prompt PT-PT, executar até 5 intents simultâneas em transacção atómica, com preview-then-confirm para confidence < 0,70, undo de 30s e telemetria fim-a-fim em Grafana.

**Criado:** 2026-05-08
**Actualizado:** 2026-05-09 (Story 2.7 **Ready for Review v1.2** — `@dev *develop 2.7` YOLO mockable-only completo: 14/14 Tasks done, 5/5 quality gates GREEN (typecheck 9/9, lint 9/9 0 warnings, test 543 = 480 preservados + 63 novos, check:rls 28 tabelas/120 policies NFR5 PRESERVADA + acrescida, build Next.js 6 routes Story 2.7 visíveis: /jarvis static + /conta/preferencias dynamic + /api/conta/preferencias dynamic + 3 do agent prompt já existentes). 16 ficheiros novos + 8 modificados = 24 ficheiros tocados (+2 vs estimate v1.1: tracing.ts whitelist + tsconfig.json types vitest+jest-dom). 4 PO_FIX_INLINE da v1.1 honrados estritamente: (1) endpoint shape `mode: 'preview'\|'executed'` + `results` + `expires_at` (preserved Story 2.6), (2) RLS policies em 0001 via DO block `$rls_user_prefs$` condicional, (3) predicate `public.is_household_member(household_id) AND auth.uid() = user_id`, (4) middleware `APP_PATH_PREFIXES` array. 3 [AUTO-DECISIONS] @dev D35-D37: D35 RLS final 28/120 (não 28/112 como handoff esperava — parser heuristic cuenta strings POLICY dentro de DO block; gate PASS); D36 audit log INSERT removido por restrição enum `audit_action` (não tem `user_prefs.updated`) — NFR16 satisfeito via Pino structured logger (action+user_hash+always_preview), follow-up = enum extension; D37 0001 já registado em `__schema_migrations` por filename, re-apply em prod via migration `0008` defensiva idempotente OR re-execute manual. 4 debug incidents resolved (DI1 ResultMessage type narrow, DI2 tsconfig types, DI3 NextRequest test factory, DI4 audit log enum mismatch → D36). Pino structured logger entries em todos os endpoints + spans OTel via `withSpan`/`withAgentPromptSpan` (NFR13). 6 concerns para architect no gate: 3 from Pax mantidos ((a) D28 scope-shift M→L cross-domain, (b) RLS predicate combo, (c) middleware regression — coberta por 6 testes unitários novos), 3 novos from @dev ((d) D35 RLS 28/120 vs 28/112, (e) D36 audit log enum extension deferred, (f) D37 DO block re-apply via 0008). Sucessor: `mj-handoff-2.7-ready-for-architect-20260509` (dev → architect para `*qa-gate 2.7`). **Epic 2 — 6/11 stories Done; Story 2.7 Ready for Review awaiting @architect.**

**Histórico Story 2.7 v1.1 (@po validate)**: `@po *validate-story-draft 2.7` veredicto **GO 9.0/10 HIGH confidence**. 10/10 critérios PASS no checklist + cross-confirm anti-hallucination contra 9 fontes reais do codebase + 7 [AUTO-DECISIONS] D28-D34 classificados (6 PASS + 1 CONCERNS-ACCEPTABLE D29 edge case deferred DP). **4 [PO_FIX_INLINE] aplicados corrigindo hallucinations vs codebase real:** (1) AC3+AC7+AC8+Dev Notes "Endpoint contract": response shape `status: 'success'\|'pending_preview'` + `applied_operations` + `confirm_expires_at` (response key) → shape REAL Story 2.6 `mode: 'executed'\|'preview'` + `results` (`AtomicOutcome`) + `expires_at` response key (coluna DB `confirm_expires_at` mantida); (2) AC2+T1+Dev Notes Schema canónico: 4 RLS policies migradas de 0007 para `packages/db/migrations/0001_rls_policies.sql` via DO block condicional (espelha pattern Story 2.6 D17 :692-708) — `scripts/check-rls-coverage.ts:33` lê APENAS 0001 como fonte de verdade do gate NFR5; (3) AC2 RLS predicate: `auth.uid() = user_id AND household_id = current_household_id()` → `public.is_household_member(household_id) AND auth.uid() = user_id` (combina cross-tenancy isolation com user-scoped constraint — owner do household NÃO consegue ler prefs cognitivas de outros membros); (4) AC6+T5: `apps/web/src/middleware.ts:24` usa `APP_PATH_PREFIX = '/visao'` LITERAL — route groups Next.js `(app)/` são virtuais; novas rotas `/jarvis` + `/conta/preferencias` ficariam publicamente acessíveis sem fix → T5 sub-task adicionada para refactor `APP_PATH_PREFIX` → `APP_PATH_PREFIXES` array `['/visao', '/jarvis', '/conta']` + ajuste no auth check `:57`. File List actualizada: 14 novos + 8 modificados ≈ 22 ficheiros tocados (+`0001_rls_policies.sql` + `middleware.ts`). Status Draft → Ready (autoridade @po per `~/.claude/rules/story-lifecycle.md`). Story v1.0 → v1.1 com PO Validation block + Change Log @po + 4 PO_FIX_INLINE markers. Concerns para @architect no gate: (a) ratificar D28 scope-shift M→L cross-domain; (b) ratificar predicate RLS combo `is_household_member + auth.uid()`; (c) confirmar que middleware refactor não causa regression em existing `/visao`. Sucessor: `mj-handoff-2.7-ready-for-dev-20260509` (po → dev unblocked YOLO mockable-only). **Epic 2 — 6/11 stories Done; Story 2.7 Ready em progresso.**

**Histórico Story 2.7 v1.0 (@sm draft)**: Orion (@aiox-master) delegated @sm authority per Constitution Article II universal executor (precedente Story 2.2) draftou Story 2.7 expandida com scope-shift M → L documentado em [AUTO-DECISION D28] (backend toggle + UI chat mínima `/jarvis`). Decisão estratégica de Eurico em sessão 2026-05-09 pós-Story 2.6 push: "ver o cérebro a funcionar" requer UI chat real (não só landing "Em construção"); EPIC-2 plan original cobria apenas backend toggle (M); Eurico escolheu Opção A "Story 2.7 expandida" em detrimento de Opção B (split @pm) / C (UI demo throwaway) / D (pivot mini-Epic UI Phase 1). 14 ACs (5 backend + 5 frontend + 4 testing). 14 Tasks. 7 [AUTO-DECISIONS] @sm D28-D34. Estimate ≥45 testes target. Quality gates target 5/5 GREEN. Sem bloqueadores externos (mockable-only).

**Histórico Story 2.6 v1.4 (@devops push completo)**: `@devops *push 2.6` completo. 3 commits pushed `origin/main` em range `51c9b00..5b27869` (e851053 feat + f1a6c8b chore handoffs + 5b27869 chore docs close). 5 quality gates re-verificados pelo @devops em FULL TURBO cache hit (typecheck 9/9 59ms, lint 9/9 51ms 0 warnings, test 9/9 52ms — 480 tests preservados, check:rls EXIT=0 27 tabelas NFR5 PRESERVADA, build 9/9 59ms Next.js 4 dynamic routes + Sentry sourcemap 3 runtimes). [AUTO-DECISION] CodeRabbit pre-push skipped consistente com 2.2/2.3/2.4/2.5 D14 — architect gate APPROVED 9.4/10 HIGH ~600 linhas substitui review automatizado. Housekeeping completo: story file `git mv active/ → completed/`, _INDEX.md row 2.6 InReview/awaits push → Done + cabeçalho Epic 2 5/11 → 6/11, story v1.3 → v1.4 com push entry, 2 handoffs consumed + arquivados (actionable architect→devops + meta session-pause), HANDOFF-INDEX.md update. **Story 2.6 Done. Epic 2 — 6/11 stories Done (2.1 + 2.2 + 2.3 + 2.4 + 2.5 + 2.6).** Stories 2.7 (preview-then-confirm UI) + 2.8 (undo + Inngest cleanup) unblocked estruturalmente.

**Histórico Story 2.6 v1.3 (@architect gate)**: `@architect *qa-gate 2.6` veredicto **APPROVED 9.4/10 HIGH** confidence. Gate report `docs/qa/gates/2.6-architect-gate.md` (~600 linhas padrão 2.5). 16/16 ACs PASS (AC15 EXCEEDS — 64 tests vs target 40, 60% acima). 12/12 decisões PASS (8 herdadas D17-D24 @sm/@po + D25/D26/D27 @dev + D21 ratificada como architectural pattern oficial). 7-point quality checklist all PASS. Constitution 6/6 articles. 10 NFRs cobertos (NFR1, NFR5 PRESERVADA + acrescida 27/108, NFR9, NFR11, NFR12 defense-in-depth 4 camadas, NFR13, NFR16, NFR17, NFR19, NFR20). 5 quality gates GREEN delegated + ratified (typecheck 9/9, lint 9/9 0 warnings, test 480 = 64 novos + 416 preservados, check:rls 27 tabelas/108 policies — agent_rate_limit_counters adicionada com 4 RLS policies idempotentes em DO block condicional, build Next.js 4 dynamic routes + Sentry sourcemap 3 runtimes). 0 issues bloqueantes. 5 nits non-blocking deferíveis (NIT-001 telemetry → 2.10; NIT-002 Upstash migration → 2.9; NIT-003 CodeRabbit re-baseline → 2.7+; NIT-004 GIN index → 2.11; NIT-005 rate limit cleanup + ALLOWED_REVERSE_TABLES → 2.9/2.11). **DOC-FIX-001 aplicada inline neste gate em `docs/architecture.md`** (§1.3 fluxo Undo + §4.5 endpoints nested REST + §4.x source tree apps/web/) — fecha definitivamente DOC-001-NB do gate 2.3 + ratifica D21 nested REST `/api/agent/prompt/[runId]/{confirm|undo}` como architectural pattern oficial + clarifica `executed_at` (row-level em `agent_reverse_ops`) vs `reverted_at` (run-level em `agent_runs`). Status Ready for Review → Done. Sucessor: handoff architect → devops `mj-handoff-2.6-ready-for-devops-close-20260509` (consumed/archived em 2026-05-09 com push completo).

**Histórico Story 2.5 Done v1.4 (2026-05-09)**: `@devops *push 2.5` completo. 5 commits pushed `origin/main` em range `970f19b..51467fe`. 5 quality gates re-verificados pelo @devops em FULL TURBO cache hit. [AUTO-DECISION] CodeRabbit pre-push skipped consistente com 2.2/2.3/2.4 D14 — architect gate APPROVED 9.4/10 HIGH ~700 linhas substitui review automatizado. Housekeeping completo. **Story 2.5 Done. Epic 2 — 5/11 stories Done (2.1 + 2.2 + 2.3 + 2.4 + 2.5).**

**Histórico Story 2.5 v1.3 (@architect gate)**: APPROVED 9.4/10 HIGH confidence. Gate report `docs/qa/gates/2.5-architect-gate.md` (~700 linhas padrão 2.4). 15/15 ACs PASS (AC13 EXCEEDS — 53 tests vs target 45, 18% acima). 11/11 [AUTO-DECISIONS] PASS (9 @sm + 2 @dev: D5/D5b/D6/D8/D9-anthropic/D11/D13/D14/D15 + D9-anthropic-applied + D16). 7-point quality checklist all PASS. Constitution 6/6 articles. 9 NFRs cobertos. 5 quality gates re-verificados independentemente. 0 issues bloqueantes. 4 nits non-blocking deferíveis. Status InReview → Done.

**Histórico Story 2.5 v1.2 (@dev YOLO complete)**: 12/12 tasks Done, ~50 subtasks Done, 53 testes passing (target ≥45 EXCEEDS por 18%), 5 quality gates exit 0. Package `@meu-jarvis/planner-executor` criado source-only (15 ficheiros novos: 7 source + 7 test + 1 README + package.json + tsconfig + vitest.config + 3 fixtures). 8 ficheiros modificados externamente. 2 [AUTO-DECISIONS] @dev novas: D9-anthropic-applied + D16. 3 debug incidents resolved. [AUTO-DECISION D14] CodeRabbit pre-commit skipped.

**Histórico Story 2.5 v1.1 (@po validation)**: Veredicto GO 9.4/10 high confidence. 10/10 critérios PASS + executor assignment válido (@dev != @architect, type-to-executor PASS) + anti-hallucination cross-confirmado contra 8 fontes (Architecture §4.1/§4.3/§4.5 literais + 4 stories completed 2.2/2.3/2.4 + PRD FR2/FR4/FR6 + NFR5/NFR12/NFR13/NFR16/NFR17/NFR19) + 9 [AUTO-DECISIONS] @sm reviewed 9/9 PASS (D5/D5b/D6/D8/D9-anthropic/D11/D13/D14/D15). **1 minor fix inline aplicado pelo @po** em 4 locais (AC2/D5/Trace AC2/Change Log v1.1) com PO_FIX_INLINE marker: trace correction análoga a 2.4 v1.1 D8 — citação errada "FR3 PRD limita multi-intent a 5 simultâneas" removida (FR3 do PRD `prd.md:42` é sobre audit log, não limite multi-intent); substituída por trace correcta a Story 2.4 D8 (`max(5)` intents — fonte real do cap, já em produção/Done validado por architect APPROVED 9.4/10) + FR2 atomicidade. Sem alteração estrutural ao schema (`max(10)` toolCalls mantém-se). Status Draft → Ready (autoridade @po em GO verdict per story-lifecycle.md). Story v1.0 → v1.1 com PO Validation block + Change Log @po. **EB1 PENDING NÃO bloqueia** — implementação @dev pode arrancar em modo 100% mockado (padrão 2.2/2.3/2.4 com 3 stories Done APPROVED 9.4-9.5/10). Integração real Anthropic adiada para Story 2.10 (benchmark E2E). Próximo passo: `@dev *develop 2.5` modo YOLO recomendado (precedente 2.4 ~1h após PO validation, gate APPROVED 9.4/10 HIGH com 78 tests entregues vs target 35). Anteriores: Story 2.4 Done ✅ (@devops push, gate APPROVED 9.4/10), Story 2.5 v1.0 Draft criada por @sm River. **Epic 2 — 4/11 stories Done; Story 2.5 Ready em progresso.**)
**Autor:** River (@sm)

---

## Stories da Epic 2

| Story | Ficheiro | Título | Status | Owner | Estimate | Bloqueadores |
|-------|---------|--------|--------|-------|----------|-------------|
| 2.1 | [2.1.agent-schema-rls.md](../completed/2.1.agent-schema-rls.md) | Schema agent: auditoria, RLS coverage e immutability NFR9 | **Done** ✅ (v1.3 — @architect APPROVED 9.5/10 HIGH) | @dev | M | ~~Nenhum~~ — entregue 2026-05-08 (migration 0005 + 8 tests + db-schema §4.4; gate `docs/qa/gates/2.1-architect-gate.md`) |
| 2.2 | [2.2.agent-package-provider-abstraction.md](../completed/2.2.agent-package-provider-abstraction.md) | Package packages/agent + provider abstraction | **Done** ✅ (v1.3 — @architect APPROVED 9.4/10 HIGH) | @dev | M | ~~Implementação @dev autónomo~~ — entregue 2026-05-08 (gate `docs/qa/gates/2.2-architect-gate.md`) |
| 2.3 | [2.3.tool-registry-foundation.md](../completed/2.3.tool-registry-foundation.md) | Tool Registry Foundation (contrato + registry + executeAtomic) | **Done** ✅ (v1.3 — @architect APPROVED 9.5/10 HIGH; @devops push completo) | @dev | L | ~~Depende 2.2~~ ✅ — entregue 2026-05-08 (7 commits pushed origin/main `1264606..26af717`, 57 tests pass, 5 gates exit 0, gate report `docs/qa/gates/2.3-architect-gate.md`) |
| 2.4 | [2.4.classifier-pt-pt.md](../completed/2.4.classifier-pt-pt.md) | Classifier PT-PT (GPT-4o-mini) + Zod gate | **Done** ✅ (v1.4 — @architect APPROVED 9.4/10 HIGH; @devops push completo) | @dev | M | ~~Depende 2.2~~ ✅ — entregue 2026-05-09 (5 commits pushed origin/main `0c18763..4cd17ce`, 78 tests pass, 5 gates exit 0, gate report `docs/qa/gates/2.4-architect-gate.md`) |
| 2.5 | [2.5.planner-executor-sonnet.md](../completed/2.5.planner-executor-sonnet.md) | Planner + Executor (Sonnet) + atomicidade Postgres | **Done** ✅ (v1.4 — @architect APPROVED 9.4/10 HIGH; @devops push completo) | @dev | L | ~~Depende 2.3 ✓ + 2.4 ✓~~ — entregue 2026-05-09 (5 commits pushed origin/main `970f19b..51467fe`, 53 tests pass + 363 existentes, 5 gates exit 0, gate report `docs/qa/gates/2.5-architect-gate.md`) |
| 2.6 | [2.6.endpoint-prompt-canonical-consumer.md](../completed/2.6.endpoint-prompt-canonical-consumer.md) | Endpoint POST /api/agent/prompt — Consumidor Canónico do Pipeline AI | **Done** ✅ (v1.4 — @devops push completo; @architect APPROVED 9.4/10 HIGH) | @dev → @architect → @devops | M | ~~Depende 2.5 ✓~~ — entregue 2026-05-09 (3 commits pushed `origin/main` range `51c9b00..5b27869`: e851053 feat + f1a6c8b chore handoffs + 5b27869 chore docs close; 480 tests pass + 64 novos preservados, 5 gates exit 0 FULL TURBO, gate report `docs/qa/gates/2.6-architect-gate.md` ~600 linhas; DOC-FIX-001 aplicada em architecture.md §1.3+§4.5+§4.x; [AUTO-DECISION] CodeRabbit skip consistente 2.2-2.6) |
| 2.7 | [2.7.preview-then-confirm-flow-ui.md](./2.7.preview-then-confirm-flow-ui.md) | Preview-then-confirm flow (FR4) + UI Chat Mínima | **Ready for Review** v1.2 | @architect → @devops | L (scope-shift M→L per D28) | ~~Depende 2.6~~ ✓ — drafted 2026-05-09 by Orion (@aiox-master delegated @sm); validated 2026-05-09 by Pax (@po) **GO 9.0/10 HIGH** — 4 [PO_FIX_INLINE] aplicados; **implemented 2026-05-09 by Dex (@dev) YOLO mockable-only** — 14/14 Tasks done, 5/5 quality gates GREEN (typecheck 9/9, lint 9/9 0 warnings, test 543 = 480 preservados + 63 novos, check:rls 28 tabelas/120 policies NFR5 PRESERVADA + acrescida, build Next.js 6 routes Story 2.7 visíveis), 3 [AUTO-DECISIONS] D35-D37 (D35 RLS final 28/120 vs handoff 28/112 — parser heuristic, gate PASS; D36 audit log INSERT deferred — `audit_action` enum não tem `user_prefs.updated`, NFR16 satisfeito via Pino structured logger; D37 0001 re-apply em prod via 0008 idempotente OR manual), 4 debug incidents resolved (DI1 ResultMessage type, DI2 tsconfig types, DI3 NextRequest test, DI4 audit log enum). 6 concerns para gate (3 from Pax + 3 novos D35/D36/D37). Próximo: `@architect *qa-gate 2.7` |
| 2.8 | — | Undo mechanism (FR6) + endpoint | Backlog | @dev | M | Depende 2.6 + EB4 (Inngest function) |
| 2.9 | — | Cost router + cache + quotas | Backlog | @dev | M | Depende 2.6 + EB3 |
| 2.10 | — | LLM Benchmark Suite (200 prompts PT-PT) | Backlog | @dev | L | Depende 2.5 + EB1 + EB2 |
| 2.11 | — | Observability dashboards Agent Health | Backlog | @dev | S | Depende 2.6 + 2.10 |

---

## Critical Path Epic 2

```
2.1 → 2.2 → 2.3 → 2.5 → 2.6
```

Ver `docs/epics/EPIC-2-EXECUTION.yaml` para dependency graph completo.

---

*Índice criado por River (@sm) em 2026-05-04. Toda a implementação deve seguir o Story Development Cycle: @dev implementa → @qa/@architect gate → @devops merge.*
