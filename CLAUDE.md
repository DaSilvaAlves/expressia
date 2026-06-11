# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Identidade do Projecto

- **Codename interno (pasta local + package names `@meu-jarvis/*`):** `meu-jarvis`
- **Repo GitHub remote:** `DaSilvaAlves/expressia` (público, AGPL-3.0)
- **Marca pública:** **Expressia** — domínio `expressia.pt`
- **Mercado:** **PT-PT exclusivo** (Portugal continental). NUNCA escrever copy/UI em PT-BR; sem i18n no MVP.
- **Moeda:** EUR único, formato PT-PT (`€8,88`, `€1.234,56`, vírgula decimal).
- **Data residency:** UE obrigatória — Vercel `fra1` (Frankfurt) + Supabase `eu-central-1`.
- **Posicionamento:** SaaS multi-tenant família-first, concorrente directo do Néctar (BR), com cérebro AI multi-intent + Tarefas + Finanças.

Detalhe estratégico em `docs/project-brief.md`, `docs/prd.md` (v1.1, MVP Fase 1).

---

## Estrutura do Monorepo

`pnpm` workspaces + `turbo` task graph. Workspace globs em `pnpm-workspace.yaml`: `apps/*` + `packages/*`.

| Caminho | Package | Descrição |
|---------|---------|-----------|
| `apps/web/` | `@meu-jarvis/web` | Next.js 15 App Router + React 19 (porta 3000) |
| `packages/db/` | `@meu-jarvis/db` | Schema Drizzle, migrations SQL, cliente Postgres |
| `scripts/check-rls-coverage.ts` | — | Gate NFR5 (RLS coverage) — corrido em CI |
| `docs/` | — | PRD, architecture, db-schema, stories activas, handoffs, runbooks |
| `.aiox-core/` | — | Framework AIOX (read-only — `Edit`/`Write` bloqueados por `.claude/settings.json`) |

Source-of-truth da arquitectura: `docs/architecture.md`. Schema lógico + RLS pattern: `docs/db-schema.md`.

---

## Comandos Comuns

Tudo a partir da raiz do repo, salvo indicação contrária.

### Desenvolvimento

```bash
pnpm install                       # instala dependências (frozen-lockfile em CI)
pnpm dev                           # turbo: arranca dev de todos os packages com `dev` task
pnpm --filter @meu-jarvis/web dev  # Next.js dev em http://localhost:3000
```

### Quality gates (têm de passar pre-merge — bloqueantes)

```bash
pnpm lint        # ESLint (Next.js + workspace) — --max-warnings=0
pnpm typecheck   # TypeScript strict (turbo)
pnpm test        # Vitest em todos os packages
pnpm build       # next build + qualquer build dos packages
pnpm check:rls   # RLS Coverage Gate (NFR5) — falha CI se faltar policy
```

### Format

```bash
pnpm format        # prettier --write **/*.{ts,tsx,js,jsx,json,md}
pnpm format:check  # prettier --check
```

### Database (`@meu-jarvis/db`)

```bash
pnpm --filter @meu-jarvis/db db:generate   # drizzle-kit generate (DIRECT_URL)
pnpm --filter @meu-jarvis/db db:migrate    # runner custom: apply-migrations.ts (idempotente, tracking em __schema_migrations)
pnpm --filter @meu-jarvis/db db:seed       # apply-seeds.ts
pnpm --filter @meu-jarvis/db db:studio     # Drizzle Studio (UI local)
pnpm --filter @meu-jarvis/db db:push       # DEV ONLY — nunca em prod
```

`db:migrate` aplica `packages/db/migrations/*.sql` em ordem lexicográfica, com `set local check_function_bodies = off` para suportar helpers SQL com forward references. Usa **sempre `DIRECT_URL`** (porta 5432).

### Correr um único teste

```bash
# Vitest aceita um path/pattern como argumento posicional:
pnpm --filter @meu-jarvis/web test -- src/components/MyThing.test.tsx
pnpm --filter @meu-jarvis/db test  -- src/schema/__tests__/finance.test.ts

# Watch mode num único package:
pnpm --filter @meu-jarvis/web test:watch
pnpm --filter @meu-jarvis/db test:watch

# Filtrar por nome de teste (Vitest -t):
pnpm --filter @meu-jarvis/web test -- -t "render landing"
```

