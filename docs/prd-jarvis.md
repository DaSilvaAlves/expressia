# PRD — Jarvis (Fase 1: Brief Diário Proactivo no Telegram)

**Autor:** Morgan (Product Manager AIOX)
**Data:** 22/06/2026
**Versão:** 1.1 (Fase 1 — espinha; validado @architect CONCERNS 8/10 + @po GO 8,5/10, 22/06; fixes aplicados)
**Estado:** Aprovado para avançar. Âmbito da Fase 1 fechado — ver §10. Fixes de validação F1–F6 + PO-FIX-1 incorporados.
**Fonte de direcção:** `docs/jarvis-north-star.md` (visão v2 — fonte de verdade)
**Origem:** handoff `mj-handoff-jarvis-prd-fase1-telegram-brief-20260622.yaml`

> **Substitui** o paradigma de `docs/prd.md` v1.1 ("SaaS família-first com dashboard tarefas/finanças"). Decisão do Eurico (21/06/2026): **refazer, não rever** — é outro produto. O `docs/prd.md` antigo fica como histórico.
>
> **Constraints inegociáveis:** PT-PT exclusivo (europeu). Dados na UE (Vercel `fra1` + Supabase `eu-central-1`). Confiança/privacidade de topo (email e diário = dados íntimos). Disciplina da espinha — profundidade antes de largura.

---

## 1. Visão e posicionamento

**Jarvis é um assistente de vida conversacional, proactivo, que conhece o Eurico.**

Acorda com ele e fala primeiro. Sabe a agenda, as tarefas, as finanças (e, ao longo do tempo, hábitos, email e diário). A **conversa é o produto** — tarefas e finanças são apenas duas de N capacidades que o assistente orquestra. Referência mental: o Jarvis do Homem de Ferro — um assistente de *vida*, não uma app de *produtividade*.

### O que isto NÃO é

- ❌ Um dashboard de tarefas/finanças com um chat encostado ao lado (foi a v1 anterior — Expressia).
- ❌ Uma app web onde o utilizador navega menus e preenche formulários. **Na Fase 1 não há web app de utilizador.**
- ❌ Um SaaS família-first PT-PT de gestão doméstica (paradigma antigo, congelado).
- ❌ Voz/TTS-STT (isso é v2.x).
- ❌ Multi-utilizador, onboarding multi-passo ou billing (isso é v3 / congelado).

### O coração da Fase 1

A **conversa muda de superfície:** deixa de ser um painel lateral numa web app e passa a ser **a casa do produto** — um **bot de Telegram** que o Eurico usa todos os dias. O motor cognitivo já provado (classificar → planear → executar, com undo) passa a ser a *camada de acções* atrás dessa conversa.

---

## 2. Estratégia pessoal → SaaS e métrica de sucesso

**Decisão Eurico (21/06/2026):** construir primeiro o Jarvis *pessoal do Eurico* (um único utilizador real), provar a visão e só depois generalizar para vender.

| Princípio | Implicação na Fase 1 |
|-----------|----------------------|
| Pessoal agora | A v1 optimiza para o Eurico, não para um mercado. Single-user via allowlist de `chat_id`. Sem onboarding, sem billing, sem multi-tenant a complicar. |
| SaaS depois | A infra de tenancy (`household_id` + RLS + região UE) **fica intacta** por baixo. É a porta aberta para o SaaS futuro (v3), não trabalho a desfazer. |
| Disciplina da espinha | A Fase 1 é **só o brief diário**, até estar excelente. Profundidade antes de largura. |

### Métrica de sucesso da Fase 1

**Não é conversão nem MRR.** É comportamental e simples:

> **O Eurico ser acordado pelo Jarvis todos os dias e responder-lhe em conversa — porque tem valor real.**

KPIs operacionais (todos sobre 1 utilizador):

| KPI | Alvo Fase 1 |
|-----|-------------|
| Briefs entregues / dias activos | ≥ 95% (o brief chega de manhã, fiável) |
| Dias com pelo menos 1 resposta-em-conversa do Eurico ao brief | ≥ 60% numa janela de 2 semanas |
| Acções executadas via conversa com sucesso (sem ter de abrir a web app) | a maioria das intenções do dia-a-dia (tarefas/finanças) |
| "Sentiu-se útil?" — avaliação qualitativa do próprio Eurico após 2 semanas | go/no-go para alargar (v1.1) |

---

## 3. Experiência v1 — day-in-the-life no Telegram

### 3.1 O brief da manhã (proactivo)

Às 07:30 (Europe/Lisbon — confirmado; cron Inngest com `TZ=Europe/Lisbon`, ver §4.5), o Jarvis **fala primeiro** no Telegram. Exemplo concreto do tom-alvo (composto pelo LLM em PT-PT natural, não uma lista de widgets):

