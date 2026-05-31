# ADR-001 — OpenRouter como Gateway LLM unificado

| Campo | Valor |
|-------|-------|
| **Estado** | Decidido — **NO-GO para produção** (GO-PARCIAL condicional só para tráfego sem PII) |
| **Data** | 29/05/2026 |
| **Autor** | @architect (Aria) |
| **Decisores** | @architect (decisão técnica); ratificação estratégica → Eurico |
| **Contexto-fonte** | `docs/CORE-STATE-AUDIT-20260529.md` (GAP-1), handoff `mj-handoff-openrouter-llm-gateway-study-20260529.yaml` |
| **Constraint dominante** | Data residency UE obrigatória (CLAUDE.md; NFR de mercado PT-PT exclusivo) |
| **Supersedes** | — |

---

## Contexto

A auditoria de estado real de 29/05 confirmou (GAP-1) que o cérebro AI da Expressia está morto por ausência de chaves LLM: o Classifier lê `OPENAI_API_KEY` (`apps/web/src/app/api/agent/prompt/route.ts:719`) e o Executor lê `ANTHROPIC_API_KEY` (`packages/agent/src/providers/anthropic.ts:67`). Nenhuma das duas existe no ambiente.

Antes de provisionar as duas chaves directas (Fase 0 da auditoria), o Eurico pediu avaliação do **OpenRouter** como gateway único: uma só chave, fallback automático entre providers, e troca de modelos sem mudar código.

A decisão é gerida **por gates em cascata**. Se o Gate #1 (data residency / GDPR) falhar, é NO-GO imediato e os pontos seguintes ficam como nota informativa — foi exactamente o que aconteceu.

---

## Gate #1 — Data residency UE / GDPR (DECISIVO)

### O facto que define tudo

A Expressia processa **PII real de famílias portuguesas** (finanças, tarefas, nomes) que **passa literalmente dentro dos prompts LLM**. O projecto tem data residency UE como constraint inegociável (Vercel `fra1` + Supabase `eu-central-1`). Qualquer transferência de dados pessoais para fora do EEE exige base legal de transferência sob o RGPD (Cap. V — tipicamente Standard Contractual Clauses ancoradas num DPA).

### O que o OpenRouter realmente oferece (verificado nas docs)

| Mecanismo | Disponível para | O que garante | O que NÃO garante |
|-----------|-----------------|---------------|-------------------|
| **EU in-region routing** (`https://eu.openrouter.ai`) | **Enterprise-only, mediante pedido** | Prompts/completions processados e desencriptados **apenas na UE**; nunca saem do EEE | Nada — é o único que satisfaz a constraint, mas é fechado a self-serve |
| **DPA (Data Processing Agreement)** RGPD | **Enterprise-only** (Trust Portal `trust.openrouter.ai`) | Base contratual RGPD + SCCs para subprocessadores | Indisponível sem contrato enterprise |
| **ZDR (Zero Data Retention)** — account-wide ou por-request (`zdr`) | **Todas as contas** | Provider **não retém** o prompt/output | **NÃO garante processamento na UE** — o request pode ser desencriptado e processado nos EUA, apenas não fica guardado |
| Logging desligado por defeito | Todas | Só guarda metadados (tokens, latência, modelo) | Idem — metadados ≠ residency do conteúdo |

### A distinção que mata o GO

**ZDR resolve _retenção_, não resolve _localização de processamento_.** Sob o RGPD, o tratamento de dados pessoais (mesmo efémero, mesmo sem retenção) por um subprocessador nos EUA constitui uma transferência internacional que exige SCCs/DPA. O único mecanismo do OpenRouter que mantém o conteúdo dentro da UE — o EU in-region routing via `eu.openrouter.ai` — e o único instrumento que fornece a base contratual — o DPA — estão **ambos atrás do tier enterprise, ativados manualmente por pedido**, não self-serve.

### Comparação com as directas