`apps/web` usa `jsdom` + Testing Library; `packages/db` usa env `node`. Setup em `apps/web/vitest.setup.ts`.

---

## Arquitectura — Big Picture

### Multi-tenancy via Postgres RLS (constraint inegociável — NFR5)

- Toda a tabela de domínio tem **`household_id uuid not null` + 4 RLS policies** (`select`/`insert`/`update`/`delete`).
- Cross-household access é bloqueado pelo Postgres, **não pela aplicação**. A app apenas escolhe o cliente certo:
  - **`getDb()`** (em `packages/db/src/client.ts`) — connection com role `authenticated`. RLS é aplicada via JWT do Supabase Auth, que injecta `request.jwt.claims.household_id`. **Usar em todas as rotas/RSC/Server Actions com utilizador final.**
  - **`getServiceDb()`** — connection com role `service_role` que **IGNORA RLS**. Usar APENAS em: migrations, jobs Inngest controlados (recurrences, GDPR purge, Stripe webhook handlers), scripts admin. NUNCA em response handlers de utilizador.
- Helpers SQL canónicos (`current_household_id()`, `is_household_member()`) em `packages/db/migrations/0000_initial_schema.sql`. Template de policy completo em `docs/architecture.md` §3.2.
- Convenção obrigatória de colunas em tabelas de domínio: `id uuid` + `household_id uuid FK ON DELETE CASCADE` + `created_at`/`updated_at timestamptz` + (onde aplicável) `created_by uuid FK users.id`.
- **Valores monetários:** `*_cents integer` (cêntimos de euro). `currency` fixo em `'EUR'` (CON9).

### RLS Coverage Gate (NFR5 — bloqueia merge)

`scripts/check-rls-coverage.ts`:

1. Faz parse de `packages/db/src/schema/*.ts`, detecta tabelas com coluna `household_id` (regex sobre `pgTable(...)`).
2. Lê `packages/db/migrations/0001_rls_policies.sql`.
3. Para cada tabela detectada, exige policies para SELECT, INSERT, UPDATE, DELETE (ou `ALL`).
4. Sai com exit code 1 se faltar coverage.

Corre em CI (job `rls-gate`) contra um Postgres 16 efémero. **Adicionar uma tabela com `household_id` sem as 4 policies parte o build.**

### Dual-URL Postgres (Supabase Pooler)

| Variável | Porta | Modo | Quando usar |
|----------|-------|------|-------------|
| `DATABASE_URL` | 6543 | `pgbouncer` transaction-mode | Runtime Next.js (RSC, route handlers, Server Actions). Cliente postgres-js precisa de `prepare: false`. |
| `DIRECT_URL` (alias `DATABASE_URL_DIRECT`) | 5432 | session-mode pooler | Migrations, `drizzle-kit`, scripts com transações longas. |

Connection strings IPv4-compatíveis usam `aws-0-eu-west-1.pooler.supabase.com` (não `db.<ref>.supabase.co`, que é DNS-only IPv6).

### Stack & Pipeline AI (Epic 2 — futuro)

Pipeline de cérebro multi-intent em 3 estágios (`docs/architecture.md` §4):

1. **Classifier** — GPT-4o-mini, output Zod-tipado (`IntentSchema`), confiança calibrada.
2. **Planner + Executor** — Claude Sonnet com tool calling sobre um `toolRegistry` tipado (`packages/agent/` — futuro).
3. **Atomicidade:** todas as tools de um prompt correm numa transacção Postgres. Cada `execute(input)` produz um `reverse_op` declarativo persistido em `agent_reverse_ops` com `expires_at = now() + 30s` para suportar undo (FR6).

Preview-then-confirm quando `confidence < 0.70` (FR4). Anthropic prompt caching no system prompt + tool definitions.

Outras integrações UE: Inngest (recurrences/installments/Stripe retry/GDPR purge), Stripe (cartão + Multibanco + MB Way — FR36), Resend (email), Sentry + Grafana Cloud (OTel).

### CI Pipeline (`.github/workflows/ci.yaml`)

3 jobs com timeouts:

- **`quality`** (10min): `lint` + `typecheck` + `test` sequencial dentro do job.
- **`rls-gate`** (8min): Postgres 16 service + `db:migrate` + `check:rls`. Corre em paralelo com `quality`.
- **`build`** (10min): `pnpm build` Next.js. `needs: [quality]` para poupar minutos quando quality falha; corre em paralelo com `rls-gate`.

