/**
 * Inngest function — `generate-recurring-tasks`.
 *
 * Story 3.7 AC2 — cron diário 03:00 UTC que gera as instâncias futuras das
 * `task_recurrences` activas (FR8). Para cada recorrência devida, expande as
 * ocorrências dentro de um horizonte de 90 dias (D-3.7.1) e insere uma `tasks`
 * por ocorrência, herdando os campos da task template.
 *
 * Implementação:
 *   - Trigger: cron Inngest nativo `0 3 * * *` — alinhado com
 *     `cleanup-expired-reverse-ops` (D-3.7.4 / Story 2.8 D38).
 *   - Handler: `step.run('process-recurrences', ...)` corre todo o trabalho via
 *     `getServiceDb()` (RLS bypass justificado para job sistémico — não há JWT
 *     de utilizador, logo não há `current_household_id()` no contexto).
 *   - Idempotência (R-3.7.1): cada INSERT em `tasks` usa
 *     `ON CONFLICT (recurrence_id, due_date) DO NOTHING` — o índice unique
 *     parcial `tasks_recurrence_id_due_date_unique` (migration 0013) torna
 *     reruns no mesmo dia inofensivos (Inngest tem entrega at-least-once).
 *   - DST (R-3.7.2): a expansão é feita por `expandRecurrence` em
 *     `rrule-helpers.ts`, que converte sempre via `formatInTimeZone`.
 *   - Observability: `withSpan('agent.recurrences.generate', ...)` (AC7) +
 *     `childLogger` Pino estruturado + audit log INSERT agregado (AC6).
 *   - Retry: errors são re-thrown para o Inngest engine retry policy
 *     (ADR-005 max 4 attempts com backoff exponencial).
 *
 * Trace: EPIC-3-EXECUTION.yaml §stories[3.7], Architecture §11.3, Story 2.8
 *        `cleanup-expired-reverse-ops.ts` (template), AC2-AC7.
 */
import { sql } from 'drizzle-orm';

import { childLogger, captureException, withSpan } from '@meu-jarvis/observability';

import { getServiceDb } from '@/lib/agent/db-shim';
import { inngest } from '@/lib/inngest/client';
import {
  EXPAND_HORIZON_DAYS,
  expandRecurrence,
  type RecurrenceFrequency,
} from '@/lib/recurrences/rrule-helpers';

const JOB_ID = 'generate-recurring-tasks';

/** Row de `task_recurrences` lida pela query do cron. */
interface RecurrenceRow {
  readonly id: string;
  readonly household_id: string;
  readonly template_task_id: string;
  readonly frequency: RecurrenceFrequency;
  readonly interval: number;
  readonly custom_rrule: string | null;
  readonly starts_on: string;
  readonly ends_on: string | null;
  readonly next_run_on: string | null;
}

/** Row de `tasks` (template) carregada antes de gerar instâncias. */
interface TemplateTaskRow {
  readonly id: string;
  readonly created_by_user_id: string;
  readonly title: string;
  readonly description: string | null;
  readonly due_time: string | null;
  readonly priority: string;
  readonly project: string | null;
}

