# ADR-002 — Ponte Finanças ↔ Cérebro AI (caso conversacional)

> **Estado:** Proposta (aguarda ratificação @sm draft → @dev)
> **Data:** 30/05/2026
> **Autor:** Aria (@architect)
> **Severidade do problema:** HIGH — bloqueia todo o subsistema Finanças via chat
> **Directiva activa:** `refocus_core_before_billing` — este é CORE, prioridade ALTA, NÃO billing
> **Evidência:** `docs/E2E-FINANCE-CHAT-GAP-20260530.md` (GAP-6, log servidor com runId/traceId)
> **Trace:** PRD FR1-FR6, FR13-FR16; NFR5 (RLS); NFR12 (PII); Architecture §3.1, §4.3, §5.3, §6.4

---

## 1. Contexto

O teste E2E manual de 30/05/2026 (`/jarvis`, prompt *"paguei 18,70 euros no pingo doce em compras"*) provou que o cérebro classifica correctamente (`criar_financa_variavel`, 95%) mas o preview-then-confirm trava com:

```
Tool 'create_finance_variable' validation failed on field 'input':
Fornecer accountId ou cardId (CHECK transactions_account_or_card)
```

Tarefas via chat funcionam E2E (criar → DB → UI → undo 30s). Finanças falham **todas** pela mesma raiz. Não é falta de código de Finanças — o Epic 4 está construído (5 tools + 5 rotas UI). É a **ponte conversacional Finanças ↔ Cérebro** que nunca foi fechada.

### Causa raiz (três peças, todas verificadas no código)

| # | Peça | Evidência (ficheiro:linha) |
|---|------|----------------------------|
| 1 | O planner nunca recebe as contas/cartões reais do household. O system prompt usa `<uuid>` como **placeholder literal** nos few-shot. | `packages/planner-executor/src/prompts/planner-system.ts:96,100,104` |
| 2 | A validação Zod `.refine()` exige `accountId` XOR `cardId` **sem fallback**, e corre **antes** de `execute()`. | `create-finance-variable.ts:69-72`; `create-finance-recurrence.ts:61-63`; `atomic.ts:147` (safeParse) → `atomic.ts:175` (execute) |
| 3 | O onboarding (`handle_new_user`) cria households/members/subscriptions/audit_log mas **nenhuma conta financeira**. Utilizador novo tem 0 contas. | `packages/db/migrations/0003_auth_user_trigger.sql:69-120` |

### Descoberta arquitectural confirmada por leitura de código

1. **Não existe canal de context injection per-household no planner hoje.** `Planner.callProvider` (`planner.ts:267-299`) monta `ProviderCompleteInput` com `system: PLANNER_SYSTEM_PROMPT` (estático, cacheável) + `messages: [serializeClassificationForPlanner(...)]`. O `PlannerInput` (`schemas.ts:95-101`) só carrega `classification + householdId + userId + traceId + runId` — **nenhuma lista de contas**.
2. **A ordem de validação é load-bearing.** Em `executeAtomic`, `inputSchema.safeParse` (passo 1) corre **antes** de `execute()` (passo 2). Logo, um default puramente DB-side dentro de `execute()` **nunca seria alcançado** — o `.refine()` rejeita primeiro. Qualquer solução de "conta default" obriga a relaxar o refine.
3. **Já existe precedente directo de fallback.** `resolveDefaultCategory` (`_helpers/resolve-default-category.ts`) faz exactamente este padrão para `categoryId` ausente: SELECT determinístico scoped por RLS, erro PT-PT se ausente. Um `resolveDefaultAccount` é o gémeo natural.
4. **O schema `accounts` já suporta "Dinheiro".** `accountTypeEnum` (`finance.ts:39-46`) tem o valor `'dinheiro'` (cash físico). Zero mudança de DDL na tabela — apenas um INSERT.

---

## 2. Opções consideradas

### Opção A — Context injection (planner sabe que contas existem)

Injectar a lista de contas/cartões do household (id + nome + tipo) no payload do planner, substituindo os `<uuid>` por contexto real, para o LLM escolher/preencher um `accountId`/`cardId` válido.

