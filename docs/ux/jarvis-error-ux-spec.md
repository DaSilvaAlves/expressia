# Spec UX — Tratamento de Erros no Chat /jarvis

> **Autora:** Uma (UX-Design Expert)
> **Data:** 14/05/2026
> **Destinatário:** `@dev` (Dex) — implementação
> **Âmbito:** `apps/web/src/app/(app)/jarvis/_components/jarvis-chat.tsx`
> **Trigger:** Erro técnico cru exposto ao utilizador final em produção
> (`Classifier LLM call failed (i): Provider openai returned 401`)

---

## 1. Problema

O orquestrador do chat (`jarvis-chat.tsx`) mostra a mensagem técnica do
backend directamente ao utilizador final:

```ts
// jarvis-chat.tsx:127-135 — comportamento ACTUAL (defeituoso)
if (!res.ok) {
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  appendMessage({
    kind: 'error',
    id: makeId(),
    text: body.error?.message ?? 'Erro temporário. Tenta de novo.',
  });
  return;
}
```

`body.error.message` vem do `route.ts` e, para vários códigos, é o
`err.message` interno da pipeline (ex.: `CLASSIFIER_ERROR` →
`route.ts:609` → `apiError('CLASSIFIER_ERROR', err.message, 400, ...)`).

### Impacto

| Dimensão | Problema |
|----------|----------|
| **UX** | Jargão técnico ("Classifier", "Provider", "401", "Body", "idempotente", "Household") no ecrã de um produto família-first |
| **Confiança** | Expõe o nome do provider de LLM (`openai`) e detalhes internos da arquitectura |
| **Consistência** | Contradiz o comentário do próprio código ("mensagem PT-PT genérica") e o tom PT-PT cuidado já usado nos ramos 401/429 |
| **Diagnóstico** | O utilizador não sabe o que fazer a seguir — a mensagem não tem acção |

### Defeito secundário encontrado

`QUOTA_EXCEEDED` (429) entra no ramo 429 do frontend (`jarvis-chat.tsx:114-125`),
que lê `body.error.details.retry_after_seconds`. Mas `QUOTA_EXCEEDED` só traz
`period_end` (`route.ts:232-237`) — não `retry_after_seconds`. Resultado: cai no
fallback `?? 60` e diz "Tenta de novo em 60 segundos" quando na realidade a
quota é **mensal**. Mensagem enganadora.

---

## 2. Princípio de design

> **O `error.code` decide a mensagem. O `error.message` nunca chega ao ecrã.**

- O frontend mapeia `error.code` → mensagem PT-PT amigável (tabela §3).
- `error.message` técnico → apenas Sentry/console (`captureException` client-side).
- Toda a mensagem de erro tem **três partes**: o que aconteceu (sem culpa),
  porquê em linguagem humana (quando útil), e **o que fazer a seguir**.
- Tom: calmo, PT-PT, par-a-par. Nunca alarmista, nunca técnico.
- Código de erro desconhecido → fallback genérico seguro (nunca o `message` cru).

---

## 3. Mapa de códigos → mensagem UX

Códigos extraídos de `route.ts` (todos os `apiError(...)` + handlers).

