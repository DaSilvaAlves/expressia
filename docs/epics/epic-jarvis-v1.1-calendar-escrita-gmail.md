# Epic Jarvis v1.1 — Calendar Escrita + Gmail

**Status:** In Progress — J-5 Done (live em prod 27/06/2026); J-6 (Gmail readonly) a arrancar
**Owner:** @pm (Morgan) / @sm (River)
**Criado:** 26/06/2026
**PRD de referência:** `docs/prd-jarvis.md` v1.1, §9 (roadmap v1.1)
**Visão:** `docs/jarvis-north-star.md`
**Depends on:** Epic Jarvis Fase 1 Done (J-1·J-2·J-3·J-4 todos Done em prod, 26/06/2026)

---

## Objectivo da v1.1

A Fase 1 provou a espinha: o Eurico é acordado pelo Jarvis todos os dias no Telegram com brief diário (agenda + tarefas + finanças) e consegue agir em conversa (tarefas e finanças). A v1.1 aprofunda as duas capacidades em falta:

1. **Calendar escrita** — o Eurico pode marcar e reagendar eventos da agenda directamente a partir do Telegram. Requer scope OAuth de escrita (`calendar.events`) e novos intents/tools no motor.
2. **Gmail** — o Eurico recebe no brief um resumo dos emails que pedem resposta e pode pedir ao Jarvis que leia ou responda a emails. Scope OAuth `gmail.readonly` + `gmail.send` (separado — mais sensível que Calendar). Entrado logo a seguir a Calendar.

A disciplina da espinha mantém-se: Calendar antes de Gmail (Calendar write é mais simples de testar e menos sensível).

---

## Stories da v1.1

| ID | Título | Status | Depende de |
|----|--------|--------|------------|
| **J-5** | Calendar escrita — intents + tools (marcar e reagendar eventos via Telegram) | **Done (E2E live em prod 27/06)** | J-3 Done (OAuth readonly; scope a actualizar para write) |
| J-6 | Gmail readonly — brief com resumo de email + leitura a pedido | A draftar (próxima) | J-5 Done ✅ |
| J-7 | Gmail send — responder/compor email a partir do Telegram | A draftar | J-6 Done |

*Nota: IDs de story seguem a série J-* estabelecida na Fase 1 (J-1..J-4). A v1.1 começa em J-5.*

---

## Restrições globais (herdadas da Fase 1)

- PT-PT europeu exclusivo (NFR-J8).
- Dados na UE: Vercel `fra1`, Supabase `eu-central-1`, Inngest EU (NFR-J1).
- Billing CONGELADO — sem tocar em `subscriptions`, `stripe_*`, `payment_events`.
- SEC-8 HOLD — não alterar `withHousehold` nem `db-shim.ts` sem aprovação explícita.
- Família removida; `household_id`/RLS intactos.
- Qualquer tabela nova com `household_id` obriga a 4 RLS policies ou `pnpm check:rls` parte o build (NFR-J6 / NFR5).

---

## Nota sobre OAuth scopes

| Fase | Scope | Capabilities |
|------|-------|--------------|
| Fase 1 (J-3 — em prod) | `calendar.readonly openid email` | Leitura de eventos (brief diário) |
| **v1.1 (J-5)** | `calendar.events openid email` | Leitura + **escrita/update de eventos** |
| v1.1 (J-6) | `gmail.readonly openid email` | Leitura de threads Gmail |
| v1.1 (J-7) | `gmail.send` (+ acima) | Envio de emails |

A passagem de `calendar.readonly` para `calendar.events` exige **re-consentimento OAuth one-shot** do Eurico (o `refresh_token` existente em `google_oauth_tokens` foi emitido com scope readonly — o Google não adiciona scopes a tokens existentes sem nova autorização). O Eurico faz o re-consentimento através de `/api/google/auth-url`, que faz upsert do novo token. CRÍTICO: usar a conta principal `euricojsalves@gmail.com` (household `2dedb1ec`) — lição de J-3.

---

*Epic criado por @sm River, 26/06/2026. Fonte de verdade: `docs/prd-jarvis.md` v1.1 §9.*
