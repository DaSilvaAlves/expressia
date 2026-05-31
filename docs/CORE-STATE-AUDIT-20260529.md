# Auditoria de Estado Real — Expressia (meu-jarvis)

**Data:** 29/05/2026
**Autor:** @architect (Aria) — brownfield/health assessment
**Origem:** handoff `mj-handoff-refocus-core-freeze-billing-20260529.yaml` (follow-up CORE-STATE-AUDIT, CRITICAL)
**Método:** inspecção do código + configuração + boot real do dev server + sondagem de endpoints. Sem assumir status "Done".

---

## Veredicto em uma frase

O problema **não é falta de código** — a superfície core está construída, compila, arranca e está ligada. O problema é **configuração externa por fazer** + **fluxos E2E nunca exercitados com dados reais**. A hipótese central do handoff confirma-se com evidência: *"Done no papel" passou gates com mocks; o runtime depende de integrações externas que nunca foram provisionadas.*

---

## O que foi TESTADO (evidência directa)

### 1. A app arranca
`pnpm --filter @meu-jarvis/web dev` → **Next.js 15.5.15 "Ready in 11s"**, `.env.local` carregado. Sem erro de boot.

### 2. As rotas respondem e a auth protege (runtime real)

| Rota | HTTP | Conclusão |
|------|------|-----------|
| `GET /` | 200 | Landing serve |
| `GET /entrar` | 200 | Login serve |
| `GET /visao` | 307 | Middleware redirige não-autenticado → **auth gate funciona** |
| `GET /jarvis` | 307 | Idem (protegido) |
| `GET /api/me` | 401 | Auth + Supabase alcançável |
| `GET /api/visao/tarefas-hoje` | 401 | Auth gate funciona |
| `POST /api/agent/prompt` | 401 | Envelope de erro JSON limpo (não crash) |

**→ Refuta "nada conecta com nada" ao nível de plumbing.** A app está integrada: serve páginas, protege rotas, as APIs exigem sessão.

### 3. Superfície construída (não é "futuro")
- **9 packages reais:** `agent`, `auth`, `classifier`, `db`, `db-test`, `observability`, `planner-executor`, `tools`, `ui`.
- **Cérebro AI completo:** `/api/agent/prompt` orquestra Classifier → Planner → Executor com idempotency, rate-limit, quota, cache, audit log, preview-then-confirm (FR4) e undo 30s (FR6). Código sofisticado e contractual.
- **CRUD completo:** `/api/financas/*` (cartões, categorias, contas, prestações, recorrências, transacções), `/api/tasks/*`, `/api/kanban-columns`, `/api/tags`, `/api/recurrences`, `/api/visao/*` (7 endpoints).
- **UI completa:** `/visao`, `/jarvis`, `/tarefas` (+kanban/calendário), `/financas` (+5 sub-páginas), `/conta/preferencias`, auth (`registar`/`entrar`/`confirm`/`recuperar`).
- **Supabase REALMENTE configurado:** projecto `expressia-prod` (eu-west-1), chaves publishable/secret/JWT + `DATABASE_URL` reais nos dois `.env.local`.

---

## Mito vs Realidade (hipóteses do handoff verificadas)

| Hipótese do handoff | Veredicto | Evidência |
|---------------------|-----------|-----------|
| "Não está nem a 50%, falta mais de metade do código" | **PARCIALMENTE FALSO** | Epics 1-5 substancialmente construídos, ligados e a servir. O que falta não é código — é config + verificação E2E. |
| "Nada conecta com nada" | **FALSO ao nível plumbing** | App arranca, auth protege, APIs respondem com contratos correctos. |
| "Suite Testcontainers da Story 1.4 nunca foi entregue" | **FALSO (existe) / NÃO VERIFICÁVEL agora** | `docs/stories/completed/1.4.rls-helpers-test-suite.md` + `packages/db-test` (rls-harness, harness, setup, tests) existem. MAS **Docker está parado** → suite nunca corre localmente; provavelmente nunca foi exercitada. |
| "Muitos Done dependem de config externa nunca feita" | **CONFIRMADO** | Ver gaps abaixo — chaves LLM, Resend, Inngest, service-role DB URL todas em falta. |

---

## GAPS REAIS (com evidência) — por ordem de impacto

### 🔴 GAP-1 — Chat AI (cérebro multi-intent) NÃO funciona: sem chaves LLM
- **Evidência:** `apps/web/src/app/api/agent/prompt/route.ts:719` lê `process.env.OPENAI_API_KEY ?? 'unset'` (Classifier). Executor usa `ANTHROPIC_API_KEY` em `packages/agent/src/providers/anthropic.ts`. **Nenhuma das duas existe** — nem em `.env.local`, nem no env de sistema (confirmado).
- **Sintoma:** qualquer prompt no `/jarvis` → chamada LLM falha auth → `ClassifierError` → HTTP 400 ao utilizador.
- **Impacto:** a feature âncora do produto está morta sem 2 chaves.

### 🔴 GAP-2 — Registo/confirmação de email não envia: sem Resend
- **Evidência:** `RESEND_API_KEY` em falta no `.env.local`. `.env.example` lista-a (linha 55).
- **Sintoma:** fluxo `registar → confirmar email` não consegue enviar o email de confirmação. Bloqueia a entrada de qualquer utilizador novo (E2E de auth).
- **Dependência adicional:** Supabase Dashboard precisa de "Confirm email" + Auth Hook (`household_id` no JWT — migration 0002) confirmados. **Não verificável sem acesso ao Dashboard.**

