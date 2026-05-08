# Runbook — Observabilidade Expressia (Story 1.7)

**Story de origem:** `docs/stories/active/1.7.observability-otel-sentry.md`
**Trace:** PRD NFR4 / NFR12 / NFR13 / NFR14 / NFR15, Architecture §9.1, Epic 1 AC4.
**Histórico:** `docs/handoffs/archive/mj-handoff-secrets-configured-20260507.yaml` (criação das contas EU + 8 secrets).

Este runbook descreve como **configurar contas externas**, **gerir secrets**, **criar dashboards/alertas** e **diagnosticar** a stack de observabilidade da Expressia.

---

## 1. Visão geral da stack

| Camada | Provider | Região | Razão |
|--------|----------|--------|-------|
| RUM / Web Vitals | Vercel Observability | UE (`cdg1` Paris) | Built-in, zero overhead — `<Analytics />` + `<SpeedInsights />` em `apps/web/src/app/layout.tsx`. |
| Errors + Replay | Sentry (EU Frankfurt) | UE | DX premium, PII redaction em 3 camadas, sourcemap upload. |
| Métricas + Traces + Logs | `@vercel/otel` → Grafana Cloud EU | UE Ireland (`eu-west-6`) | Open standard, auto-instrumentação serverless, free tier suficiente até ~5k households. |

**Decisão arquitectural (ADR-004):** dual-emission — Sentry recebe errors via SDK, Grafana recebe tudo (traces + métricas + logs) via OTel. Sentry expõe agora endpoint OTLP nativo; **NÃO usar nesta story** — re-avaliar em Epic 2.

---

## 2. Contas externas e data residency

### Sentry EU (Frankfurt)

| Item | Valor |
|------|-------|
| Org | `eurico-xw` |
| Project | `expressia-web` |
| Plataforma | Next.js |
| DSN domain | `o4510848200278016.ingest.de.sentry.io` (sufixo `.de.` confirma Frankfurt) |
| Org Token name | `expressia-ci-prod` (scopes `org:read`, `project:read`, `project:write`, `project:releases`) |
| Dashboard | `https://eurico-xw.sentry.io/projects/expressia-web/` |

**Region é IMUTÁVEL após criação da org** — confirmado em handoff devops 2026-05-07.

### Grafana Cloud EU (Ireland)

| Item | Valor |
|------|-------|
| Stack | `expressia.grafana.net` |
| Region | `eu-west-6` (Ireland) |
| Plan | Free (10K series + 50GB logs + 50GB traces) |
| OTLP endpoint | `https://otlp-gateway-prod-eu-west-6.grafana.net/otlp` |
| Token name | `expressia-web` (Cloud Access Policy: scopes `metrics:write`, `logs:write`, `traces:write`, `profiles:write`, `stacks:read`) |
| Dashboard | `https://expressia.grafana.net` |

**Region é IMUTÁVEL após criação da stack** — confirmado em handoff devops 2026-05-07.

### Vercel Observability

| Item | Valor |
|------|-------|
| Project | `euricojsalves-4744s-projects/expressia` |
| Region runtime | `cdg1` (Paris UE) |
| Activado | Speed Insights + Analytics (via Dashboard → Analytics) |

---

## 3. Secrets em runtime — 8 valores

Todos os secrets estão em **GitHub Actions** (`gh secret list -R DaSilvaAlves/expressia`) e **Vercel** (`vercel env ls`, Production+Preview, Encrypted).

### Sentry (4 secrets)

```
SENTRY_DSN           = https://<key>@o4510848200278016.ingest.de.sentry.io/4510848213581904
SENTRY_ORG           = eurico-xw
SENTRY_PROJECT       = expressia-web
SENTRY_AUTH_TOKEN    = sntrys_<...>   # Org Token expressia-ci-prod (sourcemap upload)
```

### Grafana Cloud (4 secrets)

```
OTEL_EXPORTER_OTLP_ENDPOINT  = https://otlp-gateway-prod-eu-west-6.grafana.net/otlp
OTEL_EXPORTER_OTLP_HEADERS   = Authorization=Basic%20<base64(InstanceID:Token)>
GRAFANA_API_TOKEN            = glc_<...>   # Cloud Access Policy Token expressia-web
GRAFANA_STACK_NAME           = expressia
```

**⚠️ Ponto crítico:** `OTEL_EXPORTER_OTLP_HEADERS` chega já formatado pela UI Grafana com `Authorization=Basic%20<base64>`. SDKs OTel decodificam o `%20` (URL-encoded space) automaticamente — **NÃO recalcular nem decodificar**.

