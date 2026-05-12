# Upstash Redis EU Frankfurt — Provisionamento

**Story:** 2.9 — Cost Router + Cache Upstash + Quotas (NFR20)
**Audience:** Eurico (operador), `@devops` (deploy)
**Status:** EB3 PENDING — provisionar antes do push da Story 2.9.

---

## Contexto

A Story 2.9 introduz cache de classificações em Upstash Redis com TTL 300s
(Architecture §4.6 literal "5min cache"). O cliente é **mockable-only** em
testes (`vi.mock('@upstash/redis')`) e funciona em **modo degradado** sem env
vars (sempre MISS, sem crash). Portanto:

| Estado | Comportamento |
|--------|---------------|
| Sem env vars (dev/CI sem Upstash) | `UpstashCache.get()` retorna `null` sempre. Pipeline funciona normalmente. |
| Com env vars válidos (prod) | Cache lookup activo → poupança ~40% chamadas classifier (R3 mitigação). |
| Erro de network Upstash | Modo degradado runtime — `get()` retorna `null`, `set()` é no-op. Sem crash. |

Provisionamento é necessário apenas para **realizar a poupança em prod** —
não bloqueia merge da Story 2.9.

---

## Passos de Provisionamento

### 1. Criar conta + database Upstash

1. Abrir [upstash.com](https://upstash.com) e fazer login (ou criar conta).
2. **Console → Redis → Create Database.**
3. Configurar:
   - **Name:** `expressia-prod-cache` (ou similar — convenção interna)
   - **Region:** **`eu-west-1` (Frankfurt)** — obrigatório por data residency UE
     (alinha com Vercel `fra1` + Supabase `eu-central-1`)
   - **Type:** `Regional` (não `Global` — não precisamos de multi-region para MVP)
   - **TLS:** `Enabled` (default)
   - **Eviction:** `allkeys-lru` (default — adequado para cache TTL-based)

### 2. Copiar credenciais REST

No dashboard da database criada:

1. **Tab `Details` → secção `REST API`.**
2. Copiar os dois valores:
   - `UPSTASH_REDIS_REST_URL` (formato `https://eu-west-1-...upstash.io`)
   - `UPSTASH_REDIS_REST_TOKEN` (token longo base64-url)

### 3. Popular env vars em dev local

Editar `apps/web/.env.local` (criar se não existir):

```bash
UPSTASH_REDIS_REST_URL=https://eu-west-1-xxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=AY...token-base64-url...
# Opcional — override do TTL default (300s):
# CACHE_TTL_SECONDS=300
```

**Nunca commitar** `apps/web/.env.local` (já em `.gitignore`).

### 4. Popular env vars em Vercel (prod)

Via Vercel Dashboard:

1. **Project → Settings → Environment Variables.**
2. Adicionar para `Production` + `Preview`:
   - `UPSTASH_REDIS_REST_URL` = valor copiado
   - `UPSTASH_REDIS_REST_TOKEN` = token copiado
3. Redeploy o projecto (`vercel --prod` ou push para main com `@devops`).

### 5. Smoke test

A partir do terminal local:

```bash
# Set
curl -X POST "$UPSTASH_REDIS_REST_URL/set/smoke-test/hello-eurico" \
  -H "Authorization: Bearer $UPSTASH_REDIS_REST_TOKEN"
# Resposta: {"result":"OK"}

# Get
curl "$UPSTASH_REDIS_REST_URL/get/smoke-test" \
  -H "Authorization: Bearer $UPSTASH_REDIS_REST_TOKEN"
# Resposta: {"result":"hello-eurico"}

# Cleanup
curl -X POST "$UPSTASH_REDIS_REST_URL/del/smoke-test" \
  -H "Authorization: Bearer $UPSTASH_REDIS_REST_TOKEN"
```

Se os três passos retornarem 200, a integração está pronta.

### 6. Verificar em prod após deploy

Após push da Story 2.9 + deploy Vercel:

1. Fazer um prompt no `/jarvis` com texto repetível (ex: "quantas tarefas tenho?").
2. Fazer **o mesmo prompt outra vez dentro de 5 minutos**.
3. No Grafana / Sentry, verificar o span attribute `agent.prompt.cache_hit`:
   - Primeira call: `cache_hit=false`
   - Segunda call: `cache_hit=true`

Se a segunda call tiver `cache_hit=false`, verificar:
- Env vars Vercel estão definidos (sem typos)
- Database Upstash está activo (não eviction-purged)
- O prompt é exactamente o mesmo (case-insensitive + whitespace-collapsed)

---

## Custo Upstash

Plano `Free` actual da Upstash:
- 10k commands/day
- 256MB storage

Para o MVP da Expressia (tráfego baixo), o plano Free é suficiente. Quando o
tráfego crescer (>100 prompts/dia em prod), avaliar upgrade para `Pay as you go`
ou `Fixed plan` — alarmes em Grafana detectarão saturação antes de impacto
funcional.

---

## Modo Degradado — Por Que Não Bloqueia Deploy

A Story 2.9 foi desenhada para tolerar **ausência total** de Upstash em prod:

1. `UpstashCache` constructor verifica env vars; se ausentes, `degraded = true`.
2. `get(key)` retorna `null` imediatamente sem invocar `@upstash/redis`.
3. `set(key, value)` é no-op silencioso.
4. Pipeline executa classifier normalmente — sem cache benefit, mas sem crash.

Isto significa que **a Story 2.9 pode fazer push para prod ANTES da provisão**
do Upstash, e a poupança de custo activa-se assim que as env vars forem populadas.

---

## Troubleshooting

| Sintoma | Causa provável | Resolução |
|---------|----------------|-----------|
| `cache_hit` sempre `false` em prod | Env vars não populadas no Vercel | Verificar Settings → Environment Variables; redeploy |
| Erro `Authorization failed` em logs Pino | Token expirado ou inválido | Regenerar token no dashboard Upstash; actualizar Vercel |
| Latência alta (>200ms) em `cache_lookup` | Database em região errada (não `eu-west-1`) | Recriar database em Frankfurt; actualizar env vars |
| `UpstashRedisCommandError: ERR max...` | Quota Free plan excedida | Upgrade para Pay-as-you-go ou aumentar TTL |

---

## Trace

- Story 2.9 AC1+AC2+AC3 (cache Upstash)
- Architecture §4.6 "Redis cache 5min" + algoritmo de routing
- `apps/web/src/lib/agent/cache.ts` (implementação)
- `.env.example:61-62` — variáveis documentadas