### 🟠 GAP-3 — Caminho service-role morto: sem `DATABASE_URL_SERVICE_ROLE`
- **Evidência:** `getServiceDb()` em `packages/db/src/client.ts:71` lê `DATABASE_URL_SERVICE_ROLE ?? SUPABASE_DB_URL`. **Nenhuma das duas no `apps/web/.env.local`** (tem `SUPABASE_SERVICE_ROLE_KEY` = JWT, que é coisa diferente).
- **Sintoma:** jobs Inngest (recorrências, GDPR purge, cleanup reverse-ops), quota increment e qualquer RLS-bypass falham em runtime. `getDb()` autenticado funciona (tem `DATABASE_URL`).

### 🟠 GAP-4 — Background jobs mortos: sem Inngest
- **Evidência:** `INNGEST_EVENT_KEY` + `INNGEST_SIGNING_KEY` em falta. `/api/inngest` existe.
- **Sintoma:** recorrências de tarefas/finanças e prestações não disparam automaticamente.

### 🟡 GAP-5 — Integração E2E nunca exercitada com Docker
- **Evidência:** `docker info` → **DOCKER PARADO**. A suite RLS/Testcontainers (db-test) precisa de Postgres real em container.
- **Sintoma:** toda a "integração testada" foi com mocks. A integração real (RLS no Postgres, atomicidade, reverse_ops) nunca correu localmente. Não temos prova de que funciona — só de que compila.

### 🟢 Degradam com graça (não bloqueiam core, mas notar)
- `UPSTASH_REDIS_*` em falta → cache off (código degrada sem throw — confirmado nos comentários da route).
- `SENTRY_DSN` em falta → observabilidade off. Avisos no boot: `sentry.server/edge.config.ts` deviam migrar para `instrumentation.ts` (Next 15). Tech debt menor.
- Aviso de lockfile: existe `C:\Users\XPS\package-lock.json` stray que confunde o root-detection do Next (escolhe root errado). Definir `outputFileTracingRoot` ou remover o lockfile órfão.

---

## O que NÃO foi possível exercitar (honestidade)

O fluxo E2E completo (`registar → confirmar → entrar → criar tarefa → criar finança → chat AI → /visão com dados reais`) **não foi exercitado** porque exige:
1. Sessão autenticada real (browser interactivo + confirm email funcional → bloqueado por GAP-2).
2. Chaves LLM para o chat (bloqueado por GAP-1).
3. Possivelmente config no Supabase Dashboard (Auth Hook + Confirm email) que não é verificável por código.

Tudo o que está atrás de `401`/`307` (CRUD com dados reais, /visão preenchida) fica por confirmar até existir uma sessão. **Esse é o próximo teste, depois de resolver GAP-1/2.**

---

## Plano MAKE-IT-WORK (priorizado pelo que impede o produto de funcionar)

### Fase 0 — Provisionar config externa (BLOQUEIA TUDO; só o Eurico pode fazer)
Sem isto, nenhum teste E2E é possível. Acção do Eurico (não é código):
1. **`OPENAI_API_KEY`** (Classifier) + **`ANTHROPIC_API_KEY`** (Executor) → desbloqueia chat AI.
2. **`RESEND_API_KEY`** + confirmar no **Supabase Dashboard**: "Confirm email" ON + Auth Hook que injecta `household_id` no JWT (migration 0002) → desbloqueia registo/login.
3. **`DATABASE_URL_SERVICE_ROLE`** (= `DIRECT_URL`, porta 5432) no `apps/web/.env.local` → desbloqueia jobs/quota.
4. **`INNGEST_EVENT_KEY` + `INNGEST_SIGNING_KEY`** → desbloqueia recorrências.
5. (Opcional p/ paridade prod) `UPSTASH_REDIS_*`, `SENTRY_DSN`.

### Fase 1 — Smoke test E2E manual (com Eurico, depois da Fase 0)
Correr o fluxo real no browser e **documentar o que quebra de facto** com dados reais: registar → confirmar → entrar → criar tarefa → criar finança → prompt no /jarvis → ver /visão. Esta é a verdade que falta — só observável com config feita.

### Fase 2 — Ligar Docker + correr a suite de integração real
`docker` up → correr a suite RLS/Testcontainers (db-test) + benchmark E2E (Story 2.10). Primeira prova real de que RLS/atomicidade/undo funcionam contra Postgres, não mocks.

### Fase 3 — Corrigir os bugs reais encontrados na Fase 1/2
Backlog data-driven a partir de evidência, não de suposição. Aqui entram os "nada conecta" que sobrarem depois da config.

### Fase 4 — Higiene
Migrar Sentry para `instrumentation.ts`; resolver lockfile stray / `outputFileTracingRoot`; `typedRoutes` movido de `experimental`.

> **Billing (Epic 6: 6.3-6.6, 6.10 + Stripe) permanece CONGELADO** até Fases 0-3 darem um produto demonstrável.

---

## Conclusão para o Eurico

A tua intuição ("nada conecta") está **certa na experiência, errada na causa**. Não é código em falta — é que o produto **nunca foi ligado às tripas externas** (LLM, email, jobs, service-role DB) e **nunca foi exercitado E2E com dados reais**. Os gates verdes provaram que compila com mocks; nunca provaram que funciona ligado.

**O primeiro passo não é meu nem do @dev — é teu:** provisionar as ~5 chaves/configs da Fase 0. Sem elas, qualquer "make it work" bate na mesma parede. Assim que as tiveres, fazemos o smoke test E2E juntos e o backlog de bugs passa a ser real.