> **Bom dia, Eurico.** Hoje tens 3 coisas na agenda — a primeira é às 10h, reunião com a Ana. Tens 1 tarefa para hoje ("enviar proposta") e 1 atrasada de ontem ("ligar à contabilista"). Ontem gastaste 78,70 €; este mês vais em 1.240 €. Queres que trate de alguma coisa?

Composição: agenda (Google Calendar) + tarefas (hoje + atrasadas) + finanças (resumo do mês + ontem). Email entra na v1.1.

### 3.2 Fluxos de resposta-em-conversa

O Eurico responde ao brief (ou escreve a qualquer hora) e o Jarvis **age**, reutilizando o motor classificar → planear → executar. Três fluxos concretos:

**Fluxo A — adicionar tarefa**
> Eurico: *"adiciona tarefa: comprar prenda para a mãe até sexta"*
> Jarvis: *"Feito. Criei a tarefa 'comprar prenda para a mãe' com prazo sexta, 27/06. (Cancelar)"*
> — `(Cancelar)` é um botão inline do Telegram, activo 30 s, ligado ao undo existente.

**Fluxo B — registar despesa**
> Eurico: *"gastei 23 euros no almoço"*
> Jarvis: *"Registei uma despesa de 23,00 € (almoço) na conta Dinheiro. (Cancelar)"*

**Fluxo C — confiança baixa → preview antes de agir**
> Eurico: *"trata daquilo do carro"*
> Jarvis: *"Não tenho a certeza do que queres. Achas que é: criar uma tarefa 'tratar do carro'? Responde **sim** para confirmar ou diz-me o que é."*
> — Mapeia o `needs_confirmation` (confidence < 0,70) já existente; o cartão de preview da web passa a ser uma pergunta no chat com botões inline.

**Nota de âmbito:** "reagenda a reunião para as 11h" e "responde ao email do Y" (escrita em Calendar/Gmail) **não estão na Fase 1** — são v1.1. A Fase 1 lê a agenda mas não a escreve; acção via conversa cobre tarefas e finanças (que já têm tools provadas). Ver §6 (FR) e §9 (roadmap).

---

## 4. Arquitectura da Fase 1

### 4.1 Princípio de encaixe no monorepo

A web app Next.js (`apps/web`) **deixa de ser a casa** e passa a host do backend: continua a alojar os endpoints, o cliente Postgres, os Inngest functions e o motor de acções. O bot de Telegram é uma **nova superfície** servida por esse mesmo backend.

**Decisão de localização [CONFIRMADO Eurico 22/06]:** o webhook do Telegram e os helpers da Bot API vivem como **rotas e libs dentro de `apps/web`** (`apps/web/src/app/api/telegram/webhook/route.ts` + `apps/web/src/lib/telegram/`), reutilizando o runtime serverless `fra1` já configurado, sem novo deploy target. A lógica reutilizável (síntese do brief, adaptador do motor) pode ser extraída para um package novo `@meu-jarvis/jarvis` se crescer; na Fase 1 começa em `apps/web` para minimizar superfície. *Alternativa rejeitada:* novo serviço/app dedicado — adiciona deploy e observabilidade duplicados sem benefício na espinha (over-engineering contra a disciplina da espinha).

### 4.2 Componentes da Fase 1

```
                         ┌──────────────────────────────────────────┐
                         │  Telegram (app do Eurico)                 │
                         └───────────────┬──────────────────────────┘
        mensagens do Eurico              │            ▲ brief + respostas (Bot API sendMessage)
                         ▼               │            │
┌────────────────────────────────────────────────────────────────────────┐
│ apps/web (Vercel fra1)                                                   │
│                                                                          │
│  POST /api/telegram/webhook   ── allowlist chat_id ──┐                   │
│        (recebe updates)                              │                   │
│                                                      ▼                   │
│  lib/telegram/  (verify secret, sendMessage,   ┌──────────────────────┐  │
│                  botões inline, mapeamento     │ Motor de acções       │  │
│                  resposta→intenção)            │ (já existe e provado) │  │
│                                                │  @meu-jarvis/classifier│ │
│  INNGEST cron 'morning-brief' (Europe/Lisbon)  │  @meu-jarvis/planner- │  │
│   ├─ agrega Calendar + tarefas + finanças      │      executor          │ │
│   ├─ LLM compõe brief PT-PT (síntese)          │  @meu-jarvis/tools     │ │
│   └─ Bot API → envia ao chat_id do Eurico      │  (toolRegistry,        │ │
│                                                │   executeAtomic, undo) │ │
│  lib/google/  (OAuth + ler eventos de hoje) ───┘└──────────────────────┘  │
└──────────────────────────────┬───────────────────────────────────────────┘
                               ▼
              Supabase Postgres eu-central-1 (RLS, household_id intacto)
              + tabelas novas: telegram_link, google_oauth_tokens, jarvis_facts
```

### 4.3 Bot do Telegram (webhook + envio proactivo) — NOVO