- **Prós:** o cérebro passa a tomar decisões informadas; suporta desambiguação ("cartão Millennium" → id certo); alinhado com a visão de cérebro multi-intent.
- **Contras:** não resolve o utilizador novo com **0 contas** (não há nada para injectar); requer um novo canal de contexto no `PlannerInput` + montagem no endpoint; aumenta tokens do prompt (mitigável — a lista é curta numa família).
- **Risco isolada:** insuficiente sozinha. Família-first típica escreve "paguei 18,70 no pingo doce" sem nomear conta — mesmo com contexto, o LLM teria de inventar ou perguntar.

### Opção B — Conta "Dinheiro" default no onboarding + fallback nas tools

Estender `handle_new_user` para criar uma conta `'Dinheiro'` (type `dinheiro`) por household; relaxar o `.refine()` para tornar account/card verdadeiramente opcionais; as tools resolvem a conta default via `resolveDefaultAccount` quando o input não traz conta nem cartão.

- **Prós:** resolve o caso família-first comum imediatamente (o utilizador nunca fica preso); reutiliza o padrão `resolveDefaultCategory` já provado; alinhado com a UX "regista primeiro, organiza depois" do Néctar.
- **Contras:** sem context injection, o cérebro nunca consegue associar a uma conta **específica** nomeada pelo utilizador (cai sempre no default); requer mudança no trigger SQL (delegar a @data-engineer) + migration de backfill para households existentes.
- **Risco isolada:** funciona para o caso comum, mas degrada "no cartão Activobank" para a conta Dinheiro — perda de fidelidade.

### Opção C — Clarificação conversacional ("de que conta saiu?")

Quando há ambiguidade (>1 conta e o utilizador não especificou), o cérebro devolve uma pergunta de desambiguação em vez de executar.

- **Prós:** máxima fidelidade; sem suposições erradas.
- **Contras:** atrito alto no caso comum (a maioria das compras família-first não precisa de escolher conta); exige uma máquina de estados conversacional (multi-turn) que **não existe** no pipeline actual (one-shot classify→plan→execute); é uma feature, não um fix.
- **Risco isolada:** sobre-engenharia para o MVP; viola "boring technology where possible".

---

## 3. Decisão

**Adoptar B + A combinadas, com C explicitamente diferida (Fase 2).**

A combinação resolve as três peças da causa raiz na ordem certa:

| Peça da causa raiz | Resolvida por |
|--------------------|---------------|
| 3 — utilizador novo tem 0 contas | **B** (conta Dinheiro no onboarding + backfill) |
| 2 — refine bloqueia antes de execute() | **B** (relaxar refine + `resolveDefaultAccount` fallback dentro de execute) |
| 1 — planner não conhece as contas reais | **A** (context injection: lista contas/cartões no payload) |

### Racional

- **B é a fundação não-negociável.** Sem conta default + refine relaxado, mesmo com context injection (A) o utilizador novo continua preso (0 contas para injectar) e o refine continua a travar antes de `execute()`. B fecha o caso família-first comum sozinha.
- **A adiciona fidelidade.** Com B no lugar, A permite ao cérebro honrar "no cartão Millennium" quando o utilizador é explícito, caindo no default Dinheiro apenas quando não especifica.
- **C é diferida** porque o pipeline actual é one-shot (classify→plan→execute numa transacção) — clarificação multi-turn é uma feature de Fase 2, não um fix de bloqueio. O preview-then-confirm já dá ao utilizador a oportunidade de cancelar antes de gravar; isso cobre o risco de associação errada no MVP.

### Comportamento de fallback (precedência, dentro de `execute()`)

Quando `accountId` e `cardId` são ambos ausentes:
1. Resolver a conta default do household via `resolveDefaultAccount` — SELECT determinístico: conta `account_type = 'dinheiro'` não arquivada do household; se houver várias (edge), a mais antiga (`created_at` asc).
2. Se nenhuma conta `dinheiro` existir (households legacy antes do backfill), fazer fallback para a conta não-arquivada mais antiga do household.
3. Se o household não tiver **nenhuma** conta, lançar `ToolExecutionError` PT-PT com mensagem accionável (situação patológica pós-backfill — não deve ocorrer).

