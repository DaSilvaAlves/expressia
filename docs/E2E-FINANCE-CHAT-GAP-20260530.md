# Achado E2E — Finanças via chat bloqueadas (GAP-6)

> **Data:** 30/05/2026
> **Descoberto por:** sessão de teste E2E manual (Eurico + Orion/aiox-master) em `localhost:3000/jarvis`
> **Severidade:** HIGH — bloqueia todo o subsistema Finanças do cérebro AI
> **Contexto:** directiva activa `refocus_core_before_billing` (fazer o core funcionar E2E). Este achado é o tipo de "o que quebra com evidência" que a directiva pedia.
> **Relação com CORE-STATE-AUDIT:** complementa. A auditoria de 29/05 olhou para config externa (chaves, RESEND, etc.); NÃO testou o fluxo conversacional real. Este achado vem de teste empírico.

---

## Sintoma (evidência empírica)

No chat (`/jarvis`), o utilizador escreveu:

> *"paguei 18,70 euros no pingo doce em compras"*

O cérebro classificou correctamente (`criar_financa_variavel`, confiança **95%**) e mostrou o preview-then-confirm. Mas o preview trouxe um erro a vermelho **antes de permitir confirmar**:

```
Tool 'create_finance_variable' validation failed on field 'input':
Fornecer accountId ou cardId (CHECK transactions_account_or_card)
```

### Log do servidor (dev, local)

```json
{
  "level": 40,
  "service": "expressia-web",
  "toolName": "create_finance_variable",
  "inputRedacted": true,
  "err": {
    "name": "ToolValidationError",
    "message": "Tool 'create_finance_variable' validation failed on field 'input': Fornecer accountId ou cardId (CHECK transactions_account_or_card)"
  },
  "runId": "938c1d62-3530-4aa2-bd3e-454727f89ae3",
  "traceId": "1780166814271-df5b403f",
  "msg": "Tool input validation failed inside executeAtomic"
}
```

A validação falha **dentro de `executeAtomic`**, no schema Zod da tool (antes de tocar a DB). O preview-then-confirm e a validação antecipada **funcionam como desenhados** — apanharam o erro a tempo, sem corromper dados. O problema é a montante.

---

## Causa raiz (três peças)

### 1. O planner nunca recebe as contas/cartões reais do household

`packages/planner-executor/src/prompts/planner-system.ts` ensina o cérebro com exemplos few-shot que usam **`<uuid>` como placeholder literal**:

```
linha 96:  create_finance_variable com { ..., cardId: '<uuid>' }
linha 100: create_finance_recurrence com { ..., accountId: '<uuid>' }
linha 104: create_card com { name, accountId: '<uuid>', ... }
```

Não há injeção de contexto com os IDs reais das contas/cartões do utilizador. Logo, **é impossível** o cérebro preencher um `accountId`/`cardId` válido — não sabe que contas existem.

### 2. As tools exigem `accountId` XOR `cardId`, sem fallback

- `packages/tools/src/finance/create-finance-variable.ts:69-72`
  ```ts
  .refine((d) => d.accountId !== undefined || d.cardId !== undefined, {
    message: 'Fornecer accountId ou cardId (CHECK transactions_account_or_card)',
  })
  ```
- `packages/tools/src/finance/create-finance-recurrence.ts:61-62` — idêntico (`recurrences_account_or_card`).

Não há conta/cartão default a usar quando o input não os traz.

### 3. O onboarding não cria nenhuma conta financeira

`packages/db/migrations/0003_auth_user_trigger.sql` (`handle_new_user`) cria:
- `households` (linha 69)
- `household_members` (linha 80)
- `subscriptions` (linha 87)
- `audit_log` (linha 100)

**Zero contas financeiras (`accounts`).** Um utilizador novo tem 0 contas e 0 cartões → mesmo que o cérebro quisesse associar, não há nada para associar.

---

## Impacto

| Fluxo via chat | Estado | Nota |
|----------------|--------|------|
| `criar_tarefa` | ✅ Funciona E2E | Provado: chat → DB → UI → undo |
| preview-then-confirm | ✅ Funciona | Valida antes de gravar |
| `reverse_op` (undo 30s) | ✅ Provado (tarefa) | — |
| `criar_financa_variavel` | ❌ Bloqueado | Causa raiz acima |
| `criar_financa_recorrente` | ❌ Bloqueado | Mesma raiz (refine account/card) |
| `criar_cartao` | ❌ Provável bloqueio | Few-shot exige `accountId` (linha 104) |
| `criar_parcelada` | ❌ Provável bloqueio | Depende de `cardId` (linha 84/96) |

**Conclusão:** as Tarefas via chat conectam E2E; **todo o subsistema Finanças via chat está bloqueado** pela mesma raiz. Não é falta de código de finanças (Epic 4 está construído e as rotas UI funcionam) — é a **ponte Finanças ↔ Cérebro** que nunca foi fechada para o caso conversacional real.

---

## Opções de fix (para decisão @architect + @pm)

1. **Context injection** — passar ao planner a lista de contas/cartões do household (id + nome) no system prompt, substituindo os `<uuid>` placeholder por contexto real. Permite ao cérebro escolher/desambiguar.
2. **Conta "Dinheiro" default no onboarding** — estender `handle_new_user` (ou seed) para criar uma conta default por household; as tools usam-na quando o input não traz conta/cartão. Resolve o caso comum família-first ("paguei X no sítio Y").
3. **Clarificação conversacional** — quando há >1 conta e o utilizador não especifica, o cérebro pergunta "de que conta saiu?".

Provavelmente a solução é **1 + 2 combinadas** (context injection para o cérebro saber + conta default para o utilizador novo nunca ficar preso), com 3 como refinamento. Avaliar se requer mudança de schema (não deve — `accounts` já existe).

---

## Ficheiros-chave

| Ficheiro | Papel |
|----------|-------|
| `packages/planner-executor/src/prompts/planner-system.ts` | System prompt do planner (linhas 96/100/104 `<uuid>`) |
| `packages/tools/src/finance/create-finance-variable.ts` | Schema refine account/card (69-72) |
| `packages/tools/src/finance/create-finance-recurrence.ts` | Schema refine account/card (61-62) |
| `packages/db/migrations/0003_auth_user_trigger.sql` | Onboarding sem conta default |
| `apps/web/src/app/api/agent/prompt/route.ts` | Onde a injeção de contexto seria montada |
| `docs/architecture.md` §4 | Pipeline AI (classifier → planner → executor) |

---

## Estado lateral (positivo) descoberto na mesma sessão

- **Chat AI funciona em produção** (`expressia-black.vercel.app`) — as env vars da Vercel já tinham as chaves. O GAP-1 da CORE-STATE-AUDIT era real **só em local**.
- **GAP-1 (local) resolvido** nesta sessão: `apps/web/.env.local` recebeu `ANTHROPIC_API_KEY` + `OPENAI_API_KEY` bem formadas. Ficheiros `.env` arrumados (mapa em `docs/handoffs/mj-handoff-finance-chat-gap-architect-20260530.yaml`).