### Verificar secrets

```bash
# GitHub Actions (8 secrets esperados)
gh secret list -R DaSilvaAlves/expressia

# Vercel (8 novos + 5 Supabase pré-existentes em Production+Preview)
vercel env ls
```

### Rotação de tokens

1. **Sentry Org Token:** revogar antigo na UI Sentry (Settings → Auth Tokens), criar novo com mesmos scopes, actualizar `SENTRY_AUTH_TOKEN` em GitHub + Vercel via:
   ```bash
   gh secret set SENTRY_AUTH_TOKEN -R DaSilvaAlves/expressia
   vercel env rm SENTRY_AUTH_TOKEN production
   vercel env add SENTRY_AUTH_TOKEN production
   # repetir para preview
   ```
2. **Grafana Cloud Access Policy Token:** revogar antigo em `https://expressia.grafana.net` (Administration → Cloud access policies), criar novo com mesmos scopes, actualizar `GRAFANA_API_TOKEN` e re-extrair `OTEL_EXPORTER_OTLP_HEADERS` do novo Connect Card (formato `Basic%20<base64(InstanceID:Token)>`).

---

## 4. Configuração na codebase

### `apps/web/instrumentation.ts` (OTel)

```typescript
import { registerOTel } from '@vercel/otel';

export function register(): void {
  registerOTel({
    serviceName: 'expressia-web',
    // OTEL_EXPORTER_OTLP_ENDPOINT + OTEL_EXPORTER_OTLP_HEADERS lidos automaticamente do env
  });
}
```

**Pré-requisito (Next.js 15.x):** `instrumentation.ts` é estável e activo por default desde 15.0 — não é preciso flag. Em versões anteriores (Next 13/14) era preciso `experimental.instrumentationHook: true`. Se fizer downgrade para Next 14, repor o flag.

### `apps/web/sentry.{server,client,edge}.config.ts`

3 ficheiros distintos para os 3 runtimes do Next.js (Node, browser, Edge middleware).

`next.config.ts` envolvido com `withSentryConfig(...)` para sourcemap upload + auto-instrumentação de erros.

### `apps/web/src/app/layout.tsx` (Vercel Observability)

```tsx
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';

// ...
<body>
  {children}
  <Analytics />
  <SpeedInsights />
</body>
```

### Logger Pino com PII redaction

```typescript
import { logger } from '@meu-jarvis/observability';

logger.info({ household_id: 'abc' }, 'Pedido recebido');
// PII paths: email, password, nif, iban, prompt_text, *.email, *.password, req.headers.authorization, req.headers.cookie
```

---

## 5. Dashboard Grafana — 4 painéis essenciais

**Localização:** `https://expressia.grafana.net`
**Export:** `docs/dashboards/grafana-epic1.json` (versionado para reprodutibilidade).

| Painel | Métrica | Target |
|--------|---------|--------|
| 1. Latência p95 `/api/me` | `histogram_quantile(0.95, rate(http_server_duration_milliseconds_bucket{http_route="/api/me"}[5m]))` | < 200ms |
| 2. Error rate 5xx | `sum(rate(http_server_response_count{http_status_code=~"5.."}[5m])) / sum(rate(http_server_response_count[5m]))` | < 1% |
| 3. RLS policy violations | Logs Loki: `{job="expressia-web"} \|= "rls_policy_violation"` count | = 0 |
| 4. DB query latency p95 | `histogram_quantile(0.95, rate(db_client_operation_duration_milliseconds_bucket[5m]))` | < 300ms |

### Criar dashboard

1. UI Grafana → Dashboards → New → New dashboard.
2. Adicionar 4 painéis com queries acima.
3. Definir time range default 1h, refresh 30s.
4. Save → Share → Export → JSON → guardar em `docs/dashboards/grafana-epic1.json`.

**Pré-requisito:** dados reais a chegar à stack (deploy production verde + ≥ 1 request a `/api/me`).

---

## 6. Alertas Grafana — 2 obrigatórios

**Localização:** Alerting → Alert rules em `https://expressia.grafana.net`.

### Alerta 1: Error rate > 1% em 5 min

- **Query:** `sum(rate(http_server_response_count{http_status_code=~"5.."}[5m])) / sum(rate(http_server_response_count[5m])) > 0.01`
- **Janela:** 5 minutos
- **Severidade:** Critical
- **Notificações:** Email para `euricojsalves@gmail.com` (Grafana → Alerting → Contact points)