> O `paymentMethod` inferido permanece coerente: conta presente → `'transfer'` hoje; com conta Dinheiro default, recomenda-se inferir `'cash'` quando a conta resolvida é do tipo `dinheiro` (decisão de detalhe para @dev/@data-engineer no draft — LOW).

---

## 4. Requer mudança de schema?

**Não na estrutura — sim em dados (INSERT) + um relaxamento de validação aplicacional.**

| Mudança | Camada | Schema/DDL? | Delegar a |
|---------|--------|-------------|-----------|
| Conta `'Dinheiro'` no `handle_new_user` | Trigger SQL (`0003_*` ou nova migration) | **Trigger DDL** (`create or replace function`) — sem ALTER TABLE | **@data-engineer** |
| Backfill: criar conta Dinheiro para households existentes sem conta | Migration data (idempotente) | INSERT data | **@data-engineer** |
| Relaxar `.refine()` account XOR card → opcional | Tools (Zod) | Não (aplicacional) | @dev |
| `resolveDefaultAccount` helper | Tools (`_helpers/`) | Não | @dev |
| Context injection (lista contas no payload) | `PlannerInput` + `planner.ts` + endpoint | Não | @dev |

A coluna `accounts` e o enum `account_type='dinheiro'` **já existem** (`finance.ts:39-46`). A tabela `accounts` já tem `household_id NOT NULL` + as 4 RLS policies (NFR5 satisfeito — não é tabela nova).

### O que delegar a @data-engineer (DDL/migration)

1. **Estender `handle_new_user`** (`packages/db/migrations/0003_auth_user_trigger.sql` ou nova migration que faz `create or replace function`): após criar o household (linha 77, `new_household_id`), inserir uma conta:
   - `name = 'Dinheiro'`, `account_type = 'dinheiro'`, `currency = 'EUR'`, `balance_cents = 0`, `initial_balance_cents = 0`, `household_id = new_household_id`.
   - Manter o **fail-hard** (D2) — coerente com a política existente do trigger.
   - Manter `security definer` + `set search_path = public`.
2. **Migration de backfill idempotente** para households existentes sem nenhuma conta: `INSERT ... SELECT` de households sem rows em `accounts`, criando a conta Dinheiro. Idempotente via `WHERE NOT EXISTS`. Corre com `getServiceDb()`/role de migration (ignora RLS por design — é admin path).
3. **Decisão de detalhe:** confirmar se o `created_by_user_id` é necessário em `accounts` (o schema `accounts` **não** tem essa coluna — confirmado em `finance.ts:82-114`), logo o INSERT no trigger não precisa dela. @data-engineer valida.

@architect retém: a decisão de *que* tabela/coluna (conta Dinheiro, type `dinheiro`) e o contrato do fallback. @data-engineer detém o DDL exacto do trigger + migration + idempotência.

---

## 5. Impacto e risco

### Ficheiros/camadas afectadas

| Ficheiro | Mudança | Camada |
|----------|---------|--------|
| `packages/db/migrations/0003_auth_user_trigger.sql` (ou nova migration) | INSERT conta Dinheiro no trigger | DB (L4) — @data-engineer |
| nova migration backfill | conta Dinheiro p/ households legacy | DB (L4) — @data-engineer |
| `packages/tools/src/finance/create-finance-variable.ts` | relaxar refine + resolver default account | tools |
| `packages/tools/src/finance/create-finance-recurrence.ts` | idem | tools |
| `packages/tools/src/finance/create-installment.ts` | depende de `cardId` — ver nota abaixo | tools |
| `packages/tools/src/finance/create-card.ts` | depende de `accountId` — ver nota abaixo | tools |
| `packages/tools/src/finance/_helpers/resolve-default-account.ts` (NOVO) | helper espelho de `resolve-default-category` | tools |
| `packages/planner-executor/src/schemas.ts` | adicionar canal de contexto contas ao `PlannerInput` | planner |
| `packages/planner-executor/src/planner.ts` | injectar contexto contas no payload (system suffix ou user message) | planner |
| `packages/planner-executor/src/prompts/planner-system.ts` | bump `v2`→`v3`; substituir `<uuid>` por instrução de usar contexto/default | planner (requer re-gerar snapshot hash em `prompts.test.ts`) |
| `apps/web/src/app/api/agent/prompt/route.ts` | SELECT contas do household (RLS) + passar ao planner | endpoint |

