/**
 * Inngest function — `expire-trials`.
 *
 * Story 6.4 (FR33 / Epic 6 AC2) — cron diário 03:00 UTC que detecta as
 * subscrições em trial cuja `trial_ends_at` expirou e regride o household a
 * Free. Utilizadores que não fizeram upgrade após os 14 dias de trial deixam
 * de ter acesso ao tier `familia`, sem intervenção manual.
 *
 * Implementação:
 *   - Trigger: cron Inngest nativo `0 3 * * *` — alinhado com
 *     `generate-finance-recurrences` (Story 4.5), `generate-recurring-tasks`
 *     (Story 3.7) e `cleanup-expired-reverse-ops` (Story 2.8).
 *   - Handler: `step.run('expire-trialing-subscriptions', ...)` corre todo o
 *     trabalho via `getServiceDb()`. RLS bypass justificado para job sistémico:
 *     não há JWT de utilizador (logo não há `current_household_id()` no
 *     contexto) e `subscriptions` tem INSERT/UPDATE/DELETE bloqueados para
 *     `authenticated` (0001_rls_policies.sql:185-196). Excepção permanente
 *     auditada em SEC-10 (db-shim.ts categoria 1 — jobs Inngest cron).
 *
 *   - Atomicidade (AC2 / R-6.4.2) — **PO-MUST-FIX-2:** ao contrário do modelo
 *     `generate-finance-recurrences.ts` (cada `db.execute()` auto-commita
 *     isoladamente), os 2 UPDATEs de cada subscription correm dentro de um
 *     `db.transaction(async (tx) => { ... })` — atomicidade POR-SUBSCRIPTION.
 *     Se o UPDATE de `households` falhar, o UPDATE de `subscriptions` faz
 *     rollback: zero divergência entre `subscriptions.plan` e `households.plan`.
 *     A transacção é por-subscription (não por-batch) para que uma falha tardia
 *     não reverta os trials já correctamente expirados.
 *
 *   - Idempotência (AC3 / R-6.4.3): o WHERE `status = 'trialing'` na SELECT e a
 *     segunda linha de defesa `AND status = 'trialing'` no UPDATE de
 *     `subscriptions` tornam reruns no mesmo dia inofensivos (Inngest tem
 *     entrega at-least-once). Uma subscription já `'canceled'`/`'active'` não é
 *     tocada; um household já `'free'` recebe um UPDATE no-op.
 *
 *   - Observability: `withSpan('billing.trials.expire', ...)` (AC5) +
 *     `childLogger` Pino estruturado + audit log INSERT agregado (AC6 / T1.7).
 *   - Audit log (T1.7 / **PO-MUST-FIX-1**): `action = 'plan_changed'::audit_action`
 *     — valor de enum EXISTENTE (audit.ts:36, categoria Billing). NÃO existe
 *     `trials_expired`; criá-lo exigiria `ALTER TYPE` (migração nova → violaria
 *     o AC8). Padrão de cast espelha `gdpr-purge.ts:135`
 *     (`'account_deletion_executed'::audit_action`). Falha não-fatal.
 *   - Retry: errors são re-thrown para o Inngest engine retry policy
 *     (ADR-005 max 4 attempts com backoff exponencial).
 *
 * Trace: Story 6.4 AC1-AC8, `generate-finance-recurrences.ts` (template),
 *        `gdpr-purge.ts` (cast audit_action), billing.ts:35-44/85-86,
 *        tenancy.ts:31/57, 0003_auth_user_trigger.sql (origem dos trials).
 */
import { sql } from 'drizzle-orm';

import { childLogger, captureException, withSpan } from '@meu-jarvis/observability';

import { getServiceDb } from '@/lib/agent/db-shim';
import { inngest } from '@/lib/inngest/client';

const JOB_ID = 'expire-trials';

/** Row de `subscriptions` em trial expirado lida pela query do cron. */
interface ExpiredTrialRow {
  readonly id: string;
  readonly household_id: string;
  readonly trial_ends_at: string | null;
}

/** Resumo agregado devolvido pelo handler. */
export interface ExpireTrialsSummary {
  readonly expired_count: number;
  readonly skipped_count: number;
}

/**
 * Normaliza o resultado de uma query `postgres-js` para um array de rows.
 * O driver pode devolver um array directo ou um objecto — defensivo.
 */
function asRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return [];
}

