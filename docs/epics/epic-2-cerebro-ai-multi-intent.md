# Epic 2 — Cérebro AI Multi-Intent

**Status:** Draft (planning only — não detalhar stories antes de validação Eurico em §8)
**Owner:** @pm (Bob/Morgan)
**Created:** 2026-05-06
**Depends on:** Epic 1 (Foundation) — Done required (1.5, 1.6, 1.7)
**Estimated total effort:** XL (≈ 8-10 stories, mistura S/M/L com 1 XL contida no benchmark)

---

## 1. Visão e Valor de Negócio

A promessa central da Expressia é "uma frase, várias acções". Quando o utilizador escreve `"amanhã reunião às 15h, paguei €78,70 no supermercado e marca a renda como recorrente todo o dia 8"`, a aplicação cria simultaneamente uma tarefa, uma transacção variável e uma recorrência financeira — numa única transacção atómica e em PT-PT natural. Esta capacidade é o **diferenciador estrutural vs Néctar (BR)**, que tecnicamente prova multi-intent mas falha em UX (rating 1,0/5 App Store, sem trial, sem GDPR), e vs assistentes generalistas (ChatGPT, Gemini), que não escrevem nada na base de dados do utilizador nem garantem multi-tenancy.

O valor para o utilizador português operacionaliza-se em três eixos: (1) **velocidade de captura** — a fricção entre "lembrei-me" e "está registado" cai para uma frase, comparável ao Néctar mas com latência p95 < 6s e formato moeda PT-PT correcto (`€78,70`); (2) **confiança** — preview-then-confirm em decisões ambíguas (FR4) e undo de 30s (FR6) tornam o agente "agressivo na captura, conservador na destruição"; (3) **auditabilidade** — `agent_runs` regista cada execução com prompt hash, intents detectadas, ferramentas chamadas e resultado, satisfazendo NFR9 e oferecendo explicabilidade que o Néctar não tem.

A vantagem competitiva é defensável porque assenta sobre as fundações do Epic 1 (RLS multi-tenant, auth, observabilidade UE) que o Néctar não conseguiria copiar sem refactor. Cada tool no `toolRegistry` é tipada (Zod), corre dentro de transacções Postgres e respeita RLS — qualquer competidor que tente clonar o cérebro sem a fundação fica vulnerável a leaks cross-household.

## 2. Objectivo

No fim do Epic 2, um utilizador autenticado num household pode enviar um prompt PT-PT ao endpoint `POST /api/agent/prompt` e ver até N intents simultâneas (ver DP3 em §8) executadas atomicamente em Postgres com RLS preservada, com preview obrigatório se confidence < 0,70, undo válido por 30s via `POST /api/agent/undo/{runId}`, e telemetria fim-a-fim em Grafana — atingindo p95 < 6s e precisão >= 90% sobre 200 prompts curated PT-PT (Epic 2 AC5+AC6 do PRD §6).

## 3. Scope

### IN

- Pipeline 3 estágios: Classifier (GPT-4o-mini) → Planner+Executor (Claude Sonnet com tool calling) → atomicidade Postgres (Architecture §4)
- Provider abstraction: package `packages/agent` com adaptadores Anthropic + OpenAI (criar package — ainda não existe)
- Tool Registry tipado (Zod schemas, `execute(input)` + `reverse(output)`) — versão MVP com tools mínimas
- Schema DB: `agent_runs`, `intent_classifications`, `agent_reverse_ops` (já desenhadas em `db-schema.md` §4.4 — só falta materializar/validar com cargas reais)
- Preview-then-confirm flow para `confidence < 0,70` (FR4)
- Undo mechanism com `expires_at = now() + 30s` (FR6)
- Endpoint `POST /api/agent/prompt` autenticado, com rate limit, RLS context e telemetria OTel
- Endpoint `POST /api/agent/undo/{runId}` com validação ownership + janela 30s
- Cost router básico: `consultar_dados` resolvido direct-DB sem executor; cache Upstash 5min para prompts repetidos (Architecture §4.6)
- Quotas por plano em `agent_quotas` com hard-stop 110% (NFR20)
- Anthropic prompt caching activo no system prompt + tool definitions
- LLM benchmark suite: dataset 200 prompts curated PT-PT + harness `packages/agent-bench` + integração CI nightly
- Observabilidade: métricas `agent.latency.p95`, `agent.intent_accuracy`, `agent.cost.eur_per_household_24h`, `rls.policy_violations_total`