### Notas de scope (criar_cartao / criar_parcelada)

- `create_card` exige `accountId` (cartão **pertence** a uma conta — `cards.accountId NOT NULL`, `finance.ts:131-133`). Com a conta Dinheiro default + context injection, o cérebro pode associar o cartão à conta default ou a uma conta nomeada. **Recomendação:** incluir no scope da story (a mesma raiz). A conta default torna `criar_cartao` funcional para utilizador novo.
- `create_installment` exige `cardId` (parcelada é sempre em cartão de crédito — `installments.cardId NOT NULL`). Aqui a conta Dinheiro **não** resolve — uma parcelada precisa de um cartão real. **Recomendação:** `criar_parcelada` fica **fora** do fix imediato; depende de o utilizador ter criado um cartão primeiro (caso legítimo: clarificar "que cartão?" ou pré-requisito criar_cartao). Documentar como follow-up FUP, não bloqueante para o desbloqueio do core (variável + recorrente + cartão).

### Riscos RLS (NFR5)

- A conta Dinheiro criada no trigger herda `household_id = new_household_id` — RLS-coberta pelas 4 policies existentes de `accounts`. **Sem risco de coverage** (não é tabela nova; o RLS Coverage Gate não regride).
- O backfill corre com role de migration (`getServiceDb()`/`DIRECT_URL`) que ignora RLS — **correcto e intencional** para admin path (alinhado com `getServiceDb()` em jobs/migrations, CLAUDE.md §multi-tenancy). Cada INSERT do backfill carrega explicitamente o `household_id` certo — zero cross-household.
- `resolveDefaultAccount` corre com `ctx.db` (authenticated, JWT) — RLS garante que só vê contas do próprio household. **Defesa em profundidade preservada.**

### Risco de PII (NFR12)

- A lista de contas injectada no planner contém **nomes de contas** (ex: "Millennium", "Dinheiro") + UUIDs. Nomes de conta podem ser considerados PII ligeira. **Mitigação:** os UUIDs e nomes vão no payload do LLM (necessário para a função), mas **NÃO** devem entrar em span attributes / logs raw (regra NFR12 já aplicada às tools). @dev deve garantir que a injecção de contexto respeita `redactToolInputForLog` / span redaction. Documentar como AC explícito na story.

### Impacto em testes existentes

- `prompts.test.ts` tem um **snapshot hash** do `PLANNER_SYSTEM_PROMPT` — o bump v2→v3 **obriga** a re-gerar o hash (passo conhecido, documentado no header do `planner-system.ts:18-21`).
- Testes das tools de finanças (`create-finance-variable`/`recurrence`) que assumem o refine obrigatório vão precisar de ajuste para o novo comportamento opcional + caso default.
- `handle_new_user` tem testes de onboarding (Story 1.5) — adicionar assertion da conta Dinheiro.
- Contract test do planner (`contract.test.ts`) não muda (TOOL_TO_INTENT_MAP intacto).

---

## 6. Complexity assessment

**Classe: STANDARD** (score estimado 11/25).

| Dimensão (1-5) | Score | Justificação |
|----------------|-------|--------------|
| Scope | 3 | ~10 ficheiros em 3 packages (db, tools, planner-executor) + endpoint web |
| Integration | 2 | Sem APIs externas novas; toca o LLM payload (já existente) |
| Infrastructure | 2 | Migration DDL (trigger) + backfill; sem infra nova |
| Knowledge | 2 | Padrões já provados no repo (`resolveDefaultCategory`, trigger existente) |
| Risk | 2 | RLS coberto; fail-hard mantido; preview-then-confirm mitiga associação errada |