| Aspecto | Decisão |
|---------|---------|
| Receber mensagens | Webhook `POST /api/telegram/webhook` (Telegram envia updates). Preferir webhook a long-polling — alinha com serverless `fra1`. |
| Verificar autenticidade | Cabeçalho `X-Telegram-Bot-Api-Secret-Token` validado contra segredo configurado no `setWebhook`. Pedidos sem segredo correcto → 401 silencioso. |
| Identidade / allowlist | **Single-user:** só o `chat_id` do Eurico (na allowlist) é processado. Qualquer outro `chat_id` é ignorado (não responde — evita expor o bot). |
| Envio proactivo | Bot API `sendMessage` para o `chat_id` do Eurico, a partir do cron do brief e das respostas de acção. |
| Botões de acção | `inline_keyboard` para `(Cancelar)` (undo 30 s) e `sim/não` (confirmação de preview). `callback_query` tratado pelo mesmo webhook. |
| Token do bot | `TELEGRAM_BOT_TOKEN` em Vercel Env (UE). Nunca commitado. |

### 4.4 Integração Google Calendar (OAuth) — NOVO

| Aspecto | Decisão |
|---------|---------|
| Âmbito OAuth | `calendar.readonly` (ler eventos de hoje). **Apenas leitura na Fase 1** — escrever/reagendar é v1.1. |
| Fluxo de consentimento | OAuth single-user, uma vez. O Eurico autoriza; o `refresh_token` é guardado **cifrado** (ver cifragem abaixo e §7). |
| Armazenamento de tokens | Tabela nova `google_oauth_tokens` (single-row para o Eurico na Fase 1), com `household_id` + RLS. O `refresh_token` é cifrado em repouso a nível **aplicacional**. |
| Cifragem (F2/PO-FIX-4 — TRABALHO NOVO) | **Não existe hoje infra de cifragem no repo** (um `grep` por `createCipheriv`/`aes` devolve apenas cache/redaction). Decisão: cifrar a nível aplicacional com **AES-256-GCM** via `node:crypto` (`createCipheriv`/`createDecipheriv`), guardando `iv` + `authTag` junto do ciphertext na coluna. A **chave de cifragem** (`OAUTH_TOKEN_ENCRYPTION_KEY`, 32 bytes) vive em Vercel Env (UE), nunca em git nem na DB. *Alternativa rejeitada:* pgcrypto / Supabase Vault — empurraria o segredo para dentro da DB (mistura blast-radius de uma fuga de DB com o da chave) e é menos portável para o futuro multi-provider; a cifragem aplicacional mantém a chave fora do Postgres e usa só a stdlib do Node (sem dependência nova). |
| Leitura | Lista de eventos do dia (timeMin/timeMax = hoje, Europe/Lisbon) no momento da composição do brief. Decifra o `refresh_token` em memória, troca-o por um access token, descarta. |
| Fallback | Se a chamada falhar ou o token expirar sem refresh, o brief continua (agenda omitida com nota "não consegui ler a tua agenda hoje") — o brief nunca falha por causa de uma fonte. |

### 4.5 Job Inngest do brief (cron de manhã) — NOVO

| Aspecto | Decisão |
|---------|---------|
| Localização | `apps/web/src/lib/inngest/functions/morning-brief.ts` (junto aos jobs existentes). |
| Trigger | Cron Inngest nativo com fuso horário **fixado**: `{ cron: 'TZ=Europe/Lisbon 30 7 * * *' }`. O Inngest suporta o prefixo `TZ=` nativamente, logo dispara às **07:30 hora local de Lisboa** sem aritmética manual de UTC. **Sem problema de DST:** 07:30 não cai na janela de transição de Lisboa (a mudança ocorre às 01:00/02:00), pelo que corre exactamente 1×/dia de forma consistente em horário de verão e de inverno. |
| Identidade / iteração | O cron itera a tabela `telegram_link` (1 linha na Fase 1 — o Eurico) e, **por linha**, obtém `{ userId, householdId, chat_id }`, compõe o brief desse utilizador e envia-o ao seu `chat_id`. Define o contrato para o v3 multi-utilizador (N linhas → N briefs), sem refazer a lógica. |
| Agregação | Reutiliza os agregadores já existentes em `apps/web/src/lib/visao/queries.ts` (`getTasksToday`, `getTasksOverdue`, finanças do mês) + a nova leitura do Calendar. |
| Síntese | Passa os dados agregados ao LLM, que compõe o brief em PT-PT natural (ver §4.7). |
| Entrega | Envia via Bot API ao `chat_id` resolvido em `telegram_link`. |
| Idempotência | Um brief por dia por utilizador; se o job correr duas vezes, não duplica (chave de dedupe por `{ householdId, dia }`). |
| Acesso a dados | O job corre fora de sessão de utilizador → usa o core puro `runAgentForHousehold` / leituras com `{ userId, householdId }` resolvido de `telegram_link` (ver §4.6), que faz `SET LOCAL ROLE` + claims via `withHousehold` — **RLS viva, sem sessão Supabase**. Não depende de `getServiceDb()` para os dados do utilizador. |