### Alerta 2: p95 latência `/api/me` > 200ms em 5 min

- **Query:** `histogram_quantile(0.95, rate(http_server_duration_milliseconds_bucket{http_route="/api/me"}[5m])) > 200`
- **Janela:** 5 minutos
- **Severidade:** Warning
- **Notificações:** Email

---

## 7. Diagnóstico

### Sintoma: spans não aparecem no Grafana

| Causa provável | Verificação | Resolução |
|----------------|-------------|-----------|
| `experimental.instrumentationHook` não activado | `apps/web/next.config.ts` tem `experimental.instrumentationHook: true`? | Adicionar e re-deploy. |
| Env vars OTel ausentes em runtime | `vercel env ls` mostra `OTEL_EXPORTER_OTLP_ENDPOINT` + `OTEL_EXPORTER_OTLP_HEADERS` em Production? | Adicionar via UI ou `vercel env add`. |
| Header com formato inválido (Base64 corrompido) | UI Grafana → Connect Card → comparar valor exacto | Re-extrair valor original — NÃO recalcular. |
| Build serverless não inclui `instrumentation.ts` | Build logs Vercel mencionam "instrumentation hook"? | Forçar redeploy. |

### Sintoma: erros 5xx não aparecem em Sentry

| Causa provável | Verificação | Resolução |
|----------------|-------------|-----------|
| `SENTRY_DSN` ausente em runtime | `vercel env ls` mostra `SENTRY_DSN` em Production? | Adicionar via UI. |
| `withSentryConfig` não envolve `next.config.ts` | Build logs mencionam Sentry plugin? | Confirmar `export default withSentryConfig(nextConfig, {...})`. |
| `beforeSend` está a descartar o evento | Adicionar `console.log` temporário no início do `beforeSend` | Verificar lógica de filtro. |

### Sintoma: stack traces minificadas no Sentry

| Causa provável | Verificação | Resolução |
|----------------|-------------|-----------|
| `SENTRY_AUTH_TOKEN` ausente no CI build | `.github/workflows/ci.yaml` step `build` tem `env.SENTRY_AUTH_TOKEN`? | Adicionar (já presente em Story 1.7 v1.0). |
| Sourcemaps não geradas | Build logs Sentry plugin mencionam "uploaded sourcemaps"? | Confirmar `widenClientFileUpload: true` em `withSentryConfig` opts. |

### Sintoma: PII a aparecer em logs/Sentry

**ESCALAR IMEDIATAMENTE.** Violação da NFR12.

1. Identificar o path: `logger.error({...PII...})` ou `event.user.email` em Sentry.
2. Adicionar o path à lista `PII_REDACT_PATHS` em `packages/observability/src/logger.ts`.
3. Replicar para o `beforeSend` Sentry hook em `apps/web/sentry.{server,client,edge}.config.ts`.
4. Eliminar evento Sentry com PII via UI (Issues → Delete).
5. Eliminar logs Loki: filtrar pelo intervalo + delete via API Grafana.

---

## 8. Custos

**Actual (2026-05-08):** 0 EUR/mês (free tier ambas plataformas).

| Plataforma | Free tier | Quando ultrapassa |
|-----------|-----------|------------------|
| Sentry | 5K erros/mês + 10K performance units | ~ 100 households activos com 50 req/dia |
| Grafana Cloud | 10K series + 50GB logs + 50GB traces | ~ 5K households activos com 500 req/dia |
| Vercel Analytics | 2.5K events/mês | Plano Hobby — actualizar a Pro (€20/mês) acima desse limiar |

**Decisão escalonamento:** quando Sentry ou Grafana atingirem 80% do free tier, avaliar migração para plano paid baseado em custo unitário per household.

---

## 9. Referências

- Story: `docs/stories/active/1.7.observability-otel-sentry.md`
- Architecture: `docs/architecture.md` §9.1 (Observability stack)
- ADR: ADR-004 (dual-emission Sentry + Grafana)
- PRD NFRs: NFR4, NFR12, NFR13, NFR14, NFR15
- Handoff de criação dos secrets: `docs/handoffs/archive/mj-handoff-secrets-configured-20260507.yaml`
- Handoff Story 1.7 ready for dev: `docs/handoffs/archive/mj-handoff-story-1.7-ready-for-dev-20260508.yaml`
