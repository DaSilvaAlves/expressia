# Runbook — Inngest setup (EU Frankfurt)

**Owner:** @devops (Eurico-side)
**Quando executar:** uma vez, antes do `@devops *push` da Story 2.8.
**Pré-requisitos:** acesso ao Vercel (projecto `expressia`) + email para criar conta Inngest.

Story 2.8 introduz Inngest como provider de background jobs (cron + event-driven).
A primeira função registada é `cleanup-expired-reverse-ops` (cron diário 03:00 UTC).
Sem este runbook completado em prod, o endpoint `/api/inngest` arranca mas as
funções nunca são executadas (Inngest Cloud não chama o endpoint sem registo).

---

## Step 1 — Criar workspace Inngest EU Frankfurt

1. Aceder a https://app.inngest.com e criar conta (ou login com email do Eurico).
2. Ao criar workspace, no selector de region escolher **EU (Frankfurt)** —
   alinhado com `data residency` Vercel `fra1` + Supabase `eu-central-1`
   (CLAUDE.md identidade do projecto).
3. Nomear o workspace `expressia-prod` (sugestão).
4. Criar workspace adicional `expressia-dev` para preview deploys + dev local.

**Verificação:** o dashboard Inngest mostra os dois workspaces e o region badge
indica "EU (Frankfurt)" em ambos.

---

## Step 2 — Gerar Event Key e Signing Key

Para cada workspace (`expressia-prod` e `expressia-dev`):

1. No dashboard Inngest, ir a **Settings → Event Keys**.
2. Em **Production**, copiar a `Event Key` (formato `events.inngest.com/...`).
3. Em **Settings → Signing Keys**, copiar a `Signing Key` (formato
   `signkey-prod-...` ou `signkey-dev-...`).
4. Guardar ambas as keys num gestor de secrets (1Password, Vault, etc.) —
   **NUNCA** comitar a credenciais ao repo.

---

## Step 3 — Registar endpoint `/api/inngest`

No dashboard Inngest, ir a **Apps → Add app → Sync**:

| Workspace | URL |
|-----------|-----|
| `expressia-prod` | `https://expressia.pt/api/inngest` |
| `expressia-dev` | `https://<vercel-preview-branch>.vercel.app/api/inngest` |

Inngest faz uma chamada `PUT` ao endpoint para introspecção das funções
registadas. Após sync bem-sucedido, o dashboard mostra `cleanup-expired-reverse-ops`
como função activa com o cron `0 3 * * *`.

---

## Step 4 — Popular Vercel secrets

Em https://vercel.com/<team>/expressia/settings/environment-variables, adicionar:

| Variável | Valor | Scopes |
|----------|-------|--------|
| `INNGEST_EVENT_KEY` | (event key de `expressia-prod`) | Production |
| `INNGEST_SIGNING_KEY` | (signing key de `expressia-prod`) | Production |
| `INNGEST_EVENT_KEY` | (event key de `expressia-dev`) | Preview + Development |
| `INNGEST_SIGNING_KEY` | (signing key de `expressia-dev`) | Preview + Development |

**Redeploy obrigatório** após adicionar secrets para que o runtime Next.js as
veja (`Settings → Deployments → Redeploy last`).

---

## Step 5 — Dev local

Para desenvolvimento local, não é necessário Inngest Cloud. O CLI
`inngest-cli` cria um engine local + dashboard:

```bash
# Numa shell separada, com `apps/web` a correr em http://localhost:3000:
npx inngest-cli@latest dev -u http://localhost:3000/api/inngest
```

O dashboard fica acessível em http://localhost:8288. O CLI auto-descobre o
endpoint `/api/inngest` e regista as funções (incluindo cron schedules).

**Tests Vitest NÃO precisam do CLI** — usam `vi.mock('@/lib/inngest/client')`
para mockar completamente o SDK (D43: zero CI infra extra).

---

## Step 6 — Smoke test cron

1. No dashboard Inngest (`expressia-prod`), ir a **Functions → cleanup-expired-reverse-ops**.
2. Clicar em **Invoke** (botão top-right) para disparar manualmente a função.
3. Verificar o **Runs** tab: deve aparecer uma run com status `Completed` e o
   `Output` `{ rows_deleted: 0 }` (ou `> 0` se houver rows expiradas).
4. Verificar em Pino logs (Grafana Cloud ou Vercel Logs): `cleanup expired
   reverse ops completo` com `rows_deleted: N`.

Após smoke test PASS, a função cron começa a executar automaticamente todos
os dias às 03:00 UTC.

---

## Failure modes & recovery

| Sintoma | Causa provável | Fix |
|---------|---------------|-----|
| Sync falha com 401 | Signing key inválida ou em falta | Re-popular `INNGEST_SIGNING_KEY` no Vercel + redeploy |
| Função não aparece no dashboard | Endpoint não acessível publicamente | Verificar middleware `APP_PATH_PREFIXES` NÃO inclui `/api/inngest` |
| Runs ficam pending | Workspace em region errada | Verificar workspace é "EU (Frankfurt)" — Vercel `fra1` não consegue chamar US |
| Cron não dispara | Function paused no dashboard | Resumir manualmente em Functions → ... → Resume |

---

## Trace

- Architecture §11.3 (Inngest como background-jobs provider)
- ADR-005 §14.5 (decisão Inngest EU vs Trigger.dev)
- Story 2.8 AC4 + T5 + EB4 deferred
- CLAUDE.md identidade do projecto (data residency EU obrigatória)