### 4.6 Ligação ao motor de acções existente — e o maior item de engenharia da Fase 1

O motor cognitivo de baixo nível já está provado e **não se reescreve**:

- **`@meu-jarvis/classifier`** — `Classifier.classify()` devolve intents tipadas + confiança. **Provado a 95%** (benchmark real 21/06: 190/200, p95 ~2014 ms).
- **`@meu-jarvis/planner-executor`** — planner + executor com tool calling.
- **`@meu-jarvis/tools`** — `toolRegistry` + `executeAtomic` (transacção atómica) + reverse-op para undo.

#### O problema (PO-FIX-5 / F1): o pipeline está colado a Supabase Auth

A orquestração de referência vive em `apps/web/src/app/api/agent/prompt/route.ts`, mas **não é hoje reutilizável fora de uma sessão HTTP do browser**. O handler está acoplado a:

- `supabase.auth.getUser()` (resolve a identidade a partir do cookie de sessão Supabase — `route.ts` ~linha 191);
- `resolveHouseholdId(user.id)` (query PostgREST a `household_members` que **exige sessão Supabase** — ~linha 206);
- o mesmo padrão nas sub-rotas `[runId]/undo/route.ts` e `[runId]/confirm/route.ts`.

O Telegram não tem sessão Supabase — a identidade vem do `chat_id`. Logo, **o maior item de engenharia da Fase 1 é extrair o core do pipeline para uma função pura**, independente da camada de auth HTTP:

```ts
// Forma-alvo (nova) — apps/web/src/lib/agent/run-agent.ts (ou package @meu-jarvis/jarvis)
runAgentForHousehold({ userId, householdId, prompt }): Promise<AgentResult>
//   classifier → cache → cost-router → preview-gate → executeAtomic → undo
//   SEM supabase.auth.getUser(), SEM resolveHouseholdId.
```

- A rota HTTP existente (`/api/agent/prompt`) passa a ser um **wrapper fino**: resolve `{userId, householdId}` via Supabase Auth e chama `runAgentForHousehold`.
- O **webhook do Telegram** e o **cron do brief** resolvem `{userId, householdId}` via `telegram_link` (ver §4.8) e chamam a mesma função. Sem duplicar o pipeline.

#### Porque NÃO há buraco de RLS/tenancy

O motor de baixo nível **já está pronto** para receber o par `{userId, householdId}` directamente — o desacoplamento é da camada de auth, não do enforcement:

- **`withHousehold(auth: { userId, householdId }, fn)`** (`packages/db/src/client.ts:110`) só precisa do par — faz `SET LOCAL ROLE authenticated` + `set_config('request.jwt.claims', …)` + `set_config('app.current_household_id', …)`. A 2.ª rede (RLS via `SET LOCAL`) mantém-se viva.
- **`executeAtomic(tools, ctx, txRunner?)`** (`packages/tools/src/atomic.ts:126`) recebe um `TxRunner` **injectável**; em produção é `(fn) => withHousehold({ userId, householdId }, fn)`.
- A 1.ª rede (filtro `household_id` app-enforced, SEC-1) mantém-se intacta — defense-in-depth.

> **Directive (lição SEC-8.1):** os testes do bot e do cron **têm de exercer código de produção real** (o `withHousehold` real + `executeAtomic` com o `txRunner` de produção contra Postgres real), **nunca mocks** do caminho de tenancy. A regressão SEC-8.1 passou despercebida precisamente porque os gates corriam mocks/harness em vez do `pgSql.begin` real. O gate de RLS tem de validar o caminho que vai para produção.

#### O adaptador Telegram → motor (NOVO)

Ao receber uma mensagem do Eurico, o adaptador:
1. Resolve `{userId, householdId}` de `telegram_link` a partir do `chat_id`.
2. Chama `runAgentForHousehold({ userId, householdId, prompt })`.
3. Traduz o resultado para uma mensagem de Telegram (texto + botões inline).
4. Mapeia `needs_confirmation` → pergunta de confirmação no chat; `undo` → botão `(Cancelar)` 30 s.

### 4.7 Síntese conversacional (NOVO)

O brief **não** é uma concatenação de widgets. Um passo de LLM (Claude, já integrado via `@meu-jarvis/agent` providers) recebe os dados agregados (estruturados) e devolve um parágrafo natural em PT-PT, com o tom do exemplo §3.1. Prompt de sistema versionado (à semelhança de `packages/classifier/src/prompts/` e `packages/planner-executor/src/prompts/`). Determinismo controlado (temperatura baixa) para consistência de tom.

### 4.8 Como a identidade single-user (`chat_id`) coexiste com `household_id`/RLS

