# Revisão @po (Pax) — PRD Jarvis Fase 1

**Data:** 22/06/2026 · **Documento:** `docs/prd-jarvis.md` v1.0 · **Revisor:** Pax (Balancer, @po)
**Veredicto:** GO — 8,5/10 (escala AIOX, GO ≥ 7). Lane de revisão, não de autoria — PRD não editado.

## Fidelidade ao codebase (verificado)

| Alegação do PRD | Verificação | Resultado |
|---|---|---|
| Reutiliza classifier/planner-executor/tools/agent | `packages/{classifier,planner-executor,tools,agent}` existem | OK |
| Orquestração em `api/agent/prompt/route.ts` | Existe; POST resolve `householdId` via `resolveHouseholdId` + `withHousehold` (L182/206) | OK |
| Agregadores em `lib/visao/queries.ts` | `getTasksToday` L135, `getTasksOverdue` L169, `getFinancesMonth` L213 | OK |
| `/api/visao/briefing` é stub forward-compatible | route.ts + `getBriefing()` L377 `version:1 available:false` | OK |
| Cron real = Inngest nativo UTC, sem `vercel.json crons` | `generate-recurring-tasks.ts` `cron '0 3 * * *'` + `getServiceDb()` | OK (Apêndice A correcto) |
| Classifier não conhece intents calendário/email | `INTENT_VALUES` (schemas.ts:38-60) só tarefas+finanças+consultar/cancelar/unknown | OK |
| prefs já tem widget `briefing` | `prefs.ts:45/71` | OK |
| telegram_link / google_oauth_tokens / jarvis_facts são novos | zero ocorrências em `packages/db/` | OK |
| redaction reutilizável | `packages/agent/src/redaction.ts` existe | OK |

## Achado de fidelidade NÃO registado no PRD (PO-FIX-1)

`getCalendarWeek` JÁ EXISTE em `queries.ts:331` mas lê `public.tasks` com prazo nos próximos 7 dias — é um "calendário de tarefas", NÃO a agenda Google. O PRD lista Calendar como 100% novo e não avisa deste homónimo. Risco: o @sm pode confundir as duas coisas. Fix: nota no Apêndice A a distinguir `getCalendarWeek` (tarefas) da nova leitura OAuth Google (`lib/google/`).