/** Resumo agregado devolvido pelo handler. */
export interface GenerateRecurringTasksSummary {
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

export const generateRecurringTasks = inngest.createFunction(
  {
    id: JOB_ID,
    name: 'Generate recurring tasks',
  },
  { cron: '0 3 * * *' },
  async ({ step, runId }: { step: { run: <T>(id: string, cb: () => Promise<T>) => Promise<T> }; runId: string }) => {
    const log = childLogger({ job: JOB_ID });

    return await withSpan('agent.recurrences.generate', {}, async (span) => {
      const startedAt = Date.now();

      const summary = await step.run('process-recurrences', async (): Promise<GenerateRecurringTasksSummary> => {
        const db = getServiceDb();
        const now = new Date();

        let totalGenerated = 0;
        let totalSkipped = 0;
        let processedRecurrences = 0;
        let inactivatedRecurrences = 0;

        try {
          // (1) Recorrências activas devidas — `next_run_on` no passado ou nunca corrido.
          const recurrences = asRows<RecurrenceRow>(
            await db.execute(sql`
              select id, household_id, template_task_id, frequency, interval,
                     custom_rrule, starts_on, ends_on, next_run_on
              from task_recurrences
              where active = true
                and (next_run_on is null or next_run_on <= current_date)
            `),
          );

          for (const r of recurrences) {
            processedRecurrences += 1;

            // (2) Carregar a task template — pode ter sido apagada por uma race.
            const templateRows = asRows<TemplateTaskRow>(
              await db.execute(sql`
                select id, created_by_user_id, title, description, due_time,
                       priority, project
                from tasks
                where id = ${r.template_task_id}
                limit 1
              `),
            );
            const template = templateRows[0];
            if (template === undefined) {
              log.warn(
                { recurrence_id: r.id, template_task_id: r.template_task_id },
                'Task template não encontrada — recorrência ignorada',
              );
              continue;
            }

            // (3) Expandir ocorrências dentro do horizonte (90 dias / DST-safe).
            const expansion = expandRecurrence(
              {
                frequency: r.frequency,
                interval: r.interval,
                customRrule: r.custom_rrule,
                startsOn: r.starts_on,
                endsOn: r.ends_on,
                nextRunOn: r.next_run_on,
              },
              { horizonDays: EXPAND_HORIZON_DAYS, now },
            );

            let generatedForThisRecurrence = 0;
            let skippedForThisRecurrence = 0;

            // (4) INSERT idempotente por ocorrência.
            for (const occ of expansion.occurrences) {
              const inserted = asRows<{ id: string }>(
                await db.execute(sql`
                  insert into tasks (
                    household_id, created_by_user_id, title, description,
                    due_date, due_time, priority, status,
                    kanban_column_id, project,
                    recurrence_id, is_recurrence_template
                  ) values (
                    ${r.household_id}, ${template.created_by_user_id}, ${template.title},
                    ${template.description},
                    ${occ.targetDate}, ${template.due_time}, ${template.priority}, 'todo',
                    null, ${template.project},
                    ${r.id}, false
                  )
                  on conflict (recurrence_id, due_date) where recurrence_id is not null
                  do nothing
                  returning id
                `),
              );
              if (inserted.length > 0) {
                generatedForThisRecurrence += 1;
              } else {
                skippedForThisRecurrence += 1;
              }
            }

            totalGenerated += generatedForThisRecurrence;
            totalSkipped += skippedForThisRecurrence;

            // (5) Actualizar `next_run_on` — ou desactivar se a RRULE esgotou.
            if (expansion.isExhausted) {
              await db.execute(sql`
                update task_recurrences
                set active = false, next_run_on = null, updated_at = now()
                where id = ${r.id}
              `);
              inactivatedRecurrences += 1;
            } else {
              await db.execute(sql`
                update task_recurrences
                set next_run_on = ${expansion.nextRunAfterHorizon}, updated_at = now()
                where id = ${r.id}
              `);
            }

            log.info(
              {
                recurrence_id: r.id,
                count_generated: generatedForThisRecurrence,
                count_skipped: skippedForThisRecurrence,
                is_exhausted: expansion.isExhausted,
              },
              'Recorrência processada',
            );
          }

          log.info(
            {
              total_generated: totalGenerated,
              total_skipped: totalSkipped,
              processed_recurrences: processedRecurrences,
              inactivated_recurrences: inactivatedRecurrences,
            },
            'Geração de tarefas recorrentes completa',
          );
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          log.error({ err: error }, 'Geração de tarefas recorrentes falhou');
          captureException(error, { tags: { job: JOB_ID } });
          throw error; // Inngest retry engine pega (ADR-005 max 4 attempts).
        }

        return {
          total_generated: totalGenerated,
          total_skipped: totalSkipped,
          processed_recurrences: processedRecurrences,
          inactivated_recurrences: inactivatedRecurrences,
        };
      });

      const durationMs = Date.now() - startedAt;

      // (6) Audit log INSERT — 1 row agregada por run (NFR9 / D-3.7.2).
      // Falha não-fatal: não aborta o job (pattern Story 2.8 AC5 v1.1).
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
            null, null, 'recurrences_generated',
            'task_recurrences', null,
            null, ${afterState}::jsonb,
            null, null, ${runId}
          )
        `);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        log.warn({ err: error }, 'Audit log INSERT falhou (não-fatal)');
        captureException(error, { tags: { job: JOB_ID, phase: 'audit_log' } });
      }

      // (7) Atributos do span — whitelist sem PII (AC7 / NFR12).
      span.setAttribute('recurrences.processed_count', summary.processed_recurrences);
      span.setAttribute('recurrences.generated_count', summary.total_generated);
      span.setAttribute('recurrences.skipped_count', summary.total_skipped);
      span.setAttribute('recurrences.inactivated_count', summary.inactivated_recurrences);
      span.setAttribute('recurrences.horizon_days', EXPAND_HORIZON_DAYS);
      span.setAttribute('recurrences.duration_ms', durationMs);
      span.setAttribute('inngest.run_id', runId);

      return summary;
    });
  },
);