Esta é a peça-chave da estratégia pessoal→SaaS:

- O Eurico continua a ter o seu `user_id` (Supabase Auth) e o seu `household_id` (a tenancy não se remove).
- Uma tabela nova **`telegram_link`** mapeia `chat_id` (Telegram) → `user_id` / `household_id`. Na Fase 1 tem uma linha (o Eurico), gerida por allowlist/seed; sem UI de associação.
- O webhook resolve `chat_id` → `{ userId, householdId }` via `telegram_link`, e passa esse par a `runAgentForHousehold` (ver §4.6), que injecta o contexto via `withHousehold` (tal como o JWT injecta hoje). As tools continuam a correr RLS-scoped ao `household_id`.
- **O cron do brief usa a mesma tabela como fonte de identidade:** itera `telegram_link` e, por linha, obtém `{ userId, householdId, chat_id }`, compõe e envia o brief desse utilizador. Na Fase 1 há 1 linha (o Eurico); o mesmo código serve N linhas no v3, sem alteração de lógica — `telegram_link` **é o contrato de identidade** para a generalização SaaS.
- **Resultado:** o single-user da Fase 1 é uma *allowlist por cima* de uma infra multi-tenant intacta. Quando chegar o v3 (SaaS), `telegram_link` passa a ter N linhas e o onboarding cria a associação — sem refazer a base.

---

## 5. Reaproveita vs novo

Ancorado na north-star §3 e em ficheiros reais do repo.

| Capacidade | Estado | Onde (real) |
|------------|--------|-------------|
| Classificador de intenções (95% provado) | ♻️ Reutiliza | `packages/classifier/` (`Classifier`, `INTENT_VALUES`) |
| Planner + Executor (tool calling) | ♻️ Reutiliza | `packages/planner-executor/` |
| Tool registry + execução atómica + undo 30 s | ♻️ Reutiliza | `packages/tools/` (`toolRegistry`, `executeAtomic`); reverse-ops em `agent_reverse_ops` |
| Providers LLM (Anthropic/OpenAI, retry, circuit-breaker, redaction) | ♻️ Reutiliza | `packages/agent/` |
| Orquestração do prompt (cache, cost-router, preview-gate) | ♻️ Reutiliza / adapta | `apps/web/src/app/api/agent/prompt/route.ts`, `apps/web/src/lib/agent/` |
| Tarefas (tools) | ♻️ Reutiliza | `packages/tools/src/tasks/` |
| Finanças (tools, conta Dinheiro default) | ♻️ Reutiliza | `packages/tools/src/finance/` |
| Agregadores para o brief | ♻️ Reutiliza | `apps/web/src/lib/visao/queries.ts` + `/api/visao/*` |
| Stub do briefing (já antecipa "LLM via Inngest job nocturno") | ♻️ Evolui | `apps/web/src/app/api/visao/briefing/route.ts` |
| Auth, RLS (104 policies), região UE | ♻️ Reutiliza (intacto) | `packages/auth/`, `packages/db/`, migrations RLS |
| Observabilidade (OTel/Sentry/Grafana) | ♻️ Reutiliza | `packages/observability/` |
| Jobs Inngest (cron) | ♻️ Reutiliza (padrão) | `apps/web/src/lib/inngest/functions/` |
| **Bot do Telegram (webhook + Bot API + allowlist)** | 🆕 Novo | `apps/web/src/app/api/telegram/webhook/route.ts`, `apps/web/src/lib/telegram/` |
| **Integração Google Calendar (OAuth readonly)** | 🆕 Novo | `apps/web/src/lib/google/` |
| **Job Inngest do brief da manhã** | 🆕 Novo | `apps/web/src/lib/inngest/functions/morning-brief.ts` |
| **Síntese conversacional do brief (LLM)** | 🆕 Novo | prompt versionado + passo LLM |
| **Memória/factos básicos do utilizador** | 🆕 Novo (mínimo na v1) | tabela `jarvis_facts` |
| **Mapeamento `chat_id` → household** | 🆕 Novo | tabela `telegram_link` |
| Web app como casa do produto | 🔻 Despromovida | `apps/web` passa a host do backend; UI de utilizador não é foco da Fase 1 |

---

## 6. Requisitos funcionais e não-funcionais (Fase 1)

### 6.1 Requisitos funcionais

