# Runbook — Inngest function `generate-finance-recurrences`

**Owner:** @devops (operação) + @dev (lógica)
**Quando executar:** após o `inngest-setup.md` completo (EB4 satisfeito) e o push da Story 4.5.
**Pré-requisitos:** workspace Inngest EU Frankfurt provisionado, Vercel env vars
`INNGEST_EVENT_KEY` + `INNGEST_SIGNING_KEY` populadas, migration `0015` aplicada.

A Story 4.5 introduz a terceira função Inngest do projecto:
`generate-finance-recurrences` — cron diário 03:00 UTC que materializa as
transacções das `recurrences` de Finanças activas cujo `next_run_on <= today`
(FR14, DP4=A). Sem o `inngest-setup.md` completo em produção, o endpoint
`/api/inngest` arranca mas a função nunca é invocada (Inngest Cloud não chama
o endpoint sem registo).

---

## Visão geral

| Item | Valor |
|------|-------|
| Function ID | `generate-finance-recurrences` |
| Trigger | cron `0 3 * * *` (03:00 UTC diário) |
| Horizonte de geração | Só o dia corrente (DP4=A) — sem expansão multi-dia |
| RLS | bypass via `getServiceDb()` — job sistémico sem JWT de utilizador |
| Idempotência | índice unique parcial `transactions_recurrence_id_date_unique` + `INSERT ON CONFLICT DO NOTHING` |
| Audit | 1 row agregada por run em `audit_log` (`action = finance_recurrences_generated`) |
| OTel span | `finance.recurrences.generate` |
| Retry | Inngest engine, máx 4 attempts com backoff exponencial (ADR-005) |

---

## Step 1 — Aplicar a migration `0015`

Antes de qualquer invocação, a migration `0015_finance_recurrences_generated_audit.sql`
tem de estar aplicada (adiciona o enum value `finance_recurrences_generated` +
o índice de idempotência `transactions_recurrence_id_date_unique`). Aplicar via:

```bash
pnpm --filter @meu-jarvis/db db:migrate
```

**Verificação:** confirmar que `__schema_migrations` contém `0015` e que
`select 'finance_recurrences_generated'::audit_action` não falha.

---

## Step 2 — Smoke test (invocação manual)

1. Aceder ao dashboard Inngest → workspace `expressia-prod` → **Functions**.
2. Localizar `generate-finance-recurrences` — deve aparecer com o trigger cron.
3. Clicar **Invoke** → confirmar a invocação manual sem payload.
4. Verificar o **Output** JSON do run:

```json
{
  "total_generated": 12,
  "total_skipped": 0,
  "processed_recurrences": 12,
  "inactivated_recurrences": 1
}
```

5. Confirmar na base de dados:
   - novas rows em `transactions` com `recurrence_id` não-nulo e `is_projected = false`;
   - `recurrences.next_run_on` actualizado para a próxima ocorrência;
   - 1 nova row em `audit_log` com `action = 'finance_recurrences_generated'`.

Rerun imediato do mesmo smoke test deve produzir `total_generated = 0` e
`total_skipped` igual ao número de recorrências devidas (idempotência — R-4.5).

---

## Step 3 — Monitoring

| Sinal | Onde | Filtro |
|-------|------|--------|
| Logs estruturados Pino | Grafana Cloud | `job = "generate-finance-recurrences"` |
| Span de tracing | Grafana Cloud (traces) | `finance.recurrences.generate` |
| Errors | Sentry | `tags.job = "generate-finance-recurrences"` |
| Histórico de runs | Inngest dashboard | Functions → `generate-finance-recurrences` → Runs |

Atributos do span (whitelist sem PII — NFR12): `finance.recurrences.processed_count`,
`finance.recurrences.generated_count`, `finance.recurrences.skipped_count`,
`finance.recurrences.inactivated_count`, `finance.cron.duration_ms`,
`inngest.run_id`.

Os logs Pino têm detalhe por recorrência (`recurrence_id`, `transaction_date`,
`count_generated`, `count_skipped`, `inactivated`) — o `audit_log` é apenas
compliance (1 row agregada por run, NUNCA com `description` ou valores
monetários).

---

## Step 4 — Failure modes

| Falha | Comportamento | Acção |
|-------|---------------|-------|
| DB connection timeout | error re-thrown ao Inngest engine | retry automático 4× com backoff (ADR-005) |
| Recurrence com `account_id` e `card_id` ambos NULL | impossível — o CHECK `recurrences_account_or_card` rejeita na criação (Story 4.4 API); o cron confia que as recurrences são válidas. Se chegasse ao cron, o CHECK `transactions_account_or_card` faria o INSERT falhar → re-throw → retry | corrigir a recorrência via API `/financas/recorrencias` PATCH |
| Audit log INSERT falha | warn log + `captureException` (phase `audit_log`) — **não-fatal** | nenhuma; o job conclui na mesma. Investigar se recorrente |
| Mesmo cron tick disparado 2× (at-least-once) | `ON CONFLICT DO NOTHING` → zero duplicados | nenhuma — idempotência por design (R-4.5) |
| Recorrência `frequency = 'custom'` | `calcNextRunDate` trata como `monthly` (fallback MVP — D-4.5.4) — `custom_rrule` ignorado | limitação MVP conhecida; a cadência pode divergir da configurada. Implementar parser RRULE dedicado em iteração futura |

---

## Step 5 — Rollback

Para parar a geração sem redeploy:

1. Dashboard Inngest → Functions → `generate-finance-recurrences` → **... → Pause**.
2. As transacções já geradas **não são afectadas** (o Inngest não tem reversal
   automático). Se for necessário remover transacções geradas erradamente:

   ```sql
   -- ATENÇÃO: destrutivo. Confirmar o recurrence_id e a data antes de correr.
   delete from transactions
   where recurrence_id = '<recurrence-uuid>'
     and transaction_date = '<YYYY-MM-DD>';
   ```

Para reactivar: **... → Resume** no mesmo menu.

---

## Step 6 — Performance

| Métrica | Alvo | Notas |
|---------|------|-------|
| Wall-clock por run | ≤ 30s para 100 recorrências activas | operação simples — 1 INSERT + 1 UPDATE por recorrência |
| MVP esperado | < 1s | < 100 recorrências activas previstas; cada INSERT < 5ms |
| INSERTs por run | = nº de recorrências devidas | DP4=A — só o dia corrente, sem expansão de horizonte |

O índice `recurrences_next_run_idx` em `(next_run_on, active)` torna a query
do cron eficiente; o índice unique parcial `transactions_recurrence_id_date_unique`
mantém os `ON CONFLICT` rápidos. A operação é substancialmente mais leve que
`generate-recurring-tasks` (Tarefas) — sem expansão RRULE, sem horizonte 90d.

---

## Notas

- Esta função partilha o cron `0 3 * * *` com `cleanup-expired-reverse-ops`
  (Story 2.8) e `generate-recurring-tasks` (Story 3.7). O Inngest serializa
  `step.run` em caso de contenção — o impacto no MVP é negligenciável.
- As prestações (`installments`) NÃO são scope deste cron (DP8=A) — são geradas
  atomicamente na criação do installment pela API (Story 4.4).
- Dev local: `npx inngest-cli@latest dev -u http://localhost:3000/api/inngest`
  regista as três funções no engine local (porta 8288).

Trace: Story 4.5 AC8, DP4=A, DP8=A, ADR-005 §14.5.
