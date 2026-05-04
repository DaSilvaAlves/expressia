# Runbook — Configuração da CI/CD GitHub Actions (Story 1.2)

**Workflow:** `.github/workflows/ci.yaml`
**Story de origem:** `docs/stories/active/1.2.ci-pipeline-quality-gates.md`
**Trace:** PRD NFR5 / NFR8 / NFR17, Architecture §11.4, Epic 1 AC1 (< 5 min).

Este runbook descreve como **configurar branch protection**, **adicionar secrets** e **validar** a pipeline CI no GitHub depois do `ci.yaml` ser merged.

---

## 1. Visão geral da pipeline

A pipeline corre em todos os `pull_request` e em `push` para `main`. Tem três jobs:

| Job | Propósito | Service container | Depende de | Tempo alvo |
|-----|-----------|-------------------|------------|------------|
| `quality` | Lint, typecheck, testes unitários (Vitest) | — | — | < 2 min |
| `rls-gate` | Aplica migrations Drizzle num Postgres 16 efémero e valida cobertura RLS (NFR5) | `postgres:16` | — | < 2 min |
| `build` | Compila o Next.js em modo produção | — | `quality` | < 2 min |

`quality` e `rls-gate` correm em **paralelo**. `build` espera por `quality` (decisão consciente — AC5 "onde possível"; evita gastar minutos de CI quando lint/typecheck/test falham). `build` corre em paralelo com `rls-gate` quando `quality` passa primeiro.

Cancelamento automático: runs anteriores no mesmo branch são cancelados via `concurrency: cancel-in-progress: true`.

---

## 2. Secrets necessários (NFR8)

Todos os valores entram em **Settings → Secrets and variables → Actions → New repository secret**. Nunca em código (`${{ secrets.X }}` no YAML é a única forma).

| Secret | Usado em | Necessário para | Como obter |
|--------|----------|-----------------|------------|
| `NEXT_PUBLIC_SUPABASE_URL` | job `build` | Build do Next.js sem warnings de env var ausente | Supabase Dashboard → Project Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | job `build` | Build do Next.js sem warnings de env var ausente | Supabase Dashboard → Project Settings → API → anon public |

Os restantes secrets (`ANTHROPIC_API_KEY`, `STRIPE_*`, `OPENAI_API_KEY`) **NÃO** são necessários nesta story — entram em stories posteriores quando os respectivos jobs forem adicionados (por exemplo, `llm-bench`, `integration` com Stripe webhook).

### Procedimento (uma vez por repo)

1. Ir a `https://github.com/<owner>/<repo>/settings/secrets/actions`.
2. Clicar em **New repository secret**.
3. Adicionar cada secret da tabela acima com o valor correcto.
4. Não adicionar valores reais a este runbook nem a nenhum ficheiro do repo.

---

## 3. Branch protection rules (AC10, NFR17)

A pipeline só é **bloqueante** se a branch protection rule do `main` exigir os jobs como required status checks. Sem isto, qualquer merge pode passar sem CI verde.

### Procedimento

1. **Settings → Branches → Add branch protection rule**.
2. **Branch name pattern:** `main`.
3. Activar:
   - [x] **Require a pull request before merging**
     - [x] Require approvals: **1** (recomendado para MVP; subir para 2 quando equipa crescer)
     - [x] Dismiss stale pull request approvals when new commits are pushed
   - [x] **Require status checks to pass before merging**
     - [x] **Require branches to be up to date before merging**
     - **Status checks que devem passar (procurar e adicionar):**
       - `Quality (lint + typecheck + test)`
       - `RLS Coverage Gate (NFR5)`
       - `Build Next.js`
   - [x] **Require conversation resolution before merging**
   - [x] **Restrict who can push to matching branches** (apenas owners e `@devops`)
   - [x] **Do not allow bypassing the above settings** (importante — sem isto, owners conseguem dar push directo)
4. **Save changes**.

### Nota sobre nomes dos status checks

Os nomes que aparecem em "Require status checks" só ficam disponíveis depois de a pipeline ter corrido **pelo menos uma vez** num PR ou push. Sequência recomendada:

1. Merge do PR que introduz `ci.yaml` (story 1.2).
2. Aguardar a primeira run completa.
3. Voltar a Branch protection e adicionar os 3 jobs como required.

---

## 4. Validação manual da pipeline

Depois de configurar secrets e branch protection, validar manualmente que a pipeline funciona como esperado.

### 4.1 Smoke test (PR limpo)

1. Criar branch `chore/ci-smoke-test`.
2. Fazer alteração trivial (ex: edit em `README.md`).
3. Abrir PR contra `main`.
4. Confirmar que os 3 jobs aparecem em "Checks" e ficam verdes.
5. Confirmar tempo total < 5 min (Epic 1 AC1).

### 4.2 Negative test — RLS gate bloqueia merge sem coverage

Validar manualmente que o gate RLS falha quando uma tabela com `household_id` é adicionada sem policies (NFR5).

1. Criar branch `chore/test-rls-gate-fail`.
2. Em `packages/db/src/schema/finance.ts` (ou outro), criar tabela mock:
   ```ts
   export const _testRlsGate = pgTable('_test_rls_gate', {
     id: uuid('id').primaryKey(),
     householdId: uuid('household_id').notNull(),
   });
   ```
3. **NÃO adicionar policies** em `packages/db/migrations/0001_rls_policies.sql`.
4. Push e abrir PR.
5. Esperado: job `rls-gate` falha com `❌ RLS coverage incompleto — merge bloqueado` e `_test_rls_gate` na lista de tabelas em falta.
6. Reverter o branch (não merge).

