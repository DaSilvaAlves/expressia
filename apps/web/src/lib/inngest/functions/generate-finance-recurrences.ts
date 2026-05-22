/**
 * Inngest function — `generate-finance-recurrences`.
 *
 * Story 4.5 AC3 — cron diário 03:00 UTC que materializa as transacções das
 * `recurrences` de Finanças activas cujo `next_run_on <= today` (FR14, DP4=A).
 * Para cada recorrência devida, insere UMA `transactions` row (o dia corrente —
 * sem expansão de horizonte) e actualiza `next_run_on` para a ocorrência
 * seguinte (ou inactiva a recorrência se esgotada).
 *
 * Implementação:
 *   - Trigger: cron Inngest nativo `0 3 * * *` — alinhado com
 *     `cleanup-expired-reverse-ops` (Story 2.8 D38) e `generate-recurring-tasks`
 *     (Story 3.7 D-3.7.4).
 *   - Handler: `step.run('generate-finance-transactions', ...)` corre todo o
 *     trabalho via `getServiceDb()` (RLS bypass justificado para job sistémico —
 *     não há JWT de utilizador, logo não há `current_household_id()` no
 *     contexto; padrão Story 3.7 D-3.7.5 / Story 2.8 D38).
 *   - Idempotência (R-4.5): cada INSERT em `transactions` usa
 *     `ON CONFLICT (recurrence_id, transaction_date) DO NOTHING` — o índice
 *     unique parcial `transactions_recurrence_id_date_unique` (migration 0015)
 *     torna reruns no mesmo dia inofensivos (Inngest tem entrega
 *     at-least-once).
 *   - Próxima data: `calcNextRunDate` (`finance-recurrence-helpers.ts`) —
 *     aritmética de calendário pura, sem RRULE (D-4.5.2).
 *   - `is_projected = false` (D-4.5.3): a transacção do dia corrente já
 *     "ocorreu" — entra nos totais reais da vista mensal, não na projecção.
 *   - Observability: `withSpan('finance.recurrences.generate', ...)` (AC5) +
 *     `childLogger` Pino estruturado + audit log INSERT agregado (AC5).
 *   - Retry: errors são re-thrown para o Inngest engine retry policy
 *     (ADR-005 max 4 attempts com backoff exponencial).
 *
 * Trace: Story 4.5 AC3-AC5, Architecture §11.3, Story 3.7
 *        `generate-recurring-tasks.ts` (template), DP4=A, DP8=A.
 */
import { sql } from 'drizzle-orm';

import { childLogger, captureException, withSpan } from '@meu-jarvis/observability';

import { getServiceDb } from '@/lib/agent/db-shim';
import {
  FINANCE_CRON_ID,
  calcNextRunDate,
  type FinanceRecurrenceFrequency,
} from '@/lib/finance/finance-recurrence-helpers';
import { inngest } from '@/lib/inngest/client';

const JOB_ID = FINANCE_CRON_ID;

/** Row de `recurrences` (Finanças) lida pela query do cron. */
interface FinanceRecurrenceRow {
  readonly id: string;
  readonly household_id: string;
  readonly created_by_user_id: string;
  readonly description: string;
  readonly kind: string;
  readonly amount_cents: number;
  readonly currency: string;
  readonly account_id: string | null;
  readonly card_id: string | null;
  readonly category_id: string | null;
  readonly payment_method: string;
  readonly frequency: FinanceRecurrenceFrequency;
  readonly interval: number;
  readonly custom_rrule: string | null;
  readonly starts_on: string;
  readonly ends_on: string | null;
  readonly next_run_on: string | null;
}

/** Resumo agregado devolvido pelo handler. */
export interface GenerateFinanceRecurrencesSummary {
  readonly total_generated: number;
  readonly total_skipped: number;
  readonly processed_recurrences: number;
  readonly inactivated_recurrences: number;
}

/**
 * Normaliza o resultado de uma query `postgres-js` para um array de rows.
 * O driver pode devolver um array directo ou um objecto — defensivo.
 */
function asRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return [];
}

/** Data de calendário de hoje (UTC) em formato YYYY-MM-DD. */
function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

