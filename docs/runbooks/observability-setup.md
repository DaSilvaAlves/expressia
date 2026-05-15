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
| `apps/web/instrumentation.ts` ausente ou export incorrecto | Confirmar que o ficheiro existe na raiz de `apps/web/` (não dentro de `src/`) e exporta `function register()`. | Repor ficheiro conforme §4. **NÃO** adicionar `experimental.instrumentationHook` ao `next.config.ts` em Next 15+: o flag foi removido e causa `TS2353` (era exclusivo de Next 13/14). |
| Env vars OTel ausentes em runtime | `vercel env ls` mostra `OTEL_EXPORTER_OTLP_ENDPOINT` + `OTEL_EXPORTER_OTLP_HEADERS` em Production? | Adicionar via UI ou `vercel env add`. |
| Header com formato inválido (Base64 corrompido) | UI Grafana → Connect Card → comparar valor exacto | Re-extrair valor original — NÃO recalcular. |
| Build serverless não inclui `instrumentation.ts` | Build logs Vercel mencionam "instrumentation hook"? | Forçar redeploy. Em Next 15+ o ficheiro é detectado automaticamente sem flag — basta existir na raiz de `apps/web/`. |

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

---

## §7 Dashboard "Agent Health" (Story 2.11)

Dashboard Epic 2 dedicado ao pipeline AI multi-intent: classifier (OpenAI gpt-4o-mini) → planner (Anthropic Claude Sonnet) → executor (atómico Postgres). Ficheiro scaffold versionado: `docs/dashboards/grafana-agent-health.json` (6 painéis).

**Estado actual:** Mockable-friendly — JSON scaffold + queries documentadas; activação UI deferida pós-deploy production (precedente Story 1.7 Tasks 7-8 PARTIAL).

### §7.1 Painéis (6)

| # | Título | Tipo | Query (resumida) | Datasource | Unit | Thresholds |
|---|--------|------|------------------|------------|------|-----------|
| 1 | Latência `/api/agent/prompt` (p50/p95/p99) | timeseries | `histogram_quantile(0.5\|0.95\|0.99, sum(rate(http_server_duration_milliseconds_bucket{http_route="/api/agent/prompt"}[5m])) by (le))` | Prometheus | ms | green 0 / yellow 6000 (NFR1) / red 10000 (NFR15) |
| 2 | Taxa de erro por intent | timeseries | `sum by (intent_class) (rate(http_server_response_count{http_route="/api/agent/prompt", http_status_code=~"5.."}[5m])) / sum by (intent_class) (...)` | Prometheus | % | green 0 / yellow 1% / red 5% |
| 3 | Custo planner €/dia top 10 households | timeseries | `topk(10, sum by (household_hash) (increase(traces_spanmetrics_sum_planner_cost_eur{span_name="agent.planner.call"}[24h])))` | Prometheus | EUR | green 0 / yellow €1 / red €5 |
| 4 | Precisão do benchmark | stat | `avg_over_time(agent_intent_accuracy_ratio[7d])` (OTel meter Gauge Story 2.10) | Prometheus | % | red 0 / yellow 88% / green 90% |
| 5 | Hit rate de cache (Upstash + Anthropic) | timeseries | 2 séries via `traces_spanmetrics_calls_total{span_name=..., ..._cache_hit="true"}` ÷ total | Prometheus | % | red 0 / yellow 15% / green 60% |
| 6 | Violações RLS (placeholder NIT-002-NB) | stat | `count_over_time({job="expressia-web"} \|= "rls.policy_violation" [5m])` | Loki | count | green 0 / red ≥1 |

**Datasource UIDs:** placeholders no scaffold — IDs reais obtidos via UI Grafana após import (§7.4 abaixo).

### §7.2 Span attributes consumidos (43 attrs whitelist)

Total **11 + 12 + 12 + 8 = 43 attrs** distribuídos por 4 spans canónicos (post-PO_FIX_INLINE 2 cross-confirm contra `*_SPAN_ATTRIBUTE_KEYS` arrays reais):

**Top span — `POST /api/agent/prompt` (11 attrs)** — `apps/web/src/lib/agent/tracing.ts:38-51`:

| # | Attribute | Tipo | Notas |
|---|-----------|------|-------|
| 1 | `agent.prompt.household_id` | UUID | tenant identifier (não PII) |
| 2 | `agent.prompt.intent_class` | string | enum value — primeira intent detectada |
| 3 | `agent.prompt.confidence_min` | float | min confidence dos intents |
| 4 | `agent.prompt.mode` | enum `preview`\|`executed` | preview-then-confirm decision |
| 5 | `agent.prompt.tool_count` | integer | tools invocadas |
| 6 | `agent.prompt.duration_ms` | integer | latência total |
| 7 | `agent.prompt.classifier_model` | enum | ex: `gpt-4o-mini` |
| 8 | `agent.prompt.executor_model` | enum | ex: `claude-sonnet-4-5` |
| 9 | `agent.prompt.cache_hit` | boolean | Upstash classifier cache (Story 2.9 AC3) |
| 10 | `agent.prompt.status_code` | integer | HTTP status |
| 11 | `agent.prompt.always_preview_active` | boolean | Story 2.7 FR4 toggle |

**Sub-span — `agent.classifier.classify` (12 attrs)** — `packages/classifier/src/tracing.ts:42-55` (`CLASSIFIER_SPAN_ATTRIBUTE_KEYS`):

`classifier.model` · `classifier.input_length` · `classifier.intent_count` · `classifier.overall_confidence` · `classifier.language_detected` · `classifier.duration_ms` · `classifier.tokens_input` · `classifier.tokens_output` · `classifier.success` · `classifier.error_class` · `classifier.user_hash` · `classifier.trace_id`

**OMISSÃO MVP:** classifier NÃO emite `cost_eur` attr (grep confirmou zero matches em `packages/classifier/src` para cost/pricing). Custo OpenAI é computed downstream por `packages/agent/src/pricing.ts` mas não exportado como span attr. Per NFR21 (modelo barato), custo classifier é ~5-10% do total LLM cost — aceitável omissão MVP; Epic 2.x follow-up natural: adicionar `classifier.cost_eur` emission.

**Sub-span — `agent.planner.call` (12 attrs)** — `packages/planner-executor/src/tracing.ts:36-49` (`PLANNER_SPAN_ATTRIBUTE_KEYS`):

`planner.model` · `planner.intent_count` · `planner.intent_unique_types` · `planner.tool_call_count` · `planner.cache_hit` · `planner.duration_ms` · `planner.tokens_input` · `planner.tokens_output` · `planner.cost_eur` · `planner.success` · `planner.error_class` · `planner.household_hash`

**Sub-span — `agent.executor.run` (8 attrs)** — `packages/planner-executor/src/tracing.ts:115-124` (`EXECUTOR_SPAN_ATTRIBUTE_KEYS`):

`executor.tool_count` · `executor.duration_ms` · `executor.success` · `executor.rolled_back` · `executor.failed_tool_name` · `executor.reverse_op_count` · `executor.run_id` · `executor.household_hash`

**Spans tool — `agent.tool.call` + `agent.tool.atomic`** (Story 2.3, `packages/tools/src/tracing.ts:26,31`): parent-child de `agent.executor.run` — documentar para deep-dive debug mas não consumidos directamente pelos 6 painéis MVP.

### §7.3 Empty states esperados

| Cenário | Painel afectado | Comportamento | Resolução |
|---------|-----------------|----------------|-----------|
| Story 2.10 T10 BLOCKED (DPA UE Anthropic pending) | Painel 4 (accuracy) | Renderá "Sem dados" — métrica `agent.intent_accuracy_ratio` nunca emitida | Eurico decide opção A/B/C runbook DPA UE → executar `pnpm --filter @meu-jarvis/agent-bench run bench:real` |
| EB3 Upstash não provisionado | Painel 5 série (a) Upstash | Renderá taxa = 0% (modo degradado Story 2.9 AC1 sem crash) | Eurico provisiona Upstash Redis EU Frankfurt + secrets `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` em Vercel runtime |
| Tráfego baixo MVP (< 50 prompts/dia) | Painel 1 (latência) | p95 com poucos buckets — alta variância visual | Ajustar query window de `[5m]` para `[1h]` em early days; voltar a `[5m]` quando volume estabilizar |
| Emission `rls.policy_violation` não implementada | Painel 6 (RLS) | Renderá 0 sempre — NIT-002-NB documentado | Epic 2.x housekeeping ou Epic 7 Platform: adicionar `logger.warn({ event: 'rls.policy_violation', table, query })` em error handler Drizzle |
| Anthropic planner mockable-only (EB1 pending) | Painéis 3, 5 série (b) | Métricas zero — Sonnet nunca invocado em prod | Eurico decide opção A/B/C DPA UE Anthropic → planner+executor saem de mockable-only |

### §7.4 Activação UI pós-deploy (5 passos)

Deferido para handoff `mj-handoff-2.11-post-deploy-grafana-{date}.yaml` (precedente directo Story 1.7 Tasks 7-8 PARTIAL):