STANDARD justifica uma única story bem definida com sub-tasks por camada, sem necessidade de spec pipeline completo (a evidência E2E já é o "spec").

---

## 7. Sequência de implementação sugerida

Ordem por dependência (cada passo desbloqueia o seguinte):

1. **[@data-engineer] DDL primeiro** — estender `handle_new_user` (conta Dinheiro) + migration de backfill idempotente. Aplicar e validar contra Postgres efémero (CI `rls-gate`). Sem isto, não há conta para o fallback resolver.
2. **[@dev] Tools — relaxar refine + `resolveDefaultAccount`** — tornar account/card opcionais em `create-finance-variable` e `create-finance-recurrence`; criar o helper espelho de `resolve-default-category`; inferir `paymentMethod='cash'` quando a conta resolvida é Dinheiro. Isto sozinho **já desbloqueia** o caso família-first comum ("paguei X no sítio Y").
3. **[@dev] Context injection no planner** — adicionar canal de contexto contas ao `PlannerInput` (`schemas.ts`); montar a lista no endpoint (`prompt/route.ts`, SELECT RLS-scoped); passar ao payload em `planner.ts`. Adiciona fidelidade (associar a conta nomeada).
4. **[@dev] Bump prompt v2→v3** — substituir `<uuid>` por instrução "usa o accountId/cardId do contexto fornecido; se o utilizador não especificar, omite (a tool usa a conta por defeito)"; re-gerar snapshot hash.
5. **[@dev] create_card** — garantir que associa à conta default quando o utilizador não nomeia conta (mesma raiz, baixo custo incremental).
6. **[@qa] Re-teste E2E** — repetir o prompt "paguei 18,70 no pingo doce" + "renda 600 todo dia 1" + "adiciona cartão Millennium" no `/jarvis`; confirmar criação + undo 30s, paridade com Tarefas.

**Fora de scope (follow-up):** `criar_parcelada` (depende de cartão real) + clarificação conversacional multi-turn (Opção C, Fase 2).

---

## 8. Consequências

- **Positivas:** desbloqueia o core Finanças via chat (objectivo da directiva `refocus_core_before_billing`); reutiliza padrões provados (zero invenção arquitectural); mantém NFR5/NFR12; utilizador novo nunca fica preso.
- **Negativas / dívida aceite:** `criar_parcelada` continua bloqueada até existir um cartão (follow-up); associação a conta específica depende de context injection (passo 3) — se só o passo 2 for entregue, tudo cai no default Dinheiro (degradação aceitável e reversível).
- **Reversibilidade:** alta. O fallback é aditivo; o refine relaxado não corrompe dados (o CHECK Postgres `transactions_account_or_card` continua a proteger a nível DB — a conta default garante que é sempre satisfeito).

---

## 9. DP-2.13.B — Ratificação (canal de context injection)

> **Estado:** RATIFICADA por Aria (@architect), 30/05/2026 — micro-decisão devolvida pelo @po (Pax) na validação da Story 2.13 (v1.1). Refinamento da peça A (§2 Opção A / §3). Não reabre o ADR.
> **Verificação:** decisão fundamentada por leitura directa de `planner.ts:267-299`, `anthropic.ts:190-220`, `redaction.ts:24-46`, `tracing.ts:36-49`.

### Pergunta

Qual o canal exacto para injectar o `accountContext` (contas/cartões do household) no pedido ao LLM (planner): campo no `PlannerInput` + `messages` vs `system`?

### Decisão (RATIFICA a recomendação do @po, com 1 correcção de shape)

**Adoptar:** campo dedicado `accountContext` no `PlannerInputSchema` + injecção como **prefixo da user message** (`messages`), **nunca** no `system`. A recomendação do @po é arquitecturalmente sólida e está ratificada. **Correcção:** o shape proposto (`{ id, name, type: accountTypeEnum }` para contas E cartões num só array) é incorrecto — cartões não têm `account_type`. Ver §9.4.