Este teste valida o DoD da story 1.2: "Job `rls-gate` ... falha quando RLS coverage está incompleta".

### 4.3 Negative test — quality bloqueia merge

1. Criar branch `chore/test-quality-fail`.
2. Em qualquer `.ts`, introduzir erro de lint deliberado (ex: `var x = 1` num ficheiro com `no-var`).
3. Push e abrir PR.
4. Esperado: job `quality` falha no step `pnpm lint` e bloqueia merge.
5. Reverter.

---

## 5. Variáveis de ambiente do job `rls-gate`

O job usa um Postgres 16 local efémero (service container). **Não usa credenciais Supabase reais** — é um container isolado por run.

```yaml
env:
  DATABASE_URL: postgresql://test:test@localhost:5432/testdb
```

Esta separação é intencional:

- O gate RLS testa a **estrutura SQL** (existência de policies para SELECT/INSERT/UPDATE/DELETE em todas as tabelas com `household_id`).
- Não testa contra Supabase prod (esse cenário entrará em jobs futuros como `integration` ou `e2e` com Supabase branch DB).
- Drift entre Postgres 16 do CI e versão Supabase prod: aceitável neste gate porque ambos são Postgres 16.x; quaisquer divergências de extensions Supabase-specific (`auth`, `realtime`, etc.) ficam fora do scope porque o `tablesFilter: ['!auth.*']` em `drizzle.config.ts` já exclui o schema Supabase.

---

## 6. Performance e custo (AC6)

| Optimização | Estado |
|-------------|--------|
| Cache pnpm via `actions/setup-node@v4` (`cache: 'pnpm'`) | Activo |
| Cache adicional `~/.local/share/pnpm/store` via `actions/cache@v4` | Activo |
| `concurrency: cancel-in-progress: true` em PRs | Activo |
| `timeout-minutes` por job (10 / 8 / 10) | Activo |
| `permissions: contents: read` (least privilege) | Activo |
| Turbo cache remoto | **Não activado nesta story** — opcional para stories futuras se tempo > 5 min |

**Tempo alvo:** < 5 min total (Epic 1 AC1). Medir em primeira run real e ajustar se necessário (ver Task 5.2 da story).

Em runners free-tier GitHub Actions, jobs paralelos competem por slots — em horas de pico pode haver fila. Se isto se tornar problema, considerar:
- Turbo Cache remoto (`TURBO_TOKEN` + `TURBO_TEAM`).
- Self-hosted runners (apenas se custo justificar).

---

## 7. Troubleshooting

### `pnpm install --frozen-lockfile` falha em CI mas passa local

- Verificar que `pnpm-lock.yaml` está commitado e actualizado.
- Verificar que `packageManager` em `package.json` raiz está pinado em `pnpm@9.12.3` (alinhado com `PNPM_VERSION` no workflow).

### Job `rls-gate` não consegue conectar ao Postgres

- Confirmar que `services.postgres.options` tem o healthcheck (`pg_isready`).
- O step "Aguardar Postgres ready" tem retry de 30 × 2s = 60s — suficiente para cold-start da imagem.

### Job `build` falha por `NEXT_PUBLIC_SUPABASE_URL` undefined

- Confirmar que os secrets foram adicionados em **Settings → Secrets and variables → Actions** (não em Environments — diferente).
- Em forks/PRs externos, secrets de `repository` não são passados — esperado e seguro.

### Pipeline > 5 min

1. Activar Turbo Cache remoto.
2. Splittar job `quality` em 3 jobs paralelos (lint, typecheck, test).
3. Adicionar matrix se chegar mais runtime.

---

## 8. Manutenção

| Quando | Acção |
|--------|-------|
| Bump pnpm (ex: 9.12.3 → 9.13.x) | Editar `PNPM_VERSION` em `ci.yaml` + `packageManager` em `package.json` raiz. |
| Bump Node (ex: 20 → 22) | Editar `NODE_VERSION` em `ci.yaml` + `engines.node` em `package.json` raiz + `apps/web/package.json` + `packages/db/package.json`. |
| Bump Postgres (ex: 16 → 17) | Editar `services.postgres.image` em `ci.yaml` + alinhar com Supabase prod version. |
| Adicionar novo job (integration, e2e, llm-bench) | Stories futuras; seguir o mesmo padrão de cache + checkout + setup. |
| Adicionar `coderabbit-review` job | Quando `coderabbit_integration` for activado em `core-config.yaml` (story dedicada). |

---

## 9. Próximos passos (fora do scope da Story 1.2)

- **Story 1.3:** depende deste gate RLS funcional para validar próximas migrations.
- **Stories futuras de Epic 1:** adicionar jobs `integration` (Postgres + Redis), `e2e` (Playwright em preview deploy), `llm-bench` (nightly).
- **Tech debt da Story 1.1 (MNT-001/MNT-002):** `experimental.typedRoutes` e `outputFileTracingRoot` em `next.config.ts` — ficam fora desta story (Article IV — No Invention) e serão tratados em story dedicada de tech debt ou rolados para Story 1.4.

---

## 10. Referências

- `docs/architecture.md` §11.4 — CI/CD Pipeline (esquema canónico)
- `docs/prd.md` NFR5 (RLS gate bloqueante), NFR8 (secrets), NFR17 (quality gates)
- `docs/stories/active/1.2.ci-pipeline-quality-gates.md` (story origem)
- `docs/qa/gates/1.2-po-gate.md` (validação PO 9/10 GO Conditional)
- GitHub Actions docs: https://docs.github.com/en/actions