export const expireTrials = inngest.createFunction(
  {
    id: JOB_ID,
    name: 'Expire trials',
  },
  { cron: '0 3 * * *' },
  async ({
    step,
    runId,
  }: {
    step: { run: <T>(id: string, cb: () => Promise<T>) => Promise<T> };
    runId: string;
  }) => {
    const log = childLogger({ job: JOB_ID });

    return await withSpan('billing.trials.expire', {}, async (span) => {
      const startedAt = Date.now();

      const summary = await step.run(
        'expire-trialing-subscriptions',
        async (): Promise<ExpireTrialsSummary> => {
          const db = getServiceDb();

          let expiredCount = 0;
          let skippedCount = 0;

          try {
            // (1) SELECT subscriptions em trial expirado (AC1). `now()` é
            // avaliado pelo Postgres — inclui o momento exacto (`<=`).
            const expired = asRows<ExpiredTrialRow>(
              await db.execute(sql`
                select id, household_id, trial_ends_at
                from subscriptions
                where status = 'trialing'
                  and trial_ends_at <= now()
                order by id
              `),
            );

            for (const subscription of expired) {
              // (2) Regressão atómica por-subscription (AC2 / PO-MUST-FIX-2).
              // Ambos os UPDATEs no mesmo commit: se households falhar,
              // subscriptions faz rollback (zero divergência de `plan`).
              const updated = await db.transaction(async (tx): Promise<boolean> => {
                // (2a) UPDATE subscriptions — `AND status = 'trialing'` é a
                // segunda linha de defesa de idempotência: no-op se outro
                // worker já processou esta row em corrida (AC3 / R-6.4.1).
                const subUpdate = asRows<{ id: string }>(
                  await tx.execute(sql`
                    update subscriptions
                    set status = 'canceled', plan = 'free', updated_at = now()
                    where id = ${subscription.id} and status = 'trialing'
                    returning id
                  `),
                );

                // Se o UPDATE não tocou nenhuma row (já processado), saltar o
                // UPDATE de households — nada a regredir nesta passagem.
                if (subUpdate.length === 0) {
                  return false;
                }

                // (2b) UPDATE households — denormalização do plan para
                // fast-path RLS/quotas (tenancy.ts:57).
                await tx.execute(sql`
                  update households
                  set plan = 'free', updated_at = now()
                  where id = ${subscription.household_id}
                `);

                return true;
              });

              if (updated) {
                expiredCount += 1;
                log.info(
                  {
                    subscription_id: subscription.id,
                    household_id: subscription.household_id,
                    trial_ends_at: subscription.trial_ends_at,
                  },
                  'Trial expirado — household regredido a Free',
                );
              } else {
                skippedCount += 1;
                log.info(
                  {
                    subscription_id: subscription.id,
                    household_id: subscription.household_id,
                  },
                  'Trial já processado (race) — UPDATE no-op',
                );
              }
            }

            log.info(
              { expired_count: expiredCount, skipped_count: skippedCount },
              'Expiração de trials completa',
            );
          } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            log.error({ err: error }, 'Expiração de trials falhou');
            captureException(error, { tags: { job: JOB_ID } });
            throw error; // Inngest retry engine pega (ADR-005 max 4 attempts).
          }

          return { expired_count: expiredCount, skipped_count: skippedCount };
        },
      );

      const durationMs = Date.now() - startedAt;

      // (3) Audit log INSERT — 1 row agregada por run (NFR9). Falha não-fatal.
      // `action = 'plan_changed'::audit_action` (PO-MUST-FIX-1): valor de enum
      // EXISTENTE (audit.ts:36, Billing). `household_id = null` — rasto
      // agregado sistémico, sobrevive a qualquer CASCADE.
      try {
        const db = getServiceDb();
        const afterState = JSON.stringify({
          expired_count: summary.expired_count,
          skipped_count: summary.skipped_count,
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
            null, null, 'plan_changed'::audit_action,
            'subscriptions', null,
            null, ${afterState}::jsonb,
            null, null, ${runId}
          )
        `);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        log.warn({ err: error }, 'Audit log INSERT falhou (não-fatal)');
        captureException(error, { tags: { job: JOB_ID, phase: 'audit_log' } });
      }

      // (4) Atributos do span — whitelist sem PII (AC5 / NFR12). Nenhum
      // household_id raw, email ou valor monetário.
      span.setAttribute('billing.trials.expired_count', summary.expired_count);
      span.setAttribute('billing.trials.skipped_count', summary.skipped_count);
      span.setAttribute('billing.cron.duration_ms', durationMs);
      span.setAttribute('inngest.run_id', runId);

      return summary;
    });
  },
);