| `error.code` | HTTP | Mensagem UX (PT-PT) | Tom | Acção |
|--------------|------|---------------------|-----|-------|
| `AUTH_REQUIRED` | 401 | _(já tratado — redirect `/entrar`)_ | — | redirect |
| `HOUSEHOLD_NOT_FOUND` | 404 | "Ainda não tens um agregado configurado. Termina o registo para começares a usar o Jarvis." | warning | botão/link "Completar registo" |
| `VALIDATION_ERROR` | 400 | "Não percebi esse pedido. Escreve o que precisas em texto (até 2000 caracteres)." | warning | reformular |
| `IDEMPOTENCY_IN_PROGRESS` | 409 | "Esse pedido ainda está a ser processado. Espera um instante antes de repetir." | info | aguardar |
| `RATE_LIMIT_EXCEEDED` | 429 | "Estás a enviar pedidos depressa demais. Tenta de novo em {N} segundos." | warning | aguardar `retry_after_seconds` |
| `QUOTA_EXCEEDED` | 429 | "Atingiste o limite de pedidos do teu plano ({plan}). A próxima janela abre {data formatada PT-PT}." | warning | esperar `period_end` / ver plano |
| `CLASSIFIER_ERROR` | 400 | "Não consegui interpretar esse pedido agora. Tenta reformular de forma mais simples." | warning | reformular |
| `PLANNER_ERROR` | 400 | "Não consegui montar um plano para esse pedido. Tenta ser mais específico." | warning | reformular |
| `EXECUTOR_VALIDATION_ERROR` | 400 | "Esse pedido tem um detalhe que não consigo processar. Tenta reformular." | warning | reformular |
| `TOOL_PLAN_GATE_ERROR` | 400 | "Esse pedido pede uma ação que ainda não está disponível." | info | — |
| `TOOL_EXECUTION_ERROR` | 500 | "Algo correu mal ao executar o teu pedido — não foi feita nenhuma alteração. Tenta de novo." | error | retry |
| `INTERNAL_ERROR` | 500 | "Tivemos um problema temporário do nosso lado. Tenta de novo daqui a pouco." | error | retry |
| _(qualquer outro / sem code)_ | * | "Erro temporário. Tenta de novo." | error | retry |

Notas de implementação:
- `{N}`, `{plan}`, `{data}` interpolados de `body.error.details`.
- `QUOTA_EXCEEDED`: formatar `period_end` em PT-PT — ex. `14/05/2026 às 00:00`.
- "agregado" é o termo PT-PT para `household` no UI (nunca "Household").

---

## 4. Mudança no código (orientação para `@dev`)

1. **Separar `QUOTA_EXCEEDED` do ramo 429 genérico.** Hoje `jarvis-chat.tsx:114`
   trata qualquer 429 igual. Passar a fazer branch por `body.error.code`.
2. **Substituir o bloco `!res.ok`** (`:127-135`): em vez de
   `body.error?.message ?? fallback`, chamar uma função pura
   `errorMessageFor(code, details)` que devolve a string da tabela §3.
3. **Centralizar o mapa** num módulo testável — sugestão:
   `apps/web/src/app/(app)/jarvis/_components/error-messages.ts` exportando
   `errorMessageFor(code: string, details?: Record<string, unknown>): string`.
4. **`error.message` → Sentry**, não ecrã: no ramo 5xx, `captureException`
   client-side com o `message` técnico e o `run_id` (`body.error.details.run_id`).
5. **Manter o ramo 401** como está (redirect `/entrar` — correcto).

### Critérios de aceitação

- [ ] Nenhuma string de `body.error.message` é renderizada no DOM (teste:
      simular 400 `CLASSIFIER_ERROR` com `message` técnico → ecrã mostra a
      mensagem da tabela, não o `message`).
- [ ] `QUOTA_EXCEEDED` mostra a janela mensal, não "60 segundos".
- [ ] `RATE_LIMIT_EXCEEDED` continua a mostrar `retry_after_seconds` real.
- [ ] Código de erro desconhecido → fallback genérico (nunca crash, nunca `message`).
- [ ] Todos os 12 códigos da tabela §3 cobertos por teste unitário de
      `errorMessageFor`.
- [ ] Tom PT-PT validado — zero PT-BR, zero jargão técnico no output visível.

---

## 5. Fora de âmbito desta spec

- **Configuração das API keys no Vercel** (`OPENAI_API_KEY` / `ANTHROPIC_API_KEY`)
  — causa raiz do 401 observado. Autoridade `@devops`. Esta spec apenas garante
  que, quando um erro acontecer (por qualquer motivo), o utilizador vê uma
  mensagem humana — não o desbloqueio do pipeline.
- Retry automático / backoff — decisão de produto, não incluída aqui.
- Redesenho visual do banner de erro — o estilo actual (`role="alert"`,
  fundo vermelho) mantém-se; só muda o **conteúdo** da mensagem.
