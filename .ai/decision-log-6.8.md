# Decision Log: Story 6.8 — Export GDPR

**Generated:** 2026-06-18
**Agent:** dev (Dex)
**Mode:** YOLO (Autonomous Development)
**Story:** docs/stories/active/6.8.export-gdpr.story.md

---

## Context

Implementação do direito de portabilidade GDPR Art. 20 (FR28): endpoint `POST /api/conta/export`
gera ZIP (JSON + CSV) de todos os dados de domínio do household, faz upload para Supabase Storage
(bucket privado `exports`) e devolve signed URL 24h. Geração síncrona/inline (PO-D1). Endpoint
`GET /api/conta/export/[jobId]` para polling/expiração. Página `/conta/dados`.

Bloqueador externo: bucket `exports` no Supabase Storage ainda não existe (acção [EURICO]).
Todo o código é implementado; a verificação E2E live (T4.6 live) fica deferida.

---

## Decisões Made

### D-6.8.1 — `archiver@7.0.1` adicionado como dependência directa de `apps/web`

**Type:** library-choice · **Priority:** high

A story afirma que `archiver@7.0.1` "já está no lockfile — usa directamente". Verificação real:
`archiver@7.0.1` está no `pnpm-lock.yaml` MAS apenas como dependência TRANSITIVA de
`testcontainers` (devDependency de `packages/db-test`). NÃO é dependência directa de nenhum
package e NÃO é resolúvel a partir de `apps/web` (`apps/web/node_modules/archiver` não existe;
pnpm isola node_modules estritamente). Importá-lo a partir de `apps/web` sem o declarar quebraria
em runtime.

**Decisão:** adicionar `"archiver": "7.0.1"` (versão exacta já no lockfile, zero nova versão) +
`"@types/archiver"` (devDep) a `apps/web/package.json`. Mantém a intenção da story (usar archiver
directamente, sem nova versão) e torna-o resolúvel.

**Alternativas rejeitadas:**
- Serializar ZIP à mão (zip store sem compressão) — reinventar a roda; archiver já no lockfile.
- Usar `jszip` — nova dependência não aprovada, contra a story.

### D-6.8.2 — Client Supabase Storage service-role via `@supabase/supabase-js` (`createClient`)

**Type:** architecture · **Priority:** high

A integração Storage é construção nova (zero `.storage`/`createSignedUrl` em apps/web). Uso de
`createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession:false }})`
— o service-role key é necessário para escrever no bucket privado (Admin API). Isolado num helper
`apps/web/src/lib/gdpr/storage.ts` com guard JSDoc no espírito do SEC-10 (`getServiceDb`).
Precedente de uso service-role app-level documentado: D-12C + CLAUDE.md §Multi-tenancy.

**Alternativas rejeitadas:**
- Usar o pooler Postgres para Storage — Storage é API HTTP, não SQL; não aplicável.

### D-6.8.3 — Verificação app-level de pertença antes de cada `getServiceDb()` write

**Type:** security · **Priority:** high

A policy `data_export_jobs_update_blocked` (`using(false)`) bloqueia UPDATE via `authenticated`,
logo todos os UPDATEs de status usam `getServiceDb()` (ignora RLS). Antes de cada write
service-role confirmo `job.household_id === auth.householdId` (defesa em profundidade, precedente
D-12C). O INSERT inicial e todos os SELECTs de domínio usam `getDb()` (RLS / app-enforced).

### D-6.8.4 — Geração inline com tratamento de falha → status `failed`

**Type:** algorithm · **Priority:** medium

Geração síncrona (PO-D1). Se a geração/upload falhar, o job é marcado `status='failed'` via
`getServiceDb()` e o endpoint devolve 500 com mensagem genérica PT-PT (sem expor erro interno).
Garante que nunca fica um job preso em `generating`.

### D-6.8.5 — `withHousehold` vs `getDb()` para SELECTs de domínio

**Type:** architecture · **Priority:** medium

A story manda "todo o SELECT via `getDb()` (RLS por JWT)". O codebase usa `withHousehold` (2.ª rede
RLS, SEC-2+) para leituras de domínio nos endpoints recentes. Uso `withHousehold` para o SELECT do
job (verificação de pertença + leitura RLS-enforced) E para a recolha de dados de domínio no
`generate-export.ts` — alinhado com a 2.ª rede RLS activa e com a intenção AC8 (RLS enforced).
O filtro `household_id` app-enforced (1.ª rede SEC-1) é mantido em todas as queries.

---

## Tabelas exportadas (AC3)

households, household_members, household_invites, kanban_columns, tasks, task_recurrences, tags,
task_tags, accounts, cards, categories (per-household), transactions, recurrences (finance),
installments, user_prefs (do utilizador), audit_log (sem ip/user_agent).

Excluídas (billing CONGELADO): subscriptions, invoices, payment_methods, feature_flags.

---

## Subtask deferida

- **T4.6 live (verificação E2E em produção contra o bucket real `exports`)** — DEFERIDA.
  Bloqueador externo: o bucket `exports` no Supabase Storage ainda não existe (acção [EURICO]).
  O código de upload + signed URL está implementado e testado com MOCK de Storage. A validação
  contra o bucket real só pode correr depois de o Eurico criar o bucket.
