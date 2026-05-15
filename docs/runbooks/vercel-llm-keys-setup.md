# Runbook — Configuração das API Keys LLM no Vercel

> **Operação:** Adicionar `OPENAI_API_KEY` + `ANTHROPIC_API_KEY` ao projecto Vercel `expressia`
> **Responsável:** @devops (Gage)
> **Iniciado:** 14/05/2026
> **Estado:** ✅ COMPLETO — keys configuradas, infra validada. Teste funcional
> revelou bug de código downstream (não-infra) encaminhado para @dev — ver §7.
> **Trigger:** `/jarvis` em produção rebenta com `Provider openai returned 401`
> **Handoff origem:** @ux-design-expert (Uma) — diagnóstico em `docs/ux/jarvis-error-ux-spec.md` §1

---

## 1. Contexto

Todo o Epic 2 (pipeline AI) foi desenvolvido em modo "mockable-only". As API
keys reais nunca foram configuradas em produção — as dependências EB1/EB2
(DPA UE com OpenAI + Anthropic) estavam `PENDING`. O dono confirmou em
14/05/2026 que as keys existem, são válidas e o DPA UE está tratado.

Causa raiz no código: `apps/web/src/app/api/agent/prompt/route.ts:697`
→ `apiKey: process.env.OPENAI_API_KEY ?? 'unset'`.

## 2. Estado inicial (verificado 14/05/2026)

`vercel env ls` no projecto `expressia` (`prj_u5y4Jq5rrhIqQevAfUyFqnwRyeVz`,
org `team_Z7HN1UF28iHpUxCnZ4gT7wMF`):

- 13 env vars presentes: Supabase (5), Sentry (4), OTel (2), Grafana (2)
- `OPENAI_API_KEY` — **AUSENTE** (Production + Preview)
- `ANTHROPIC_API_KEY` — **AUSENTE** (Production + Preview)

## 3. Procedimento

### Princípio de segurança

As keys são secrets — **nunca** colar no chat com agentes nem committar ao
repo. `.env.example` mantém as linhas 31-32 (`ANTHROPIC_API_KEY=` /
`OPENAI_API_KEY=`) vazias por design. A entrada dos valores é feita pelo dono
do projecto, via dashboard Vercel ou `vercel env add` interativo.

### Opção A — Dashboard Vercel (recomendada para secrets)

**Guia passo a passo detalhado:** `docs/runbooks/GUIA-vercel-llm-keys-passo-a-passo.md`

Resumo:
1. Vercel → projecto `expressia` → Settings → Environment Variables
2. Add → `OPENAI_API_KEY` → colar valor → scopes **Production** + **Preview** → Save
3. Add → `ANTHROPIC_API_KEY` → colar valor → scopes **Production** + **Preview** → Save

### Opção B — Vercel CLI interativo

Correr a partir da raiz do repo (o projecto já está linkado em `.vercel/`):

```bash
vercel env add OPENAI_API_KEY production
vercel env add OPENAI_API_KEY preview
vercel env add ANTHROPIC_API_KEY production
vercel env add ANTHROPIC_API_KEY preview
```

Cada comando pede o valor numa prompt de linha única — colar e Enter.

### Redeploy (obrigatório)

Env vars novas **não** se aplicam a deployments existentes. Após as 4 entradas
estarem confirmadas, fazer redeploy do deployment de produção actual
(re-build com novas env vars, mesmo código):

```bash
vercel redeploy <production-deployment-url> --prod
```

## 4. Verificação

- [x] `vercel env ls production` mostra `OPENAI_API_KEY` + `ANTHROPIC_API_KEY`
- [x] `vercel env ls preview` mostra ambas
- [x] Deployment fica `Ready` em `fra1` (Frankfurt) — `2fyfepub2` / `dpl_BVBRwB1BCwArXBqd8W5TFHXdUMEh`
- [x] Deployment aliased ao domínio de produção `expressia-black.vercel.app`
- [x] `GET https://expressia-black.vercel.app/entrar` responde `200`
- [x] `GET https://expressia-black.vercel.app/jarvis` responde `307` → `/entrar` (middleware auth OK)
- [x] Sem regressão — as 13 env vars pré-existentes intactas (total 15)
- [x] **Prompt simples ("olá") no `/jarvis` não devolve `401`** — confirmado no browser:
      o erro mudou de `401 Unauthorized` para `400 Bad Request`. A autenticação com a
      OpenAI **passa** — infra validada. O `400` é um bug de código separado (ver §7).