### OUT (adiar para Epic posterior)

- **UI do chat** (chat panel, streaming SSE, preview card UI, undo toast UI) → Epic 5 (Web App UI — Visão e Chat). O Epic 2 expõe APIs e telemetria, não pixels.
- **Tools de domínio Tarefas** completas (`create_task`, `complete_task`, `query_tasks`) — Epic 2 entrega _contract_ + 1-2 tools mínimas para validar a pipeline; o conjunto completo é Epic 3.
- **Tools de domínio Finanças** completas (`create_finance_variable`, `create_finance_recurrence`, `create_card`, `create_installment`, etc.) — mesma lógica: pipeline está pronta, tools cheias entram com Epic 4.
- **Voz e OCR** — fora do MVP (`mvp_scope.md`).
- **Histórico de prompts no chat com persistência conversacional** — Epic 5 (depende de Chat UI).
- **Multi-turn / contexto de conversação** — MVP é stateless single-turn; multi-turn é Fase 2.
- **Re-do** após undo — KISS para MVP (Architecture §4.5).
- **Provider fallback OpenAI/Google para executor** — depende de DP4 em §8.

## 4. Arquitectura Macro

```
┌────────────────────────────────────────────────────────────────────┐
│  Client (browser PT-PT)                                            │
│  POST /api/agent/prompt { prompt, householdId? }                   │
└──────────────────────┬─────────────────────────────────────────────┘
                       │  (Edge middleware: auth + rate limit)
                       ▼
┌────────────────────────────────────────────────────────────────────┐
│  Route handler /api/agent/prompt                                   │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  1) insert agent_runs (status=classifying)                   │  │
│  │  2) cache lookup (Upstash, key=sha256(prompt+household))    │  │
│  │     └─ HIT → return cached + insert run as cached           │  │
│  │  3) classify (GPT-4o-mini) → IntentSchema (Zod)             │  │
│  │     └─ if read-only consultar_dados → direct DB query       │  │
│  │  4) if confidence < 0,70 → return preview card + token      │  │
│  │  5) plan (Claude Sonnet + tool defs from registry)          │  │
│  │     └─ Anthropic prompt cache active                        │  │
│  │  6) BEGIN tx                                                 │  │
│  │     for each tool_call:                                      │  │
│  │       tool.execute(input, ctx, tx)                           │  │
│  │       insert agent_reverse_ops { expires_at = now()+30s }    │  │
│  │     COMMIT                                                    │  │
│  │  7) update agent_runs (status=success, undo_token, cost)    │  │
│  │  8) increment agent_quotas (atomic)                         │  │
│  │  9) emit OTel: latency, cost, intent_accuracy hint          │  │
│  └──────────────────────────────────────────────────────────────┘  │
└──────────────────────┬─────────────────────────────────────────────┘
                       │
                       ▼
                  Response { runId, summary[], undoToken, expiresAt }


  POST /api/agent/undo/{runId}
       │
       ▼
  validate ownership (RLS) + expires_at > now() + reverted_at IS NULL
       │
       ▼
  BEGIN tx → execute reverse_ops in reverse order → COMMIT
       │
       ▼
  update agent_reverse_ops.reverted_at + agent_runs.reverted_at
```

**Estágios em detalhe** (Architecture §4):

| Estágio             | Modelo                             | Output                                                                             | Custo típico/prompt |
| ------------------- | ---------------------------------- | ---------------------------------------------------------------------------------- | ------------------- |
| 1. Classifier       | GPT-4o-mini                        | `ClassificationSchema` (intents[], confidence, language=pt-PT, needs_confirmation) | ≈ €0,00006          |
| 2. Planner+Executor | Claude Sonnet 4.5/5 + tool calling | `tool_calls[]` resolvidos em transacção Postgres                                   | ≈ €0,001-0,005      |
| 3. Atomicidade      | Postgres tx                        | commit único ou rollback total                                                     | DB only             |