### 9.1 — Canal e impacto no prompt caching (CONFIRMADO no código)

O bloco cacheado da Anthropic é construído por `buildSystemBlocks` (`anthropic.ts:190-202`, `cache_control: ephemeral` no `system`) e `buildToolsParam` (`anthropic.ts:204-220`, `cache_control` no último tool). As `messages` (`anthropic.ts:159`) são serializadas **sem** `cache_control` — estão **fora** do prefixo cacheado por construção.

| Canal | Cacheável? | Efeito de injectar dados voláteis do household |
|-------|-----------|------------------------------------------------|
| `system` (`PLANNER_SYSTEM_PROMPT`) | SIM (ephemeral, 5min TTL) | **Invalida o cache** a cada household/sessão — o prefixo cacheado deixa de bater. Cache write em vez de cache read. PROIBIDO. |
| `tools` (último tool) | SIM (ephemeral) | Idem — bloco estável, não tocar. |
| `messages` (user turn) | NÃO | **Zero impacto no cache hit rate.** É o turn variável por natureza. CANAL CORRECTO. |

**Conclusão:** injectar `accountContext` como prefixo da user message (concatenado em `serializeClassificationForPlanner` ou imediatamente antes dela em `callProvider`) preserva 100% o cache hit rate do `system` + `tools`. Mete os dados voláteis exactamente onde a Anthropic espera conteúdo volátil. **Ratifica R-2.13.4.**

### 9.2 — Fronteira PII (NFR12) — coberta por construção, ZERO código novo

A protecção é tripla e já existe; **não há denylist de campos a estender** (correcção factual já registada pelo @po em AC6 PO-FIX-B, que confirmo):

1. **Spans usam whitelist, não denylist.** `PLANNER_SPAN_ATTRIBUTE_KEYS` (`tracing.ts:36-49`) é `as const` de 12 keys. `accountContext` não está lá e **não pode** ser anotado num span — `tracing.test.ts` parte se algo escapar. Cobertura por construção.
2. **Payload do provider redacta `messages` inteiro.** `redactProviderPayload` (`redaction.ts:37-46`) remove `system`/`messages`/`tools` (`REDACTED_FIELD_NAMES`, `redaction.ts:24-28`) antes de qualquer log. Como `accountContext` vai em `messages`, fica redactado automaticamente.
3. **`redactToolInputForLog`** redacta o input de tools por completo (não é a camada relevante aqui — o context injection é no planner, não na tool — mas reforça a defesa em profundidade do lado das finanças).

**Directiva para @dev (T3.4):** a tarefa é **verificar** (teste negativo), não adicionar. Confirmar: (a) nenhum span attribute de `agent.planner.call` contém nome de conta/cartão; (b) o `accountContext` viaja em `messages` e portanto cai em `redactProviderPayload`. NÃO criar nenhuma "lista de redacção" — esse mecanismo não existe e adicioná-lo seria invenção. Se por algum motivo o `accountContext` for guardado num campo de topo do `ProviderCompleteInput` (NÃO recomendado), aí sim teria de ser adicionado a `REDACTED_FIELD_NAMES` — mas a decisão é mantê-lo dentro de `messages`, evitando essa necessidade.

### 9.3 — RLS (NFR5) — cliente authenticated obrigatório

O SELECT de contas/cartões no endpoint `apps/web/src/app/api/agent/prompt/route.ts` (T3.2) **DEVE** usar `getDb()` (role `authenticated`, RLS-scoped via JWT `household_id` claim), **NUNCA** `getServiceDb()` (role `service_role`, ignora RLS).

**Regra para @dev:** o context injection é um response handler de utilizador final — pertence à categoria que `getServiceDb()` está explicitamente proibida de servir (CLAUDE.md §multi-tenancy: `getServiceDb()` só em migrations/jobs Inngest/Stripe webhooks/scripts admin). O RLS do Postgres garante, por baixo da aplicação, que o SELECT só devolve contas/cartões do household do utilizador autenticado — defesa em profundidade. Um `getServiceDb()` aqui seria um vazamento cross-household crítico (correlaciona com R-2.13.2/R-2.13.3). Confirmar que o SELECT filtra contas/cartões **não-arquivados** (`is_archived = false` ou equivalente) para não poluir o contexto do LLM com entidades inactivas.