Cancel-in-progress por ref. Cache pnpm store via `actions/cache@v4`. Secrets esperados: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Detalhe em `docs/runbooks/ci-setup.md`.

---

## Convenções de Código

| Regra | Detalhe |
|-------|---------|
| Imports absolutos | `@/...` — `tsconfig.base.json` strict + `paths` por package. NUNCA relativos `../../` (Constitution Article VI / NFR19). |
| TypeScript strict | `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`. Sem `any` — usar `unknown` + type guards. |
| Vitest globals | `globals: true` activo nos dois packages — `describe`/`it`/`expect` sem import. |
| PT-PT em código | Comments e error messages em português europeu. Nada de PT-BR (`utilizar`, não `usar`; `eliminar`, não `deletar`). |
| Sem build step em `@meu-jarvis/db` | Package source-only — `apps/web` consome via `transpilePackages: ['@meu-jarvis/db']` em `next.config.ts`. |
| Vercel region | `fra1` declarado em `apps/web/vercel.json`. Cron diário às 03:00 UTC em `/api/cron/daily`. |

`.env.local` em `apps/web/` e `packages/db/` — nunca commitados (gitignore). Template em `.env.example` na raiz.

---

## Story-Driven Development (workflow AIOX)

Este projecto segue o **AIOX Story Development Cycle** descrito em `~/.claude/CLAUDE.md`. Stories vivem em `docs/stories/active/` e `docs/stories/completed/`. Epic 1 (Foundation) índice em `docs/stories/active/_INDEX.md`.

Estado actual (ver `docs/HANDOFF-INDEX.md` + `docs/handoffs/*.yaml` para handoffs cross-terminal):

- **Done:** Story 1.1 (monorepo+Next.js), 1.2 (CI), 1.3 (Supabase+Drizzle bootstrap, schema aplicado: 27 tabelas, 104 policies, 24 categorias PT default).
- **Ready:** Story 1.4 (Suite Testcontainers RLS — sem bloqueador externo).
- **Blocked:** 1.5 (Auth — B2: hook Supabase no Dashboard), 1.7 (Observability — B3 Sentry EU + B4 Grafana EU).

Fluxo: `@sm *draft` → `@po *validate-story-draft` → `@dev *develop` → `@qa *qa-gate` → `@devops *push`. **Apenas `@devops` faz `git push` / `gh pr create`** (rules em `~/.claude/rules/agent-authority.md`).

### Handoffs cross-terminal

Quando uma sessão termina com trabalho incompleto, criar um handoff em `docs/handoffs/{prefix}-handoff-{slug}-{YYYYMMDD}.yaml` (prefix `mj-` para este projecto) e adicionar linha em `docs/HANDOFF-INDEX.md`. Ao consumir, marcar `consumed: true` e mover para `docs/handoffs/archive/`. Ver `~/.claude/rules/handoff-central.md`.

---

## Gotchas conhecidos (resolvidos — não repetir)

| Issue | Resolução | Onde |
|-------|-----------|------|
| `db.<ref>.supabase.co` não resolve em redes IPv4-only | Usar pooler `aws-0-eu-west-1.pooler.supabase.com` em `DATABASE_URL` (6543) e `DIRECT_URL` (5432) | `.env.example`, `docs/runbooks/supabase-setup.md` |
| `language sql` functions falham com forward references a tabelas | `set local check_function_bodies = off` antes de cada migration | `packages/db/src/scripts/apply-migrations.ts` |
| Reset de password Supabase tem 30s+ propagação no Supavisor | Esperar 30s entre reset e teste de connection | runbook |
| pgbouncer transaction-mode (6543) rejeita prepared statements | `prepare: false` no cliente `postgres-js` runtime | `packages/db/src/client.ts` |

---

## L4-only — onde editar é seguro

`.claude/settings.json` define deny rules para `.aiox-core/core/**`, `.aiox-core/development/{tasks,templates,checklists,workflows}/**`, `.aiox-core/infrastructure/**`, `.aiox-core/constitution.md`, `bin/aiox.js`, `bin/aiox-init.js`. **Nunca tentar editar esses paths** — extender via `.aiox-core/data/**` ou `agents/*/MEMORY.md` quando aplicável (allow rules explícitas).

Trabalho do projecto vive em `apps/`, `packages/`, `docs/`, `scripts/`, `.github/`.