**Componentes a criar (não existem ainda):**

- `packages/agent/` — provider abstraction, tool registry, classifier, planner, undo engine
- `packages/agent-bench/` — benchmark harness + dataset 200 prompts PT-PT
- Tabelas `agent_runs`, `intent_classifications`, `agent_reverse_ops`, `agent_quotas` — desenhadas em `db-schema.md` §4.4 mas migrations a aplicar/validar dentro deste epic
- Endpoints `/api/agent/prompt`, `/api/agent/undo/{runId}` em `apps/web/src/app/api/agent/`

## 5. Stories Propostas (alta-nível, ordem sugerida)

| Story | Título                                          | Objectivo (1 frase)                                                                                                                  | Estimate | Dependências                |
| ----- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------- | --------------------------- |
| 2.1   | Schema agent + migrations + RLS                 | Materializar `agent_runs`, `intent_classifications`, `agent_reverse_ops`, `agent_quotas` com 4 policies cada e validar via RLS gate. | M        | Epic 1 (1.3, 1.4, 1.5 Done) |
| 2.2   | Package `packages/agent` + provider abstraction | Criar package com clientes tipados Anthropic + OpenAI, segredos via env, retry/timeout policy, OTel instrumentation.                 | M        | 2.1, Epic 1 (1.7)           |
| 2.3   | Tool Registry contract + 2 tools mínimas        | Definir `ToolDefinition<I,O>` + Zod schemas + registar `create_task_minimal` e `query_tasks_minimal` para validar end-to-end.        | L        | 2.2                         |
| 2.4   | Classifier PT-PT (GPT-4o-mini) + Zod gate       | Implementar classifier com `ClassificationSchema`, retry temperature=0 em deriva, fallback `unknown`.                                | M        | 2.2                         |
| 2.5   | Planner + Executor (Sonnet) + atomicidade       | Pipeline tool calling Sonnet → executor em transacção Postgres com `reverse_op` por tool e prompt cache Anthropic.                   | L        | 2.3, 2.4                    |
| 2.6   | Endpoint `/api/agent/prompt` autenticado        | Route handler com RLS context, rate limit Upstash, OTel traces, error handling padronizado (PT-PT).                                  | M        | 2.5                         |
| 2.7   | Preview-then-confirm flow (FR4)                 | Quando confidence<0,70 ou prefs do user, gerar plan + previewToken (HMAC, 5min) e endpoint de confirmação.                           | M        | 2.6                         |
| 2.8   | Undo mechanism (FR6) + endpoint                 | `POST /api/agent/undo/{runId}` com validação 30s + transacção inversa + Inngest cleanup job.                                         | M        | 2.6                         |
| 2.9   | Cost router + cache + quotas                    | Upstash cache 5min, `consultar_dados` direct-DB, atomic quota increment, hard-stop 110% com mensagem PT-PT.                          | M        | 2.6                         |
| 2.10  | LLM Benchmark Suite (200 prompts PT-PT)         | `packages/agent-bench` com dataset curated, harness precision/recall, CI nightly + alarme <88%.                                      | L        | 2.5                         |
| 2.11  | Observability dashboards Agent Health           | Painel Grafana "Agent Health" (latência, custo, accuracy, RLS denials) + alarmes p95>10s e custo>35% MRR.                            | S        | 2.6, 2.10                   |
| 2.12  | Executor default → Claude Haiku 4.5             | Trocar modelo default do Executor de `claude-sonnet-4-5` para `claude-haiku-4-5-20251001` (migration enum + pricing por modelo + default provider + constantes + testes). | M | 2.5, 2.9 |

**Total estimado:** 12 stories — 2×S, 8×M, 2×L. Story 2.12 adicionada 2026-05-30 (decisão de custo Eurico — ADR-001 NO-GO OpenRouter → optimização de regime via Haiku 4.5).