### 9.4 — Shape recomendado (CORRECÇÃO ao @po + optimização de tokens)

**Erro a corrigir:** a recomendação do @sm/@po (AC6, T3.1) propõe `accountContext?: Array<{ id, name, type }>` com `type` do `accountTypeEnum` para contas **e** cartões. Cartões (`cards`) não têm `account_type` — pertencem a uma conta (`cards.accountId NOT NULL`). Fundi-los num só array com um enum de conta é modelação incorrecta e confunde o LLM (que precisa de distinguir "associa a uma conta" de "associa a um cartão").

**Shape ratificado** — duas listas distintas, ambas opcionais:

```typescript
// PlannerInputSchema (packages/planner-executor/src/schemas.ts)
accountContext: z
  .object({
    accounts: z.array(
      z.object({
        id: z.string().uuid(),
        name: z.string(),
        type: z.string(), // espelha accountTypeEnum como string (evita import cross-package do enum DB no planner)
      }),
    ),
    cards: z.array(
      z.object({
        id: z.string().uuid(),
        name: z.string(),
      }),
    ),
  })
  .optional();
```

> Nota de fronteira de package: o `planner-executor` tipa `type` como `z.string()` (não importa `accountTypeEnum` de `@meu-jarvis/db`) — o planner não deve depender do schema DB; o endpoint (`apps/web`) é que faz o mapeamento da row para esta string. Mantém o package planner agnóstico de DDL (coerente com o princípio "planner trabalha com contexto, não com schema").

**Serialização compacta para tokens** (prefixo da user message, antes da classificação) — formato denso, uma linha por categoria, ids inline para o LLM resolver desambiguação ("cartão Millennium" → id):

```
[Contexto de contas do household]
Contas: Dinheiro (a1b2…), Conta Ordenado BPI (c3d4…)
Cartões: Millennium (e5f6…), Activobank (07a8…)
Se o utilizador não indicar conta nem cartão, OMITE accountId/cardId (a tool usa a conta por defeito).
```

Casos de borda:
- `accountContext` ausente ou ambas as listas vazias → não injectar o prefixo (utilizador novo pré-backfill; o fallback `resolveDefaultAccount` da peça B resolve a jusante).
- Lista curta numa família típica (< 10 entidades) → custo de tokens marginal e **não cacheado** (é o turn variável). Aceitável face a NFR1.

### 9.5 — Resumo das directivas para @dev (T3)

| # | Directiva | Verificação no gate @architect |
|---|-----------|-------------------------------|
| 1 | Campo `accountContext` (objecto `{ accounts[], cards[] }`, opcional) no `PlannerInputSchema` — duas listas distintas, NÃO um array misto | `pnpm typecheck` + leitura do schema |
| 2 | Injectar como **prefixo da user message** (`messages`), nunca no `system` nem `tools` | leitura de `callProvider`; teste de cache hit não regride |
| 3 | SELECT no endpoint via `getDb()` (RLS), nunca `getServiceDb()`; filtrar não-arquivados | leitura de `prompt/route.ts` |
| 4 | T3.4 é **verificar** (teste negativo de span/redacção), não adicionar a lista nenhuma | leitura do teste + AC6 PO-FIX-B |
| 5 | `type` da conta como `z.string()` no planner (não importar `accountTypeEnum` de `@meu-jarvis/db`) | leitura do schema |

> Esta ratificação **substitui** a ambiguidade "user message prefix vs campo dedicado" da DP-2.13.B e a "lista mista contas+cartões" do AC6/T3.1. O @po/@dev devem reflectir o shape de duas listas (§9.4) ao actualizar a story — alteração de AC/scope é da competência do @po (não a faço aqui).

---

*ADR-002 — Aria (@architect), arquitetando o futuro.*
