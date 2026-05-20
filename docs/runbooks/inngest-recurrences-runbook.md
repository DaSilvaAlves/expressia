# Runbook — Inngest function `generate-recurring-tasks`

**Owner:** @devops (operação) + @dev (lógica)
**Quando executar:** após o `inngest-setup.md` completo (EB4 satisfeito) e o push da Story 3.7.
**Pré-requisitos:** workspace Inngest EU Frankfurt provisionado, Vercel env vars
`INNGEST_EVENT_KEY` + `INNGEST_SIGNING_KEY` populadas, migration `0013` aplicada.

A Story 3.7 introduz a segunda função Inngest do projecto:
`generate-recurring-tasks` — cron diário 03:00 UTC que gera as instâncias
futuras das `task_recurrences` activas (FR8). Sem o `inngest-setup.md`
completo em produção, o endpoint `/api/inngest` arranca mas a função nunca é
invocada (Inngest Cloud não chama o endpoint sem registo).

---

## Visão geral

| Item | Valor |
|------|-------|
| Function ID | `generate-recurring-tasks` |
| Trigger | cron `0 3 * * *` (03:00 UTC diário) |
| Horizonte de geração | 90 dias (D-3.7.1 / EPIC DP6) |
| RLS | bypass via `getServiceDb()` — job sistémico sem JWT de utilizador |
| Idempotência | índice unique parcial `tasks_recurrence_id_due_date_unique` + `INSERT ON CONFLICT DO NOTHING` |
| Audit | 1 row agregada por run em `audit_log` (`action = recurrences_generated`) |
| OTel span | `agent.recurrences.generate` |
| Retry | Inngest engine, máx 4 attempts com backoff exponencial (ADR-005) |

---

## Step 1 — Aplicar a migration `0013`

Antes de qualquer invocação, a migration `0013_audit_action_recurrences_generated.sql`
tem de estar aplicada (adiciona o enum value `recurrences_generated` + o índice
de idempotência). Aplicar via:

```bash
pnpm --filter @meu-jarvis/db db:migrate
```

**Verificação:** confirmar que `__schema_migrations` contém `0013` e que
`select 'recurrences_generated'::audit_action` não falha.

---

## Step 2 — Smoke test (invocação manual)

1. Aceder ao dashboard Inngest → workspace `expressia-prod` → **Functions**.
2. Localizar `generate-recurring-tasks` — deve aparecer com o trigger cron.
3. Clicar **Invoke** → confirmar a invocação manual sem payload.
4. Verificar o **Output** JSON do run:

```json
{
  "total_generated": 12,
  "total_skipped": 0,
  "processed_recurrences": 3,
  "inactivated_recurrences": 0
}
```

5. Confirmar na base de dados:
   - novas rows em `tasks` com `recurrence_id` não-nulo e `is_recurrence_template = false`;
   - 1 nova row em `audit_log` com `action = 'recurrences_generated'`.

Rerun imediato do mesmo smoke test deve produzir `total_generated = 0` e
`total_skipped` igual ao número de ocorrências (idempotência — R-3.7.1).

---

## Step 3 — Monitoring

| Sinal | Onde | Filtro |
|-------|------|--------|
| Logs estruturados Pino | Grafana Cloud | `job = "generate-recurring-tasks"` |
| Span de tracing | Grafana Cloud (traces) | `agent.recurrences.generate` |
| Errors | Sentry | `tags.job = "generate-recurring-tasks"` |
| Histórico de runs | Inngest dashboard | Functions → `generate-recurring-tasks` → Runs |

Atributos do span (whitelist sem PII — NFR12): `recurrences.processed_count`,
`recurrences.generated_count`, `recurrences.skipped_count`,
`recurrences.inactivated_count`, `recurrences.horizon_days`,
`recurrences.duration_ms`, `inngest.run_id`.

Os logs Pino têm detalhe por recorrência (`recurrence_id`, `count_generated`,
`count_skipped`, `is_exhausted`) — o `audit_log` é apenas compliance (1 row
agregada por run).

---

## Step 4 — Failure modes

| Falha | Comportamento | Acção |
|-------|---------------|-------|
| RRULE `custom_rrule` inválido | `expandRecurrence` lança → `captureException` → re-throw | Inngest faz retry; corrigir a RRULE via API `/recurrences` PATCH |
| DB connection timeout | error re-thrown ao Inngest engine | retry automático 4× com backoff (ADR-005) |
| Task template apagada (race) | warn log + skip dessa recorrência + continua restantes | nenhuma — comportamento esperado |
| Audit log INSERT falha | warn log + `captureException` (phase `audit_log`) — **não-fatal** | nenhuma; o job conclui na mesma. Investigar se recorrente |
| Mesmo cron tick disparado 2× (at-least-once) | `ON CONFLICT DO NOTHING` → zero duplicados | nenhuma — idempotência por design |

---

## Step 5 — Rollback

Para parar a geração sem redeploy:

1. Dashboard Inngest → Functions → `generate-recurring-tasks` → **... → Pause**.
2. As tarefas já geradas **não são afectadas** (o Inngest não tem reversal
   automático). Se for necessário remover tarefas geradas erradamente:

   ```sql
   -- ATENÇÃO: destrutivo. Confirmar o recurrence_id antes de correr.
   delete from tasks
   where recurrence_id = '<recurrence-uuid>'
     and is_recurrence_template = false
     and status = 'todo'
     and due_date > current_date;
   ```

Para reactivar: **... → Resume** no mesmo menu.

---

## Step 6 — Performance

| Métrica | Alvo | Notas |
|---------|------|-------|
| Wall-clock por run | ≤ 60s para 1000 recorrências activas | EPIC §performance_budgets |
| MVP esperado | < 2s | < 100 recorrências activas previstas |
| INSERTs por run (worst case) | ~9000 (90d × 100 recorrências) | recorrências realistas são mensais → ~3000 |

O índice `task_recurrences_next_run_idx` em `(next_run_on, active)` torna a
query do cron eficiente; o índice unique parcial mantém os `ON CONFLICT`
rápidos. Se o número de recorrências activas crescer muito (Epic 6+),
considerar batching dos INSERTs ou janela de cron dedicada.

---

## Notas

- Esta função partilha o cron `0 3 * * *` com `cleanup-expired-reverse-ops`
  (Story 2.8). O Inngest serializa `step.run` em caso de contenção — o impacto
  no MVP é negligenciável (D-3.7.4).
- Dev local: `npx inngest-cli@latest dev -u http://localhost:3000/api/inngest`
  regista ambas as funções no engine local (porta 8288).

Trace: Story 3.7 AC10, EPIC-3-EXECUTION.yaml §stories[3.7], ADR-005 §14.5.