1. **Login** em `https://expressia.grafana.net` com credenciais OAuth Eurico.
2. **Importar dashboard** — Dashboards → New → Import → JSON upload `docs/dashboards/grafana-agent-health.json`.
3. **Seleccionar datasources** no wizard de import: Prometheus (para painéis 1-5) + Loki (para painel 6).
4. **Confirmar queries renderam** — abrir cada painel, verificar:
   - Painéis 1-2-5 (séries primárias): dados reais imediatamente (tráfego /jarvis pós cascada resolvida 2026-05-15).
   - Painel 3 (custo): dados reais se planner Sonnet activo OR empty se mockable-only.
   - Painel 4 (accuracy): empty até Story 2.10 T10.
   - Painel 6 (RLS): empty (NIT-002-NB).
5. **Export populated** — Dashboard → Share → Export → Save to file → substituir `docs/dashboards/grafana-agent-health.json` com export que contém UIDs reais de datasources + `version` incrementado. Commit via `@devops *push`.

---

## §8 Alertas Agent Health (NFR15)

3 alarmes Grafana Alerting documentados — activação UI deferida pós-deploy via handoff (precedente Story 1.7 Task 8 PARTIAL).

### §8.1 Alarme 1 — Latência p95 alta

| Campo | Valor |
|-------|-------|
| Query | `histogram_quantile(0.95, sum(rate(http_server_duration_milliseconds_bucket{http_route="/api/agent/prompt"}[5m])) by (le)) > 10000` |
| Janela | 5 min |
| Severity | HIGH |
| Notification channel | recomendação **email único `eurico@…`** MVP zero custo ([AUTO-DECISION D60] deferido @architect gate; alternativas: Slack `#expressia-alerts` futuro multi-dev, PagerDuty free tier futuro 5+ devs) |
| Acção recomendada | (i) verificar Vercel Status para outage `fra1`; (ii) verificar OpenAI/Anthropic status pages (DPA UE endpoints); (iii) abrir painel 1 + 5 para identificar se latência é classifier OR planner OR cache miss; (iv) se persistir > 30min, escalar manualmente |
| Trace | NFR15 PRD §3 ("latência p95 do agente > 10s em 5 min"), Architecture §9.2 alarme `agent.latency.p95`, R2 mitigação Epic plan |

### §8.2 Alarme 2 — Custo LLM excede 35% MRR (7d rolling)

| Campo | Valor |
|-------|-------|
| Query | `(sum(increase(traces_spanmetrics_sum_planner_cost_eur{span_name="agent.planner.call"}[7d])) / sum(billing_mrr_eur_total)) > 0.35` |
| Janela | 7 dias rolling |
| Severity | HIGH |
| Notification channel | mesmo canal alarme 1 (email único MVP, [AUTO-DECISION D60]) |
| Acção recomendada | (i) verificar painel 3 para identificar households top-cost; (ii) verificar se hard-stop 110% Story 2.9 AC8 está a funcionar (`incrementQuota` agora via `getServiceDb()` per Story 2.9 D50); (iii) se sustained > 7d, escalar review pricing tiers Architecture §6.4 |
| Trace | Architecture §9.2 alarme `agent.cost.eur_per_household_24h` (`> 35% MRR rolling 7d → alarme`), NFR20, R3 mitigação Epic plan |
| Pré-condição | métrica `billing_mrr_eur_total` será emitida quando Stripe billing integration entrar (Epic 7 Platform & Compliance — fora de scope MVP); até lá alarme renderá "No data" |

### §8.3 Alarme 3 — Precisão do benchmark < 88%

| Campo | Valor |
|-------|-------|
| Query | `avg_over_time(agent_intent_accuracy_ratio[24h]) < 0.88` |
| Janela | 24h (alinhado benchmark CI nightly Architecture §10.3) |
| Severity | MEDIUM (abre ticket, não bloqueia pipeline) |
| Notification channel | mesmo canal alarme 1 (email único MVP, [AUTO-DECISION D60]) |
| Acção recomendada | (i) verificar painel 4 para tendência últimos 7d; (ii) re-correr benchmark `pnpm --filter @meu-jarvis/agent-bench run bench:real` para confirmar regressão; (iii) abrir issue tracking + estratégia mitigação R1 (re-tuning prompts classifier OR upgrade modelo) |
| Trace | Architecture §9.2 alarme `agent.intent_accuracy` (`< 88% → ticket auto`), Epic 2 AC6 (precisão ≥ 90% — target 2pp acima do alarme buffer), R1 mitigação |
| Pré-condição | Story 2.10 T10 desbloqueado (Eurico QA1 DPA UE Anthropic); até lá alarme renderá "No data" + nunca dispara |

