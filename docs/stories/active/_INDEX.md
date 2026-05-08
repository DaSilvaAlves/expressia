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
**Actualizado:** 2026-05-08 (Story 2.1 v1.1 — **Ready**. `@po` Pax validou GO 9.5/10 high confidence; 10/10 critérios PASS; descoberta nomenclatura cross-confirmada via leitura directa do schema; 2 minor fixes aplicados inline. Próximo: `@dev *develop 2.1`.)
**Autor:** River (@sm)

---

## Stories da Epic 2

| Story | Ficheiro | Título | Status | Owner | Estimate | Bloqueadores |
|-------|---------|--------|--------|-------|----------|-------------|
| 2.1 | [2.1.agent-schema-rls.md](./2.1.agent-schema-rls.md) | Schema agent: auditoria, RLS coverage e immutability NFR9 | **Ready** ✅ (v1.1 — @po GO 9.5/10) | @dev | M | Nenhum (schema existe desde Story 1.3) |
| 2.2 | — | Package packages/agent + provider abstraction | Backlog | @dev | M | Depende 2.1 Done + EB1 (Anthropic API key) + EB2 (OpenAI API key) |
| 2.3 | — | Tool Registry contract + 2 tools mínimas | Backlog | @dev | L | Depende 2.2 |
| 2.4 | — | Classifier PT-PT (GPT-4o-mini) + Zod gate | Backlog | @dev | M | Depende 2.2 + EB2 |
| 2.5 | — | Planner + Executor (Sonnet) + atomicidade Postgres | Backlog | @dev | L | Depende 2.3 + 2.4 + EB1 |
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