| ID | Requisito | Acceptance Criteria (testável) |
|----|-----------|--------------------------------|
| **FR-J1** | Bot de Telegram recebe mensagens do Eurico via webhook. | (a) `POST /api/telegram/webhook` aceita updates válidos do Telegram; (b) valida o secret token no cabeçalho; (c) pedido sem secret correcto → 401, sem processar. |
| **FR-J2** | Allowlist single-user. | (a) Só o `chat_id` do Eurico é processado; (b) qualquer outro `chat_id` é ignorado silenciosamente (sem resposta, registado em log). |
| **FR-J3** | Envio proactivo do brief da manhã. | (a) O cron Inngest `TZ=Europe/Lisbon 30 7 * * *` dispara **1×/dia às 07:30 hora local** — validável em ambiente de teste (ex.: simular a expressão cron em horário de verão e de inverno e confirmar que resolve para 07:30 local, sem disparo duplo nem saltado na transição DST); (b) o brief chega ao `chat_id` do Eurico; (c) execução repetida no mesmo dia não duplica o brief (dedupe por `{ householdId, dia }`). |
| **FR-J4** | O brief agrega Calendar + tarefas + finanças. | (a) Inclui eventos de hoje do Google Calendar; (b) inclui tarefas para hoje + atrasadas; (c) inclui resumo financeiro (gasto de ontem + total do mês); (d) se uma fonte falhar, o brief é entregue na mesma, com nota da fonte em falta. |
| **FR-J5** | Síntese conversacional em PT-PT natural. | (a) O brief é um parágrafo de texto corrido, **sem markdown de widgets** (sem tabelas, sem listas de campos `chave: valor`); (b) PT-PT europeu — verificável por checklist de marcadores PT-BR proibidos (sem "você", "usar", "deletar", etc.); (c) inclui as **N secções esperadas** do dia (agenda + tarefas + finanças quando há dados; nota explícita quando uma fonte falha); (d) tom avaliado por amostragem/checklist contra o exemplo §3.1 (saudação + síntese + pergunta de fecho "queres que trate de alguma coisa?"). |
| **FR-J6** | Acção a partir da conversa (tarefas + finanças). | (a) Mensagem do Eurico é classificada e executada via motor existente; (b) tarefas e finanças funcionam E2E pelo Telegram; (c) confirmação textual da acção é enviada de volta. |
| **FR-J7** | Preview/confirmação para confiança baixa. | (a) Quando `confidence < 0,70`, o Jarvis pergunta antes de agir (botões `sim`/`não` ou resposta textual); (b) só executa após confirmação. |
| **FR-J8** | Undo 30 s via botão inline. | (a) Acções executadas mostram botão `(Cancelar)`; (b) `callback_query` dentro de 30 s reverte via `agent_reverse_ops`; (c) após 30 s o botão deixa de reverter (mensagem clara). |
| **FR-J9** | Integração Google Calendar (OAuth readonly). | (a) Fluxo OAuth single-user conclui e guarda `refresh_token` cifrado; (b) leitura de eventos de hoje funciona; (c) `calendar.readonly` apenas (sem escrita). |
| **FR-J10** | Memória básica do utilizador. | (a) Tabela `jarvis_facts` guarda factos simples (ex.: nome, fuso, preferências de tom); (b) o brief/respostas podem ler estes factos; (c) escopo RLS por `household_id`. *Âmbito mínimo na Fase 1 — cresce na v2.* |
| **FR-J11** | Mapeamento `chat_id` → household. | (a) `telegram_link` resolve `chat_id` → `user_id`/`household_id`; (b) o motor corre RLS-scoped a esse `household_id`. |

### 6.2 Requisitos não-funcionais

| ID | Requisito | Critério |
|----|-----------|----------|
| **NFR-J1** | Privacidade / dados na UE. | Todo o processamento e armazenamento em UE (Vercel `fra1`, Supabase `eu-central-1`, Inngest EU). Tokens OAuth cifrados em repouso. Ver §7. |
| **NFR-J2** | Fiabilidade do brief. | O brief chega em ≥ 95% dos dias activos; falha de uma fonte não impede a entrega (degradação graciosa). |
| **NFR-J3** | Latência de resposta-em-conversa (dois alvos separados). | (a) **Classificação:** p95 ~2 s — **provado** (benchmark 21/06). (b) **Resposta-em-conversa total** (do envio do Eurico à mensagem de volta): alvo < ~5 s no caminho comum — **a medir** em produção (inclui classificador + planner/executor + Bot API). Gerir a percepção com `sendChatAction('typing')` do Telegram enquanto processa. |
| **NFR-J4** | Segurança do webhook. | Secret token obrigatório; allowlist de `chat_id`; sem expor stack traces; pedidos não autorizados rejeitados sem efeitos colaterais. |
| **NFR-J5** | Redacção em logs. | Conteúdo de mensagens, eventos de calendário e PII redigidos nos logs (reutiliza `redaction` de `packages/agent/`). |
| **NFR-J6** | Tenancy intacta (crítico). | As 3 tabelas novas — `telegram_link`, `google_oauth_tokens`, `jarvis_facts` — **têm obrigatoriamente** coluna `household_id` + as **4 RLS policies** (select/insert/update/delete) do template. Sem isto o `pnpm check:rls` (gate NFR5) parte o build. Sem regressão de cobertura no RLS gate. |
| **NFR-J7** | Observabilidade. | Spans/métricas para webhook, cron do brief e leitura de Calendar (reutiliza `@meu-jarvis/observability`). |
| **NFR-J8** | PT-PT exclusivo. | Toda a copy/síntese em português europeu. |
| **NFR-J9** | Custo LLM controlado. | Síntese do brief + classificação dentro de orçamento desprezável para 1 utilizador; reutiliza cache/cost-router existentes. |

