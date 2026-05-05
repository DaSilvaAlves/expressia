# Expressia

> SaaS multi-tenant **família-first** para gestão financeira e de tarefas em Portugal — com cérebro AI multi-intent que recebe linguagem natural, classifica intenção e executa em transacção atómica com undo de 30 segundos.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)
[![Status](https://img.shields.io/badge/status-MVP%20em%20desenvolvimento-orange)](docs/stories/active/_INDEX.md)
[![Market](https://img.shields.io/badge/mercado-PT--PT%20exclusivo-green)](#identidade)
[![Stack](https://img.shields.io/badge/stack-Next.js%2015%20%7C%20Postgres%20%7C%20Drizzle-black)](#stack)

---

## O que é

**Expressia** é o produto público (codinome interno: `meu-jarvis`). É um concorrente directo do Néctar (BR), mas **exclusivamente para o mercado português**: PT-PT, EUR único, residência de dados na União Europeia, sem internacionalização no MVP.

O posicionamento hero é o tier **Família €8,88/mês**: cinco funcionalidades cruzadas (chat AI, tarefas partilhadas, finanças, listas, calendário) que justificam pagar versus alternativas single-purpose.

A grande diferenciação técnica é o **pipeline AI multi-intent** (Epic 2):

1. **Classifier** (GPT-4o-mini) — recebe texto livre, devolve `Intent` Zod-tipado com confiança calibrada
2. **Planner + Executor** (Claude Sonnet) — tool calling sobre registry tipado
3. **Atomicidade** — todas as tools de um prompt correm numa transacção Postgres; cada operação produz `reverse_op` declarativo persistido com `expires_at = now() + 30s` para undo

---

## Status actual (Epic 1 — Foundation)

| Story | Estado | Notas |
|-------|--------|-------|
| 1.1 — Monorepo + Next.js scaffold | ✅ Done | pnpm workspaces, turbo, Next 15 + React 19 |
| 1.2 — CI Pipeline | ✅ Done | GitHub Actions, 3 jobs, RLS Coverage Gate |
| 1.3 — Supabase + Drizzle bootstrap | ✅ Done | Schema aplicado: 27 tabelas, 104 policies, 24 categorias PT default |
| 1.4 — Suite de Testes RLS | ✅ Done | 86 testes via Testcontainers, QA gate PASS 7/7 |
| 1.5 — Auth + RLS Integration | 🟡 Ready | Bloqueada por config externa (Supabase Auth Hook) |
| 1.6 — User onboarding | ⏸️ Ready | Depende de 1.5 |
| 1.7 — Observability EU | 🟡 Ready | Bloqueada por config externa (Sentry EU + Grafana Cloud EU) |

Detalhe completo em [`docs/stories/active/_INDEX.md`](docs/stories/active/_INDEX.md).

---

## Stack

| Camada | Tecnologia | Notas |
|--------|------------|-------|
| Frontend | Next.js 15 (App Router) + React 19 + TypeScript | RSC + Server Actions |
| Database | Postgres 16 + Drizzle ORM | Multi-tenant via Row-Level Security |
| Auth | Supabase Auth (region `eu-central-1`) | JWT custom claim `household_id` |
| AI | Anthropic Claude Sonnet + OpenAI GPT-4o-mini | Multi-intent pipeline (Epic 2) |
| Pagamentos | Stripe (cartão + Multibanco + MB Way) | EUR único |
| Email | Resend | Transactional |
| Background jobs | Inngest (region EU) | Recurrences, GDPR purge, Stripe retry |
| Observability | Sentry EU + Grafana Cloud EU + OpenTelemetry | Data residency UE |
| Hosting | Vercel `fra1` (Frankfurt) | EU obrigatório |
| Testing | Vitest + Testcontainers Postgres 16 | 86 testes RLS contra DB efémera |

---

## Comandos comuns

Tudo a partir da raiz do repo. Detalhe completo em [`CLAUDE.md`](CLAUDE.md).

### Desenvolvimento

```bash
pnpm install                       # instala dependências (frozen-lockfile em CI)
pnpm dev                           # arranca dev de todos os packages
pnpm --filter @meu-jarvis/web dev  # só Next.js em http://localhost:3000
```

### Quality gates (têm de passar pre-merge)

```bash
pnpm lint        # ESLint (--max-warnings=0)
pnpm typecheck   # TypeScript strict
pnpm test        # Vitest em todos os packages
pnpm build       # next build + builds dos packages
pnpm check:rls   # RLS Coverage Gate (NFR5) — falha CI se faltar policy
```

### Database

```bash
pnpm --filter @meu-jarvis/db db:generate   # drizzle-kit generate
pnpm --filter @meu-jarvis/db db:migrate    # apply-migrations.ts (idempotente)
pnpm --filter @meu-jarvis/db db:seed       # categorias PT default
pnpm --filter @meu-jarvis/db db:studio     # Drizzle Studio UI
```

### Testes RLS (Story 1.4)

```bash
pnpm --filter @meu-jarvis/db-test test     # 86 testes contra Postgres efémero (~8s)
```

---

## Estrutura do monorepo

```
expressia/                               # nome do repo GitHub
└── meu-jarvis/                          # codename interno (pasta local + packages)
    ├── apps/
    │   └── web/                         # @meu-jarvis/web — Next.js 15 (porta 3000)
    ├── packages/
    │   ├── db/                          # @meu-jarvis/db — schema Drizzle + migrations
    │   └── db-test/                     # @meu-jarvis/db-test — suite RLS Testcontainers
    ├── docs/
    │   ├── prd.md                       # Product Requirements (v1.1)
    │   ├── architecture.md              # Source-of-truth arquitectura
    │   ├── db-schema.md                 # Schema lógico + RLS pattern
    │   ├── stories/active/              # Stories AIOX em desenvolvimento
    │   ├── stories/completed/           # Stories Done arquivadas
    │   ├── handoffs/                    # Handoffs cross-terminal entre agentes
    │   ├── qa/gates/                    # QA gate decisions (PASS/CONCERNS/FAIL)
    │   └── runbooks/                    # CI setup, Supabase setup, etc.
    ├── scripts/
    │   └── check-rls-coverage.ts        # Gate NFR5 — verificação automática
    ├── .aiox-core/                      # Framework AIOX (read-only — protegido)
    └── .github/workflows/               # CI: quality + rls-gate + build
```

> **Nota:** o codename `meu-jarvis` aparece em paths internos (pasta local, package names `@meu-jarvis/*`). A marca pública é **Expressia**. Esta divergência é intencional e está documentada em [`CLAUDE.md`](CLAUDE.md).

---

## Documentação

| Documento | Descrição |
|-----------|-----------|
| [`docs/prd.md`](docs/prd.md) | Product Requirements (v1.1, MVP Fase 1) |
| [`docs/project-brief.md`](docs/project-brief.md) | Brief estratégico, mercado, pricing |
| [`docs/architecture.md`](docs/architecture.md) | Arquitectura — multi-tenancy, AI pipeline, integrações |
| [`docs/db-schema.md`](docs/db-schema.md) | Schema lógico + RLS pattern canónico |
| [`docs/stories/active/_INDEX.md`](docs/stories/active/_INDEX.md) | Índice da Epic 1 (Foundation) |
| [`docs/HANDOFF-INDEX.md`](docs/HANDOFF-INDEX.md) | Handoffs activos entre agentes/sessões |
| [`docs/runbooks/`](docs/runbooks/) | Runbooks operacionais (CI, Supabase, etc.) |
| [`CLAUDE.md`](CLAUDE.md) | Guidance para Claude Code + convenções de código |

---

## Identidade

| Item | Valor |
|------|-------|
| Marca pública | **Expressia** |
| Codename interno | `meu-jarvis` (repo path + package names) |
| Domínio | `expressia.pt` |
| Mercado | **PT-PT exclusivo** (Portugal continental). Nunca PT-BR, CPLP, lusófono global ou multi-país |
| Moeda | EUR único, formato PT-PT (`€8,88`, `€1.234,56`, vírgula decimal) |
| Data residency | UE obrigatória — Vercel `fra1` + Supabase `eu-central-1` + Inngest EU + Sentry EU + Grafana EU |
| Pricing hero | Família €8,88/mês (tier diferenciador) |
| Concorrente directo | Néctar (BR) — mas reposicionado para Portugal |

---

## Arquitectura — destaques

### Multi-tenancy via Postgres RLS (constraint inegociável — NFR5)

Toda a tabela de domínio tem `household_id uuid not null` + 4 RLS policies (`select`/`insert`/`update`/`delete`). Cross-household access é bloqueado pelo Postgres, **não pela aplicação**. A app apenas escolhe entre `getDb()` (role `authenticated`, RLS aplicada via JWT) e `getServiceDb()` (role `service_role`, ignora RLS — usar APENAS em jobs controlados).

### RLS Coverage Gate (bloqueia merge)

`scripts/check-rls-coverage.ts` faz parse do schema Drizzle, detecta tabelas com `household_id`, e exige 4 policies (SELECT/INSERT/UPDATE/DELETE) na migration `0001_rls_policies.sql`. Adicionar uma tabela com `household_id` sem as 4 policies parte o build.

### Testcontainers para testes RLS (Story 1.4)

Cada teste arranca um Postgres 16 efémero, aplica todas as migrations, executa o cenário (cross-household, deny by default, etc.), e descarta. 86 testes correm em ~8s.

---

## Contribuir

Este projecto segue o framework [AIOX](.aiox-core/) (Agile Intelligent Orchestration eXperience), com workflow Story Development Cycle (`@sm` cria → `@po` valida → `@dev` implementa → `@qa` quality gate → `@devops` push).

Stories activas vivem em `docs/stories/active/`. Convenções de código, comandos e regras detalhadas em [`CLAUDE.md`](CLAUDE.md).

---

## Licença

Distribuído sob a licença **GNU Affero General Public License v3.0 (AGPL-3.0)** — ver [`LICENSE`](LICENSE) para o texto completo.

A escolha da AGPL é deliberada: protege o projecto contra clones SaaS comerciais sem reciprocidade. Forks que ofereçam o software em rede (incluindo SaaS) são obrigados a publicar o seu código-fonte modificado sob a mesma licença.

**Copyright © 2026 Eurico J. Silva Alves** — `<euricojsalves@gmail.com>`
