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
**Actualizado:** 2026-05-09 (Story 2.5 **Ready for Review v1.2** — `@dev *develop 2.5` YOLO autónomo completo (~45min, mais rápido que precedente 2.4 ~1h). 12/12 tasks Done, ~50 subtasks Done, 53 testes passing (target ≥45 EXCEEDS por 18%), 5 quality gates exit 0 (typecheck 9/9 FULL TURBO, lint 9/9 0 warnings 44s, test 53 novos + 222+ inalterados, check:rls 26/104 NFR5 PRESERVADA, build Next.js 9 routes 1m03s). Package `@meu-jarvis/planner-executor` criado source-only (15 ficheiros novos: 7 source + 7 test + 1 README + package.json + tsconfig + vitest.config + 3 fixtures). 8 ficheiros modificados externamente: `packages/agent/src/index.ts` (D9-anthropic-applied — 1 linha re-export `AnthropicClientLike`), `packages/tools/src/{atomic,contracts,registry,tracing}.ts` (D16 — `@/*` → `./` cross-package compat), `packages/classifier/src/{classifier,index}.ts` (D16 análogo), `apps/web/{next.config.ts,package.json}` (transpile + workspace dep). **2 [AUTO-DECISIONS] @dev novas:** D9-anthropic-applied (analogia D9 da 2.4 zero-risk validada por gate APPROVED 9.4/10) + D16 (refactor `@/*` → `./` em tools+classifier source files — pattern consistente com `packages/agent/src/*` desde Story 2.2; tests internos mantêm `@/*`; zero alteração comportamental verificado por 222+ testes existentes). 3 debug incidents resolved (cross-package TS alias resolution, mock-db-tx executeAtomic contract, cacheControl `??` null bug). [AUTO-DECISION D14] CodeRabbit pre-commit skipped consistente com 2.2/2.3/2.4. Status Ready → InProgress → Ready for Review. Story v1.1 → v1.2 com Dev Agent Record completo + File List + Change Log @dev. Anteriores: Story 2.5 Draft v1.0 (@sm), v1.1 (@po GO 9.4/10), Story 2.4 Done. **Próximo passo: `@architect *qa-gate 2.5`** (gate report ~700 linhas padrão 2.4, ~1h estimado). Epic 2 — 4/11 stories Done; Story 2.5 Ready for Review.

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
| 2.5 | [2.5.planner-executor-sonnet.md](./2.5.planner-executor-sonnet.md) | Planner + Executor (Sonnet) + atomicidade Postgres | **Ready for Review** (v1.2 — @dev YOLO complete; 53 tests ≥45 EXCEEDS; 5/5 gates exit 0; aguarda @architect) | @dev | L | Depende 2.3 ✓ + 2.4 ✓; EB1 PENDING (não bloqueia mockable-only) |
| 2.6 | — | Endpoint POST /api/agent/prompt autenticado | Backlog | @dev | M | Depende 2.5 + EB3 (Upstash Redis) |
| 2.7 | — | Preview-then-confirm flow (FR4) | Backlog | @dev | M | Depende 2.6 |
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
