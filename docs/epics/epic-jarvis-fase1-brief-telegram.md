# Epic Jarvis Fase 1 — Brief Diário Proactivo no Telegram

**Status:** In Progress — J-1 próxima story
**Owner:** @pm (Morgan) / @sm (River)
**Criado:** 23/06/2026
**PRD de referência:** `docs/prd-jarvis.md` v1.1 (aprovado 22/06/2026 — @architect CONCERNS 8/10 + @po GO 8,5/10)
**Visão:** `docs/jarvis-north-star.md`
**Depends on:** Epic 1 Done · Epic 2 (classifier 95% provado) · Epic 3 (Inngest cron padrão) · Epic 4 (tools tarefas+finanças) · Epic 5 (agregadores visão)

---

## Objectivo da Fase 1

Transformar o Jarvis pessoal do Eurico: o canal de conversa deixa de ser um painel lateral da web app e passa a ser um **bot de Telegram**. O motor cognitivo existente (classificar → planear → executar, com undo 30 s) passa a ser a camada de acções por baixo dessa conversa. O brief diário proactivo (07:30 Europe/Lisbon) prova a espinha — agenda + tarefas + finanças, em PT-PT natural, com acção a partir da resposta no chat.

A Fase 1 está concluída quando o Eurico é acordado pelo Jarvis todos os dias no Telegram e consegue responder em conversa — tarefas e finanças — sem abrir a web app.

---

## Stories da Fase 1

| ID | Título | Status | Depende de |
|----|--------|--------|------------|
| **J-1** | Bot Telegram echo seguro | **Draft — PRÓXIMA** | — |
| J-2 | `chat_id` → household + acção via motor | A draftar | J-1 |
| J-3 | Google Calendar OAuth readonly + cifragem de tokens | A draftar | J-1 |
| J-4 | Job Inngest `morning-brief` + síntese conversacional LLM | A draftar | J-2, J-3 |

### Sequenciamento (espinha primeiro)

A ordem respeita a directiva de disciplina da espinha do PRD §10: provar a tubagem do canal (J-1) antes de tocar no motor, depois ligar a identidade (J-2), depois a agenda (J-3), finalmente o brief completo (J-4).

- **J-1** — establece o webhook, a allowlist de `chat_id` e a verificação do secret token. Resposta echo ao Eurico. Zero motor, zero tabelas de domínio novas — prova a tubagem SEM risco.
- **J-2** — o coração: resolve `chat_id` → `{userId, householdId}` via tabela `telegram_link`, extrai `runAgentForHousehold` do route handler existente (desacoplamento §4.6 do PRD), liga o Telegram ao motor. Cria a migração 0025 com `telegram_link` (4 RLS policies). Fluxos A/B/C do PRD §3.2.
- **J-3** — integração Google Calendar: OAuth single-user `calendar.readonly`, cifra `refresh_token` em AES-256-GCM (`node:crypto`), tabela `google_oauth_tokens` (migration 0026). Cria também `jarvis_facts` (migration 0026). Leitura de eventos de hoje.
- **J-4** — job Inngest `morning-brief` com cron `TZ=Europe/Lisbon 30 7 * * *`, agrega Calendar + tarefas + finanças, passo LLM síntese PT-PT, idempotência por `{householdId, dia}`. Entrega ao `chat_id` do Eurico.

---

## Restrições globais (todas as stories)

- PT-PT europeu exclusivo (NFR-J8).
- Dados na UE: Vercel `fra1`, Supabase `eu-central-1`, Inngest EU (NFR-J1).
- Billing CONGELADO — sem tocar em `subscriptions`, `stripe_*`, `payment_events`.
- SEC-8 HOLD — não alterar `withHousehold` nem o `db-shim.ts` sem aprovação explícita.
- Feature família removida; `household_id`/RLS intactos — não reintroduzir família, não remover `household_id`.
- Qualquer tabela nova com `household_id` obriga a 4 RLS policies (select/insert/update/delete) ou `pnpm check:rls` parte o build (NFR-J6 / NFR5 global).
- `TELEGRAM_BOT_TOKEN`, secret do webhook, `OAUTH_TOKEN_ENCRYPTION_KEY` e credenciais OAuth em Vercel Env (UE), nunca em git.
- Bot API chamada via `fetch` nativo — sem dependência nova para J-1 e J-2; `googleapis` apenas em J-3 (decisão a confirmar na altura).

---

## Métricas de sucesso (Fase 1)

Medidas sobre 1 utilizador (Eurico), após 2 semanas:

| KPI | Alvo |
|-----|------|
| Briefs entregues / dias activos | ≥ 95% |
| Dias com pelo menos 1 resposta-em-conversa ao brief | ≥ 60% (janela 2 semanas) |
| Acções executadas via Telegram (tarefas + finanças) com sucesso | maioria das intenções do dia-a-dia |
| Avaliação qualitativa do Eurico "sentiu-se útil?" após 2 semanas | go/no-go para v1.1 |

---

*Epic criado por @sm River, 23/06/2026. Fonte de verdade: `docs/prd-jarvis.md` v1.1.*