> Nota: 2.3 entrega _contract_ + 2 tools mínimas. As tools cheias de Tarefas (Epic 3) e Finanças (Epic 4) usam o registry deste epic — não duplicar.

## 6. Riscos Macro

| ID  | Risco                                                                                                                                                  | Probabilidade | Impacto | Mitigação proposta                                                                                                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | **Precisão classifier < 90% em PT-PT** (FR1, AC6 do epic). 200 prompts é dataset pequeno; deriva regional PT-PT vs PT-BR no GPT-4o-mini não é zero.    | Média         | Alto    | Story 2.10 com benchmark CI nightly + alarme <88%; Story 2.4 com retry temp=0 e fallback `unknown`; reservar buffer para fine-tune via prompt engineering em vez de fine-tune do modelo (custo).                                      |
| R2  | **Latência p95 > 6s** (NFR1). Soma classifier+planner+executor+DB pode estourar com Sonnet em prompts longos ou multi-intent ≥3.                       | Média         | Alto    | Anthropic prompt cache (-90% input cost+tempo); cache Upstash 5min p/ prompts repetidos; `consultar_dados` direct-DB sem executor; Story 2.11 alarme em real-time; budget de 4s para LLM, 1s rede, 1s DB.                             |
| R3  | **Custo LLM > 35% MRR rolling 7d** (NFR20). Pro está no limite teórico (30,8% no modelo de §13.1 da architecture). Abuso ou prompts XL podem disparar. | Média         | Alto    | Story 2.9 quotas hard-stop 110%; alarme Grafana 35% rolling 7d (Story 2.11); cache agressivo (Story 2.9); modelo de routing GPT-4o-mini → Sonnet só quando necessário.                                                                |
| R4  | **RLS leak via tool execute** — bug numa tool que aceita `household_id` arbitrário em vez do `current_household_id()` do JWT.                          | Baixa         | Crítico | Tool registry contract obriga `ctx.householdId` derivado do JWT (Story 2.3); RLS gate do Epic 1 já bloqueia tabela sem policy; teste integration cross-household no harness `packages/db-test` (Story 2.5+2.6).                       |
| R5  | **Undo race condition** — utilizador clica undo enquanto outra escrita correu sobre a mesma row.                                                       | Baixa         | Médio   | `reverse_op` em jsonb declarativo (kind=delete_row, restore_row, composite); validação `reverted_at IS NULL`; transacção inversa em ordem reversa (Architecture §4.5); KISS sem re-do (Story 2.8).                                    |
| R6  | **Provider Anthropic outage** — Sonnet inacessível por X minutos = pipeline morto.                                                                     | Baixa         | Alto    | Provider abstraction (Story 2.2) preparada para fallback futuro; circuit breaker com mensagem PT-PT clara ("Serviço temporariamente indisponível, tenta novamente em N min"); Story 2.11 alarme; ver DP4 em §8 sobre fallback OpenAI. |
| R7  | **Anthropic prompt cache não atinge hit rate previsto** — cache invalidado a cada 5min, custo real >> modelo teórico.                                  | Média         | Médio   | Story 2.5 instrumenta `agent.cache_hit_rate` em OTel; budget assumido com pessimismo (cache hit 0%); reavaliar após 30 dias prod.                                                                                                     |
| R8  | **Dataset 200 prompts curated PT-PT inexistente** — risco de scope creep em 2.10 ou de dataset enviesado pelo Eurico/equipa.                           | Alta          | Médio   | Story 2.10 inclui criação curada (não scrap); estratificar por intent, dialecto regional PT (Norte/Lisboa/Açores), e por complexidade (single→multi-intent); revisão @qa antes de aceitar como ground truth.                          |
| R9  | **Atomicidade Postgres falha em multi-tool** — uma tool dá throw mid-tx, rollback funciona mas user vê resposta ambígua.                               | Baixa         | Médio   | Story 2.5 wrapper de transacção com try/catch + rollback automático; resposta agregada inclui `partial_failure: false` invariant; teste integration "explode tool 2 de 3" deve rollback as 3.                                         |
| R10 | **Custom claim `household_id` no JWT desactualiza** — user mudou de household activo mas JWT ainda tem o antigo (cache 1h).                            | Baixa         | Médio   | Endpoint `/api/auth/switch-household` força refresh JWT (Architecture §5.2 — Epic 1); Story 2.6 valida `current_household_id()` em cada request.                                                                                      |