export const generateFinanceRecurrences = inngest.createFunction(
  {
    id: JOB_ID,
    name: 'Generate finance recurrences',
  },
  { cron: '0 3 * * *' },
  async ({ step, runId }: { step: { run: <T>(id: string, cb: () => Promise<T>) => Promise<T> }; runId: string }) => {
    const log = childLogger({ job: JOB_ID });

    return await withSpan('finance.recurrences.generate', {}, async (span) => {
      const startedAt = Date.now();

      const summary = await step.run(
        'generate-finance-transactions',
        async (): Promise<GenerateFinanceRecurrencesSummary> => {
          const db = getServiceDb();
          const today = todayDateString();

          let totalGenerated = 0;
          let totalSkipped = 0;
          let processedRecurrences = 0;
          let inactivatedRecurrences = 0;

          try {
            // (1) Recorrências de Finanças activas devidas — `next_run_on` no
            // passado/hoje ou nunca corrido (DP4=A — só o dia corrente).
            const recurrences = asRows<FinanceRecurrenceRow>(
              await db.execute(sql`
                select id, household_id, created_by_user_id, description, kind,
                       amount_cents, currency, account_id, card_id, category_id,
                       payment_method, frequency, interval, custom_rrule,
                       starts_on, ends_on, next_run_on
                from recurrences
                where active = true
                  and (next_run_on is null or next_run_on <= ${today})
                order by id
              `),
            );

            for (const r of recurrences) {
              processedRecurrences += 1;

              // (2) Data da transacção — `next_run_on`, ou `starts_on` se a
              // recorrência nunca correu (primeira execução do cron).
              const transactionDate = r.next_run_on ?? r.starts_on;

              // (3) INSERT idempotente — ON CONFLICT (recurrence_id,
              // transaction_date) DO NOTHING (R-4.5). `is_projected = false`
              // (D-4.5.3 — a transacção do dia corrente já ocorreu).
              const inserted = asRows<{ id: string }>(
                await db.execute(sql`
                  insert into transactions (
                    household_id, created_by_user_id,
                    account_id, card_id, category_id,
                    amount_cents, currency, kind, description,
                    transaction_date, payment_method,
                    recurrence_id, is_projected,
                    agent_run_id, notes
                  ) values (
                    ${r.household_id}, ${r.created_by_user_id},
                    ${r.account_id}, ${r.card_id}, ${r.category_id},
                    ${r.amount_cents}, 'EUR', ${r.kind}, ${r.description},
                    ${transactionDate}, ${r.payment_method},
                    ${r.id}, false,
                    null, null
                  )
                  on conflict (recurrence_id, transaction_date)
                    where recurrence_id is not null
                  do nothing
                  returning id
                `),
              );
              const generatedForThisRecurrence = inserted.length > 0 ? 1 : 0;
              const skippedForThisRecurrence = inserted.length > 0 ? 0 : 1;
              totalGenerated += generatedForThisRecurrence;
              totalSkipped += skippedForThisRecurrence;

              // (4) Calcular a próxima data — ou inactivar se esgotada.
              const nextDate = calcNextRunDate(
                {
                  frequency: r.frequency,
                  interval: r.interval,
                  customRrule: r.custom_rrule,
                  endsOn: r.ends_on,
                },
                transactionDate,
              );

              if (nextDate === null) {
                // Recorrência esgotada (`ends_on` ultrapassado) — inactivar.
                await db.execute(sql`
                  update recurrences
                  set active = false, next_run_on = null, updated_at = now()
                  where id = ${r.id}
                `);
                inactivatedRecurrences += 1;
              } else {
                await db.execute(sql`
                  update recurrences
                  set next_run_on = ${nextDate}, updated_at = now()
                  where id = ${r.id}
                `);
              }

              log.info(
                {
                  recurrence_id: r.id,
                  transaction_date: transactionDate,
                  count_generated: generatedForThisRecurrence,
                  count_skipped: skippedForThisRecurrence,
                  inactivated: nextDate === null,
                },
                'Recorrência financeira processada',
              );
            }

            log.info(
              {
                total_generated: totalGenerated,
                total_skipped: totalSkipped,
                processed_recurrences: processedRecurrences,
                inactivated_recurrences: inactivatedRecurrences,
              },
              'Geração de transacções recorrentes completa',
            );
          } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            log.error({ err: error }, 'Geração de transacções recorrentes falhou');
            captureException(error, { tags: { job: JOB_ID } });
            throw error; // Inngest retry engine pega (ADR-005 max 4 attempts).
          }

          return {
            total_generated: totalGenerated,
            total_skipped: totalSkipped,
            processed_recurrences: processedRecurrences,
            inactivated_recurrences: inactivatedRecurrences,
          };
        },
      );

      const durationMs = Date.now() - startedAt;

      // (5) Audit log INSERT — 1 row agregada por run (NFR9 / D-3.7.2).
      // Falha não-fatal: não aborta o job (pattern Story 3.7 AC6 / Story 2.8).
      try {
        const db = getServiceDb();
        const afterState = JSON.stringify({
          total_generated: summary.total_generated,
          total_skipped: summary.total_skipped,
          processed_recurrences: summary.processed_recurrences,
          inactivated_recurrences: summary.inactivated_recurrences,
          duration_ms: durationMs,
          run_id: runId,
        });
        await db.execute(sql`
          insert into audit_log (
            household_id, user_id, action,
            entity_table, entity_id,
            before_state, after_state,
            ip, user_agent, trace_id
          ) values (
            null, null, 'finance_recurrences_generated',
            'recurrences', null,
            null, ${afterState}::jsonb,
            null, null, ${runId}
          )
        `);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        log.warn({ err: error }, 'Audit log INSERT falhou (não-fatal)');
        captureException(error, { tags: { job: JOB_ID, phase: 'audit_log' } });
      }

      // (6) Atributos do span — whitelist sem PII (AC5 / NFR12).
      span.setAttribute('finance.recurrences.processed_count', summary.processed_recurrences);
      span.setAttribute('finance.recurrences.generated_count', summary.total_generated);
      span.setAttribute('finance.recurrences.skipped_count', summary.total_skipped);
      span.setAttribute('finance.recurrences.inactivated_count', summary.inactivated_recurrences);
      span.setAttribute('finance.cron.duration_ms', durationMs);
      span.setAttribute('inngest.run_id', runId);

      return summary;
    });
  },
);