### §8.4 Activação UI dos alarmes (deferido)

Deferido para handoff `mj-handoff-2.11-post-deploy-grafana-{date}.yaml`. Workflow UI:

1. Alerting → Alert rules → New alert rule por cada alarme acima.
2. Configurar Notification policy → contact point (email recomendado MVP).
3. Test fire — simular condição para validar canal.
4. Confirmar silenciamento durante deploy windows.

---

## §9 Decisão dual-emission Sentry+OTel — re-evaluation (Epic ED4)

**Contexto:** EPIC-2 decision log ED4 (2026-05-08) prometia re-avaliar dual-emission em Story 2.11.

**Status actual (Story 1.7 Done):** Stack mantém dual-emission:
- **Sentry SDK** para errors via `captureException` em `packages/observability/src/sentry.ts` — replay com PII redaction (NFR12), DSN EU Frankfurt (`o4510848200278016.ingest.de.sentry.io`).
- **Grafana via OTel** para métricas + traces + logs via `@vercel/otel` → `otlp-gateway-prod-eu-west-6.grafana.net/otlp`.

### §9.1 Avaliação @sm (drafted)

Após 4 meses prod (estimado pós-Epic 2 launch ~Q3 2026), avaliar:

| Dimensão | Métrica |
|----------|---------|
| Volume duplicado | events Sentry vs error logs Grafana — overlap esperado, quantificar |
| Custo combinado | Sentry free tier (até 5k errors/mês) + Grafana free tier (10k metrics + 50GB logs) — ambos €0 hoje |
| DX prós | Sentry replay + breadcrumbs (Architecture §14.4 ADR-004); Grafana correlation traces↔logs↔metrics |
| DX contras | manter 2 dashboards; alertas duplicados a configurar; mental overhead 2 plataformas |
| Migration custo | Sentry → Grafana via OpenTelemetry SDK supported, ~2 semanas refactor |

### §9.2 Recomendação @sm (formalizada nesta story v1.1)

**Manter dual-emission no MVP** — três razões:

1. **Sentry replay é diferenciador DX para debug** — Architecture §14.4 ADR-004 reconhece valor único; Grafana logs não oferecem session replay nativo.
2. **Zero pressão de custo** — ambos €0/mês no free tier; sem incentivo financeiro para migrar.
3. **4 meses prod é insuficiente** — observability fatigue só emerge com volume real (estimated 5k+ households Epic 7+); avaliar formalmente em Epic 7 (Platform & Compliance) com 90+ dias prod metrics.

### §9.3 Decisão deferida [DEV_DECISION D59]

@architect gate ratifica:

- **Opção A (recomendação @sm):** manter dual-emission, re-avaliar formalmente Epic 7 com base em métricas reais 90+ dias prod.
- **Opção B (deep-dive):** ordenar @architect análise técnica + cost projection ANTES de Epic 7 launch para baseline informada.
- **Opção C (migrate now):** consolidar em Grafana-only via OpenTelemetry SDK migration — rejeitada pelo @sm por baixa relevância MVP.

**Trace:** EPIC-2 decision_log ED4, Architecture §14.4 ADR-004 (dual-emission ADR), [AUTO-DECISION D59] Story 2.11.

---

## §10 Referências Story 2.11

- Arquitectura: `docs/architecture.md` §9.4 (Agent Health), §9.2 (métricas-chave), §14.4 ADR-004
- PRD: NFR13 + NFR14 + NFR15 (linhas 110-112)
- Epic plan: `docs/epics/EPIC-2-EXECUTION.yaml` linhas 281-294 (Story 2.11 scope_summary)
- Story file: `docs/stories/active/2.11.observability-dashboards-agent-health.md`
- Dashboard scaffold: `docs/dashboards/grafana-agent-health.json` (6 painéis)
- Precedente Story 1.7: `docs/dashboards/grafana-epic1.json` (4 painéis Epic 1)
- Handoffs: `docs/handoffs/archive/mj-handoff-2.11-ready-for-po-20260515.yaml` + `mj-handoff-2.11-ready-for-dev-20260515.yaml`
- Tracing canónico:
  - `packages/classifier/src/tracing.ts:26,42-55` — `agent.classifier.classify` + 12 attrs
  - `packages/planner-executor/src/tracing.ts:36-49,115-124` — `agent.planner.call` 12 + `agent.executor.run` 8 attrs
  - `packages/tools/src/tracing.ts:26,31` — `agent.tool.call` + `agent.tool.atomic` (parent-child)
  - `apps/web/src/lib/agent/tracing.ts:38-51` — top span 11 attrs whitelist