## 7. Dependências Críticas

**Internas (Epic 1 — devem estar Done):**

- **Story 1.3** (Supabase + Drizzle): tabelas `households`, `household_members`, helper `current_household_id()`. Sem isto, schema agent não tem FK target nem RLS context.
- **Story 1.5** (Auth + RLS Integration): JWT custom claim `household_id` injectado pelo `custom_access_token_hook`. Sem isto, RLS no agent_runs não funciona.
- **Story 1.6** (Endpoint canary `/api/me`): prova que o pattern auth+RLS+route handler funciona end-to-end. Epic 2 reusa exactamente o mesmo pattern.
- **Story 1.7** (Observability OTel + Sentry EU + Grafana EU): OTel SDK obrigatório para emitir métricas do agente. Sem isto, Story 2.11 não pode entregar dashboard Agent Health.

**Externas (acção Eurico/@devops antes de Story 2.2 começar):**

- **Anthropic API key** com tier Sonnet 4.5/5 e DPA UE assinado (Architecture §12.2 risco residual). Conta com modo "no training" e "zero retention" pedidos via configuração.
- **OpenAI API key** com tier GPT-4o-mini, DPA + zero retention.
- **Upstash Redis EU project** (`eu-west-1`) — usado para cache 5min, rate limit e quota cache.
- **Inngest EU function** para `cleanup_expired_reverse_ops` (cron diário). Já provisionado no Epic 1 §11.3 mas precisa de função registada.
- **Validação Eurico das DPs em §8** antes de detalhar stories 2.7, 2.8, 2.9.

**Bloqueadores cross-epic:**

- Tools cheias de Tarefas (Epic 3) e Finanças (Epic 4) **dependem deste epic**, mas o caminho inverso é falso: Epic 2 entrega só 2 tools mínimas para validar a pipeline. Não bloquear Epic 2 à espera de schema completo de Tarefas/Finanças.

## 8. Decisões Pendentes (Eurico tem de validar antes de detalhar stories)