### 6.3 Definição de "feito" da Fase 1

A Fase 1 está feita quando, em produção e para o Eurico:

1. Recebe o brief da manhã todos os dias, no Telegram, com agenda + tarefas + finanças, em PT-PT natural.
2. Pode responder ao brief (ou escrever) e criar tarefas e registar finanças sem abrir a web app.
3. Tem confirmação para intenções ambíguas e botão de cancelar (undo 30 s) nas acções.
4. Tudo isto corre sobre `household_id`/RLS intactos, com tokens OAuth cifrados e dados na UE.
5. O Eurico, após ~2 semanas de utilização, avalia que tem valor real (go/no-go para v1.1).

---

## 7. Privacidade e segurança

Princípio da north-star §7: **a confiança é o produto.** O Jarvis vai aceder a agenda e (em v1.1) email — dados íntimos. A Fase 1 estabelece a fasquia.

| Vector | Medida |
|--------|--------|
| Dados na UE | Vercel `fra1`, Supabase `eu-central-1`, Inngest EU. Sem armazenamento fora da UE. |
| Acesso ao bot | Allowlist de `chat_id` (single-user). Webhook protegido por secret token. Bot não responde a desconhecidos. |
| OAuth Google | Âmbito mínimo (`calendar.readonly` na Fase 1). `refresh_token` cifrado em repouso com **AES-256-GCM** (`node:crypto`), chave `OAUTH_TOKEN_ENCRYPTION_KEY` em Vercel Env (UE), fora da DB — ver §4.4. Tabela `google_oauth_tokens` com `household_id` + RLS. Revogável pelo Eurico a qualquer momento (na conta Google e do nosso lado). **Trabalho novo: não há cifragem no repo hoje.** |
| Tokens e segredos | `TELEGRAM_BOT_TOKEN`, secret do webhook, credenciais OAuth em Vercel Env (cifrado em repouso). Nunca em git. |
| Logs sem PII | Conteúdo de mensagens, títulos de eventos e identificadores pessoais redigidos (`packages/agent/src/redaction.ts`). |
| Transparência | O Jarvis é claro sobre o que acede ("li a tua agenda do Google", "não consegui ler a tua agenda hoje"). Sem acessos silenciosos. |
| LLM providers | Modo "no training" e DPA já contratados (architecture.md §12.2); só o necessário é enviado ao LLM (dados agregados do brief, não dumps). |
| Tenancy | Mesmo sendo single-user, tudo corre RLS-scoped — segurança por construção e pronta para multi-utilizador. |

**Risco residual conhecido:** os LLM providers (Anthropic/OpenAI) não garantem região UE em 2026 — mitigação documentada (no-training, DPA, minimização, redacção). Re-avaliar com providers EU na v2 (mantém a posição da architecture.md §12.2).

---

## 8. Setup externo necessário do Eurico (no BUILD, não agora)

Nada disto bloqueia este PRD — só a implementação. Na altura, o agente conduz o Eurico passo a passo (1 de cada vez), confirmando nomes/tokens antes de gravar.

| # | Passo | Quem | Notas |
|---|-------|------|-------|
| 1 | Criar bot no Telegram via **@BotFather** → copiar o **token do bot**. | Eurico | Token vai para `TELEGRAM_BOT_TOKEN` (Vercel Env). |
| 2 | Fornecer o seu **`chat_id`** do Telegram. | Eurico | Para a allowlist single-user. O agente ajuda a obtê-lo. |
| 3 | **Consentir OAuth Google Calendar** (`calendar.readonly`). | Eurico | Autorização única; gera `refresh_token`. Gmail só na v1.1. |
| 4 | (Build-side) Configurar projecto OAuth no Google Cloud Console. | Agente + Eurico | Client ID/secret em Vercel Env. |

**Dependências a adicionar no BUILD (F3):** `apps/web/package.json` só tem `inngest@^3` — não há cliente Telegram nem Google. Plano:
- **Telegram:** chamar a Bot API directamente via `fetch` (recomendado — sem dependência nova; a Bot API é HTTP/JSON simples).
- **Google:** adicionar `googleapis` (ou fazer o fluxo OAuth + chamada REST manualmente, se quisermos evitar a dependência). Decisão final no momento da implementação.
- **Cifragem:** `node:crypto` (stdlib, sem dependência) para o AES-256-GCM dos tokens OAuth (§4.4).

---

## 9. Roadmap das fases seguintes

Da north-star §5. A Fase 1 (este PRD) é a espinha; tudo o resto cresce a partir dela.