## 5. Registo de execução

| Timestamp | Acção | Por | Resultado |
|-----------|-------|-----|-----------|
| 14/05/2026 22:50 | Diagnóstico inicial — keys ausentes confirmadas (`vercel env ls`) | @devops | ✅ |
| 14/05/2026 ~22:54 | `OPENAI_API_KEY` adicionada — Production + Preview, Sensitive | dono do projecto | ✅ |
| 14/05/2026 ~22:55 | `ANTHROPIC_API_KEY` adicionada — Production + Preview, Sensitive | dono do projecto | ✅ |
| 14/05/2026 22:55:58 | Redeploy automático (disparado pela env var) — `2fyfepub2`, ambas as keys, `[fra1]` | Vercel | ✅ |
| 14/05/2026 ~22:58 | Deployment `Ready` + promovido aos aliases de produção | Vercel | ✅ |
| 14/05/2026 23:08 | Verificação infra: aliases, HTTP, fra1, env vars (`vercel inspect` + `curl`) | @devops | ✅ |
| 14/05/2026 23:15 | Validação funcional `/jarvis` no browser — `401` → `400` (infra OK, bug código downstream) | dono do projecto | ✅ |
| 14/05/2026 23:15 | Bug do schema do classifier diagnosticado e encaminhado para @dev (ver §7) | @devops | ✅ |

## 5b. Notas / achados laterais

- **`expressia.pt`** — `curl` devolve `HTTP 000` (não resolve). O custom domain ainda
  não está configurado/apontado. Não bloqueia — a app serve em `expressia-black.vercel.app`.
  Tratar como item separado quando o domínio for activado.
- **`UPSTASH_REDIS_*`** — ausente do Vercel. Código da Story 2.9 tem modo degradado
  para cache ausente — não bloqueia. Ver `docs/runbooks/upstash-setup.md`.

## 6. Próximo passo após conclusão

Esta operação de infra está **fechada**. Os passos seguintes pertencem a `@dev`
e estão capturados no handoff `mj-handoff-jarvis-classifier-schema-bug-20260514.yaml`:

1. **BLOQUEANTE** — corrigir o bug do schema do classifier (§7 abaixo).
2. **Polish** — implementar a spec de UX de erro `docs/ux/jarvis-error-ux-spec.md`
   (jarvis-chat.tsx expõe `error.message` técnico cru — 12 códigos + bug
   `QUOTA_EXCEEDED` no fallback 429). Não bloqueia, mas é o que fará o erro
   actual deixar de aparecer cru ao utilizador.

## 7. Achado downstream — bug do schema do classifier (NÃO-INFRA)

O teste funcional pós-deploy provou que a infra está OK (`401` → `400`), mas
expôs um bug de código que o modo "mockable-only" nunca apanhou.

**Erro observado no `/jarvis`:**
```
Classifier LLM call failed (j): Provider openai returned 400 (bad request):
Invalid schema ... schema must be a JSON Schema of 'type: "object"', got 'type: "None"'
```

**Causa raiz** — `packages/classifier/src/classifier.ts:290`:
```ts
const jsonSchema = zodToJsonSchema(ClassificationSchema, {
  name: 'classification',   // ← envolve o resultado em { $ref, definitions }
  $refStrategy: 'none',
});
```
Passar `name` ao `zodToJsonSchema` produz `{ $ref: '#/definitions/classification',
definitions: {...} }`. O objecto de topo enviado em `response_format.json_schema.schema`
(linha 304) não tem `type` → a OpenAI rejeita com `type: "None"`.

**Domínio:** `@dev` (código do classifier) — possível input de `@architect` se for
decisão de design. **Não é infra.** Encaminhado via handoff.

---

## 8. DPA UE — Conformidade com Anthropic e OpenAI (risco aberto)

> **Adicionado em 2026-05-15 — Story 2.10 (Benchmark E2E Anthropic).** Esta
> secção documenta a posição contratual face ao processamento LLM externo dos
> prompts dos utilizadores, e a Questão Aberta QA1 escalada por @po (Pax) para
> Eurico decidir antes da execução real do benchmark (T10 da Story 2.10).