| ID      | Decisão                                                                                                     | Opções                                                                                                                                                                                                                                                                            | Recomendação preliminar                                                                                                                                                                                                           |
| ------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **DP1** | **Modelo de undo** — janela 30s só (spec actual FR6) ou também undo persistente "últimos 5 prompts"?        | A) 30s só (KISS, spec actual) — undo é "ah, errei, anula"; passada a janela, edição manual. B) 30s + histórico "últimos 5" com botão revert no chat (sem expiry) — UX premium, mais complexo (snapshots completos, conflitos com escritas posteriores).                           | A para MVP. Story 2.8 entrega janela 30s. Histórico 5-prompts é Fase 2 e exige design dedicado de conflict resolution. Mas Eurico decide.                                                                                         |
| **DP2** | **Threshold preview-then-confirm** — 0,70 fixo (FR4) ou UX "sempre preview" no MVP?                         | A) 0,70 fixo (FR4, spec actual) — agente "agressivo na captura", utilizador confia. B) Sempre preview no MVP — utilizador confirma cada acção, fricção alta mas zero arrependimento. C) Toggle por utilizador em `/conta/preferencias` (default A, opt-in B).                     | C com default A. Architecture §4.4 já prevê `ctx.userPrefs.alwaysPreview`. Story 2.7 adiciona toggle. Custo: 1 ponto de schema (`users_prefs.always_preview`).                                                                    |
| **DP3** | **Multi-intent — quantas operações máx por prompt?**                                                        | A) Sem limite (Sonnet decide). B) Hard-cap 5 ops/prompt (rejeita >5 com mensagem PT-PT). C) Hard-cap 3 ops/prompt (segurança, força utilizador a fragmentar).                                                                                                                     | B (5). >5 ops num prompt indica intent ambíguo ou abuso; 5 cobre 99% dos casos reais ("compras de hoje: pão €1,20, leite €0,89, ovos €2,10, queijo €3,50, fruta €4,30"). Threshold é parametrizável via env.                      |
| **DP4** | **Provider lock-in vs flexibility** — Anthropic Sonnet exclusivo OU também suportar OpenAI/Google fallback? | A) Anthropic exclusivo (KISS, prompt caching nativo, custo previsível). B) Provider abstraction com fallback OpenAI GPT-4o em outage (resiliência, mais código). C) Multi-provider sempre activo com routing por custo/latência (caro de manter, decisão complexa de routing).    | B. Story 2.2 entrega abstraction. Fallback OpenAI implementa-se em Fase 2 (toggle behind flag) — só activa quando Anthropic outage detectado por circuit breaker. Custo: schema do `ToolDefinition` tem de ser provider-agnostic. |
| **DP5** | **Prompt caching budget** — qual é o limite de tokens por sessão antes de invalidar cache?                  | A) Cache standard Anthropic (5min ephemeral, ~3-5k tokens system+tools). B) Cache extended (1h, custo +25% input mas hit rate maior). C) Sem cache (custo previsível, latência maior).                                                                                            | A. Modelo de custo de §13.1 assume cache standard. Story 2.5 instrumenta `cache_hit_rate` para reavaliar após 30 dias prod. Tool definitions JSON não devem crescer >5k tokens — Story 2.3 enforce esse budget.                   |
| **DP6** | **Tools mínimas de validação na Story 2.3** — quais?                                                        | A) `create_task_minimal` + `query_tasks_minimal` (toca módulo Tarefas — Epic 3 reusa). B) `create_finance_variable_minimal` + `query_finance_summary` (toca módulo Finanças — Epic 4 reusa). C) Tools mock que escrevem numa tabela `agent_demo` (zero acoplamento com domínios). | A. Tarefas é o domínio com schema mais simples (`tasks` já no `db-schema.md` §4.5). C cria dívida (tabela demo a remover). Tools cheias entram no Epic 3 sem rework.                                                              |
| **DP7** | **Trial 14 dias inclui quota cheia ou Free?** (cruza com Architecture §6.4 que assume trial=Família)        | A) Trial=Família com quota Família (3000 prompts/mês). B) Trial=Pessoal (1500 prompts/mês). C) Trial unlimited (custo risk).                                                                                                                                                      | A. Já decidido na Architecture mas **flag para Eurico confirmar consistência com Story 2.9** (quota enforcement).                                                                                                                 |
| **DP8** | **Logging do prompt em `agent_runs`** — hash apenas (NFR12) ou texto cifrado para debug?                    | A) Hash apenas (spec actual NFR12, GDPR-friendly). B) Texto cifrado em column `prompt_encrypted` com chave em vault, decrypt manual para debug em incidente. C) Texto claro em log retido 7d depois purge (risco GDPR).                                                           | A. NFR12 é claro. Debug via repro local com prompt re-enviado pelo user em ticket.                                                                                                                                                |

## 9. Métricas de Sucesso

**Métricas de produto (epic Done quando atingidas em ambiente staging com dataset real):**

- **AC PRD:** Latência p95 multi-intent < 6s sobre 200 prompts curated PT-PT (NFR1, Epic 2 AC5)
- **AC PRD:** Precisão classificação >= 90% sobre 200 prompts curated (Epic 2 AC6)
- **AC PRD:** Prompt "amanhã reunião às 15h, paguei €78,70 no supermercado" cria 1 evento + 1 finança numa única chamada (Epic 2 AC1)
- **AC PRD:** Prompt ambíguo (confidence<0,70) dispara preview de confirmação (Epic 2 AC2)
- **AC PRD:** `agent_runs` regista cada execução com prompt hash, intents, params, resultado (Epic 2 AC3)
- **AC PRD:** Undo reverte última operação dentro de 30s (Epic 2 AC4)