| Fase | Capacidade | Notas |
|------|-----------|-------|
| **v1 (este PRD)** | Brief diário proactivo (agenda + tarefas + finanças) + acção via conversa no Telegram. | A espinha. |
| **v1.1** | **Gmail** (ler/resumir o que pede resposta; depois escrever/responder a pedido). **Calendar escrita** (marcar/reagendar). Lembretes proactivos. | Aprofunda email + agenda. OAuth Gmail é mais sensível → entra logo a seguir, não atrasa a espinha. |
| **v2** | Memória rica (hábitos, diário, preferências) · pesquisa · apoio a decisões. | O "sabe tudo" sobre o Eurico. |
| **v2.x** | Voz (acordar e falar literalmente — TTS/STT) · mais integrações. | "fala comigo" literal. |
| **v3** | Generalização SaaS (multi-utilizador, onboarding, billing). | Vender. `telegram_link` passa a N linhas; tenancy já está pronta. |

---

## 10. Âmbito da v1 — confirmado pelo Eurico (2026-06-22)

Os 4 pontos abaixo foram confirmados directamente pelo Eurico ao @pm a 22/06/2026 (confirmação explícita em conversa). Âmbito da Fase 1 FECHADO.

1. **[CONFIRMADO] Integrações no 1.º brief = Calendar + Tarefas + Finanças.** **Gmail em v1.1 imediato** a seguir (ler email é mais sensível e o OAuth demora mais — não atrasa a espinha).
2. **[CONFIRMADO] Hora do brief = 07:30 Europe/Lisbon.** Implementado com cron Inngest `TZ=Europe/Lisbon 30 7 * * *` — fuso resolvido nativamente, sem problema de DST (ver §4.5/FR-J3).
3. **[CONFIRMADO] Localização no monorepo = dentro de `apps/web`** (sem novo app), extraível para `@meu-jarvis/jarvis` se crescer.
4. **[CONFIRMADO] Âmbito de acção da v1 = só leitura de agenda + escrita de tarefas/finanças.** "Reagendar reunião" e "responder a email" ficam para v1.1 (precisam de OAuth de escrita / Gmail). O Eurico aceitou adiar o exemplo "reagenda para as 11h" da north-star para v1.1.

---

## Apêndice A — Notas de fidelidade ao codebase

Pontos onde a documentação de referência diverge do código real (registados para o @architect / @data-engineer alinharem):

- **Cron real é Inngest nativo, não `/api/cron/daily`.** Todos os jobs existentes usam `inngest.createFunction(..., { cron: '0 3 * * *' }, ...)`. O `apps/web/vercel.json` **não tem `crons`** (architecture.md §11.1 e CLAUDE.md descrevem um cron Vercel `/api/cron/daily` que não existe no estado actual). O brief segue o padrão real: cron Inngest nativo. **Fuso resolvido (F6):** o Inngest suporta o prefixo `TZ=`, logo o brief usa `{ cron: 'TZ=Europe/Lisbon 30 7 * * *' }` — 07:30 hora local, sem aritmética UTC e sem problema de DST (07:30 está fora da janela de transição). Ver §4.5/FR-J3.
- **Homónimo `getCalendarWeek` (PO-FIX-1) — NÃO confundir.** Existe já `getCalendarWeek` em `apps/web/src/lib/visao/queries.ts` (~linha 331, com wrapper `getCalendarWeekCached`) que lê a **vista de calendário das TAREFAS** (semana de tarefas), **não** a agenda do Google Calendar. A integração Google Calendar da Fase 1 (§4.4) é uma fonte **nova e distinta** (`apps/web/src/lib/google/`). Ao implementar, não reaproveitar `getCalendarWeek` para a agenda Google nem misturar os dois conceitos.
- **O classificador não conhece intents de calendário nem email.** `INTENT_VALUES` cobre tarefas + finanças + consultar/cancelar/unknown. A leitura de Calendar na Fase 1 é feita pelo job do brief (fora do classificador); acção sobre calendário/email exigirá novos intents/tools (v1.1) — não é um buraco da Fase 1, é âmbito de v1.1.
- **`/api/visao/briefing` é um stub estático** (`getBriefing()` devolve `version: 1` fixo) que **já documenta** a arquitectura-alvo ("geração real LLM via Inngest job nocturno, de uma tabela de cache"). A Fase 1 concretiza exactamente isso — o stub é forward-compatible e foi desenhado a pensar neste momento.
- **Não existem tabelas para Telegram, Google OAuth ou memória do utilizador.** Tudo novo na Fase 1 (`telegram_link`, `google_oauth_tokens`, `jarvis_facts`). `prefs.ts` já tem a noção de widget `briefing` (preferências), reutilizável.
- **A feature de família foi removida (single-user), mas `household_id`/RLS estão intactos** — o mapeamento `chat_id → household_id` assenta nessa infra sem a reabrir.