### 8.1 Estado actual — Anthropic

| Aspecto | Detalhe |
|---------|---------|
| Endpoint regional EU | **Não disponível** em mai/2026. Único endpoint `api.anthropic.com` processa em US. |
| DPA contratual | Disponível para clientes Enterprise via Data Processing Agreement (negociação directa). Link oficial: [anthropic.com/legal/data-processing-agreement](https://www.anthropic.com/legal/data-processing-agreement) (verificar). |
| Armazenamento | Inferência transiente. Sem armazenamento residual desde que o request não inclua flags de retenção (`store` ou similar — Anthropic não expõe `store` em mai/2026 — comportamento default = no retention). |
| Trace na arquitectura | NFR11 (data residency UE — refere dados ARMAZENADOS); GDPR Art. 46 (transferência via DPA é mecanismo standard para países terceiros). |

### 8.2 Estado actual — OpenAI

| Aspecto | Detalhe |
|---------|---------|
| Endpoint regional EU | Disponível para Business/Enterprise via "ChatGPT Enterprise on Azure OpenAI" e em desenvolvimento para API directa. API standard `api.openai.com` processa US. |
| DPA UE | Disponível em [openai.com/policies/data-processing-addendum](https://openai.com/policies/data-processing-addendum) — assinatura electrónica. |
| Armazenamento `store: false` | Regra inegociável para este projecto: **NUNCA enviar `metadata` no payload + NUNCA `store: true`** — `store: true` faria a OpenAI armazenar a completion (incluindo o prompt do utilizador com PII) durante 30 dias, violando NFR12 + data residency UE. Herdado do hotfix da cascata `/jarvis` commit `32ac564` (15/05/2026): `metadata` removido do payload em `packages/classifier/src/classifier.ts:callLlmOnce`. |

### 8.3 Mitigação D56 (Story 2.10) — NFR11 restrito a dados armazenados

NFR11 (data residency UE) é inegociável para dados **ARMAZENADOS** — Postgres
EU (Supabase eu-central-1) + Vercel `fra1` já garantidos. O **processamento
transiente** do prompt num LLM externo é dado em-trânsito coberto por GDPR
Art. 46 (transferência via DPA contratual standard para países terceiros).
Sem DPA, a alternativa seria proxy EU intermediário (adiciona latência
~150-300ms e custo operacional, ganho legal marginal vs. DPA contratual).

Trace: Story 2.10 [AUTO-DECISION] D56; CON4 (mercado PT exclusivo).

### 8.4 Questão Aberta QA1 — escalada Eurico

@po Pax escalou a decisão final (não decidível como PO porque envolve GDPR/legal e a estratégia comercial). **Opções:**

| Opção | Descrição | Recomendação Pax |
|-------|-----------|------------------|
| **A** | Aceitar DPA contratual Anthropic + endpoint padrão US + documentar risco aberto nesta secção (esta abordagem) | ✓ RECOMENDADO |
| **B** | Bloquear MVP até endpoint EU Anthropic existir | Congela ~6 meses sem ganho legal claro vs A |
| **C** | Mover Planner para OpenAI gpt-4o (DPA UE já confirmado) — perda de heterogeneidade de router NFR21 | Considerar se A for inaceitável |

**Decisão Eurico (preencher quando responder):**

```
Data: ____________________
Opção: ___ (A / B / C)
Notas: __________________________________________________________
```

Enquanto QA1 estiver em aberto, **T10 da Story 2.10 fica BLOCKED**. T1-T9 mockable-only correm sem restrição.

### 8.5 Cross-references

- Story 2.10 (Benchmark E2E Anthropic): `docs/stories/active/2.10.benchmark-e2e-anthropic.story.md` — AC3 (esta secção), T10 (bloqueado), AC1+AC2 (integração real keys).
- Hotfix `/jarvis` que estabeleceu regra `store: false`: commit `32ac564` (`fix(classifier): remover metadata do payload OpenAI`) — handoff `mj-handoff-jarvis-classifier-metadata-bug-20260515` (archive).
- Provisão keys Vercel: §3 deste runbook (`vercel-llm-keys-setup.md` — Production+Preview, `fra1`).
- Pipeline 3-estágios: `docs/architecture.md` §4.