OpenAI e Anthropic, contratadas directamente, oferecem **DPAs self-serve standard** (com SCCs) acessíveis a qualquer conta paga, e ambas têm opções de data processing reconhecidas para clientes europeus. Para um MVP pré-receita, contratar directamente é o caminho com base legal RGPD imediata e sem fricção comercial.

### Veredicto do Gate #1: **FALHA para produção**

A Expressia, como MVP pré-receita, **não está em posição de negociar nem custear um contrato enterprise OpenRouter** só para desbloquear o chat. Sem o tier enterprise não há nem EU in-region routing nem DPA — logo não há garantia de residency UE para PII. **Gate #1 falha → NO-GO para produção com PII.**

> Nota: o Gate #1 NÃO falhou por impossibilidade técnica do OpenRouter (ele _tem_ a capacidade), falhou pela **condição de acesso** (enterprise-only) ser incompatível com o estágio e modelo de custo do projecto agora.

---

## Pontos seguintes (informativos — Gate #1 falhou)

Mantidos curtos por disciplina de gate. Documentam o que mudaria a decisão se o estágio do projecto mudasse (ver "Reavaliar quando").

### Gate #2 — Prompt caching Anthropic (custo)

**Resultado: NÃO seria bloqueante.** O OpenRouter propaga o prompt caching nativo da Anthropic. O `cache_control: { type: 'ephemeral' }` em blocos explícitos (exactamente o padrão usado em `packages/agent/src/providers/anthropic.ts:178,195`) é suportado, e o OpenRouter usa _provider sticky routing_ para manter o cache quente entre requests. O caching nativo top-level só é garantido quando o routing vai directo à Anthropic (não Bedrock/Vertex), mas os breakpoints por-bloco — que é o que o nosso executor usa — funcionam. NFR11 (custo via caching) seria preservado.

### Compatibilidade de código (esforço de integração, se algum dia GO)

| Componente | Caminho | Esforço | Verificação |
|-----------|---------|---------|-------------|
| **Classifier** (`packages/classifier/src/classifier.ts`) | Cliente OpenAI injectado via `createClassifier()` (`route.ts:714-722`), interface estrutural `OpenAIClientLike`. Acrescentar `baseURL: 'https://openrouter.ai/api/v1'` ao `new OpenAICtor({...})`. | **Trivial — 1 linha** | `gpt-4o-mini` **suporta** `response_format: json_schema` (strict) no OpenRouter. Confirmado. |
| **Executor** (`packages/agent/src/providers/anthropic.ts:75`) | SDK Anthropic directo (`new Anthropic({ apiKey })`). Tem `apiKeyOverride`/`clientOverride` mas **não** `baseURL`. | **Pequeno — ~3-5 linhas** | OpenRouter expõe uma "**Anthropic Skin**": a Anthropic SDK aponta `baseURL` a `https://openrouter.ai/api`, falando `/v1/messages` nativo. **Tool calling + `cache_control` ephemeral passam intactos.** Não é preciso o endpoint OpenAI-compatible (esse perderia tool use nativo). `claude-sonnet-4-5` suporta structured output no OpenRouter. |

Ambos os pontos de instanciação são centralizados (1 sítio cada), portanto a mudança seria localizada e reversível — confirma a viabilidade técnica, não a legal.

### Gate #4 — Custo + modelos

OpenRouter **não aplica markup ao preço de inferência** — paga-se a tarifa do provider. As taxas de plataforma são: **5,5%** na compra de créditos (pay-as-you-go) ou **5%** em BYOK acima de 1M requests/mês grátis. Para o MVP, o custo extra é marginal e não é o factor decisivo.

### Gate #5 — Fiabilidade / fallback

O fallback automático do OpenRouter entre providers **sobrepõe-se** ao circuit-breaker per-process já existente (`packages/agent/src/circuit-breaker.ts` — 5 falhas/60s → open 30s, half-open probe). Há valor incremental real (failover entre _providers_ vs failover entre _modelos do mesmo provider_), mas é uma vantagem de conveniência, **não um diferenciador que justifique violar o Gate #1**.

---

## Decisão

**NO-GO para produção.** A Fase 0 da auditoria segue como planeado, com chaves **directas**:

1. **`OPENAI_API_KEY`** (directa OpenAI) → Classifier
2. **`ANTHROPIC_API_KEY`** (directa Anthropic) → Executor

Razão única e suficiente: o único caminho do OpenRouter que satisfaz a data residency UE para PII (EU in-region routing + DPA) é enterprise-only e incompatível com o estágio pré-receita do projecto. As directas têm DPAs/SCCs self-serve com base legal RGPD imediata.

### GO-PARCIAL condicional (não acionar agora)

Se no futuro existir tráfego LLM **comprovadamente sem PII** (ex.: classificação de texto sintético, testes de benchmark com fixtures, geração de copy genérico), esse caminho específico poderia usar OpenRouter com ZDR ativo — porque sem dados pessoais não há transferência internacional regulada. **Não é o caso do Classifier nem do Executor da Expressia**, que recebem o prompt cru do utilizador com PII. Logo, sem aplicação prática hoje.

---

## Consequências

**Positivas:**
- Base legal RGPD imediata e self-serve (DPAs directos OpenAI/Anthropic) — sem fricção comercial.
- Caching nativo Anthropic garantido (NFR11) sem intermediário.
- Zero mudança de código face ao que já existe — o executor e classifier já estão escritos para chaves directas.

**Negativas / trade-offs aceites:**
- Duas chaves a gerir em vez de uma.
- Sem fallback automático entre providers (mitigado: circuit-breaker + retry já existentes cobrem o caso de falha transitória do mesmo provider).
- Trocar de modelo exige mudança de config/código (aceitável — não é requisito do MVP).

**Reavaliar quando:**
- A Expressia tiver receita/escala que justifique e custeie um contrato enterprise OpenRouter **e** o EU in-region routing (`eu.openrouter.ai`) + DPA estiverem ativos na conta. Nessa altura, a integração técnica é barata (ver tabela de compatibilidade) e este ADR seria superseded por um ADR-00X.

---

## Provisionamento (o que dizer ao Eurico)

Mantém o plano Fase 0 da auditoria — **não** provisionar OpenRouter agora:

1. Criar `OPENAI_API_KEY` na conta OpenAI (directa) + aceitar/arquivar o DPA OpenAI.
2. Criar `ANTHROPIC_API_KEY` na conta Anthropic (directa) + aceitar/arquivar o DPA Anthropic.
3. Colocar ambas em `apps/web/.env.local` (e secrets Vercel quando deploy).
4. **Não** criar `OPENROUTER_API_KEY` — fica fora de scope até reavaliação enterprise.

---

## Referências

- OpenRouter — Sovereign AI / EU in-region routing (enterprise-only): https://openrouter.ai/docs/guides/features/sovereign-ai
- OpenRouter — Zero Data Retention (todas as contas, não garante residency): https://openrouter.ai/docs/guides/features/zdr
- OpenRouter — Provider Logging / Data Retention: https://openrouter.ai/docs/guides/privacy/provider-logging
- OpenRouter — DPA para GDPR (enterprise, via Trust Portal): https://openrouter.zendesk.com/hc/en-us/articles/47828437697051
- OpenRouter — Prompt Caching (Anthropic ephemeral, sticky routing): https://openrouter.ai/docs/guides/best-practices/prompt-caching
- OpenRouter — Structured Outputs (gpt-4o-mini + Sonnet 4.5): https://openrouter.ai/docs/guides/features/structured-outputs
- OpenRouter — Anthropic Skin / native `/v1/messages` baseURL: https://openrouter.ai/anthropic/
- OpenRouter — Pricing (sem markup; 5,5% créditos / 5% BYOK): https://openrouter.ai/pricing
- Código: `packages/agent/src/providers/anthropic.ts` (linhas 67, 75, 178, 195), `packages/classifier/src/classifier.ts` (linhas 112-116, 300-302), `apps/web/src/app/api/agent/prompt/route.ts` (linhas 714-722), `packages/agent/src/circuit-breaker.ts`
</content>
</invoke>