**Métricas operacionais:**

- Custo LLM médio por household activo Família: ≤ €2,66/mês (30% MRR — NFR20, Architecture §13.1)
- Cache hit rate Upstash: ≥ 15% após 7 dias prod (re-avaliar)
- Cache hit rate Anthropic prompt cache: ≥ 60% em horário de pico
- Zero RLS leaks em testes integration cross-household (NFR5)
- Zero secrets expostos em logs (NFR8, NFR12)

**Métricas de negócio (medidas após launch, não no fim do epic):**

- % de utilizadores que usam pelo menos 1 prompt multi-intent na primeira semana >= 40% (proxy de PMF do diferenciador)
- % de prompts que disparam preview-confirm <= 25% (alto = classifier mau; baixo = utilizador confia)
- % de prompts undo dentro de 30s <= 5% (alto = agente errático)

## 10. FRs/NFRs Cobertos

**Functional Requirements (do PRD §2.1):**

- **FR1** — Aceitar prompt PT-PT e classificar em 1+ intents simultâneas (criar_tarefa, criar_financa_variavel, criar_financa_recorrente, criar_cartao, criar_parcelada, consultar_dados)
- **FR2** — Executar múltiplas intents na mesma transacção ou compensar em falha parcial; devolver resumo agregado
- **FR3** — Audit log com prompt original (hash, NFR12), intents, parâmetros, decisão, utilizador
- **FR4** — Preview-then-confirm quando confidence < 70%
- **FR5** — Suportar consultas analíticas em PT-PT ("como estão as minhas finanças este mês") com resposta texto + dados estruturados
- **FR6** — Cancelar/reverter última operação via comando ("cancela", "anula") ou botão undo (30s)

**Non-Functional Requirements (do PRD §2.2):**

- **NFR1** — Latência p95 prompt multi-intent < 6s
- **NFR5** — RLS Postgres activa em `agent_runs`, `intent_classifications`, `agent_reverse_ops`, `agent_quotas` (gate CI obrigatório)
- **NFR9** — Audit log imutável retido 12 meses
- **NFR11** — Data residency UE (Anthropic/OpenAI são excepção documentada — ver Architecture §12.2)
- **NFR12** — Prompts não loggados em texto claro; só hash sha256
- **NFR13/14/15** — OTel + métricas + alarmes (Story 2.11)
- **NFR20** — Custo LLM ≤ 30% MRR Pessoal
- **NFR21** — Router GPT-4o-mini classificação + Claude Sonnet execução

**Constraints (do PRD §2.3):**

- **CON3** — PT-PT exclusivo (classifier instruído PT-PT, dataset 200 prompts PT-PT, mensagens de erro PT-PT)
- **CON5** — Imports absolutos `@meu-jarvis/agent` em todo o package
- **CON8** — Cada story validada por @po antes de @dev implementar
- **CON9** — Moeda EUR, formato PT-PT (vírgula decimal `€78,70`)

## Change Log

| Versão | Data       | Autor            | Mudanças                                                                                                  |
| ------ | ---------- | ---------------- | --------------------------------------------------------------------------------------------------------- |
| v0.1   | 2026-05-06 | Bob (@pm Morgan) | Draft inicial — skeleton + 11 stories alta-nível + 10 riscos + 8 decisões pendentes para validação Eurico |

---

*Documento de planeamento por Bob (PM AIOX) em 2026-05-06. Stories detalhadas só podem ser criadas (`@sm *draft 2.1`) depois de:\*
_1) Eurico validar as decisões pendentes em §8 (mínimo DP1, DP2, DP3, DP4, DP6 — DP5/DP7/DP8 podem cair em pre-flight da story)._
_2) Epic 1 estar Done (1.5 + 1.6 + 1.7)._
_3) Anthropic API key + OpenAI API key + Upstash Redis EU provisionados pelo @devops._

_Toda decisão técnica é rastreável a FR/NFR/CON do PRD ou ADR da Architecture, conforme Constitution Article IV — No Invention._
