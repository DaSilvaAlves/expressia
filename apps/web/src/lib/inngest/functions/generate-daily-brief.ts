/**
 * Inngest function — `generate-daily-brief`.
 *
 * Story J-4 — cron diário 07:30 Europe/Lisbon que envia o brief proactivo no
 * Telegram a cada utilizador registado em `telegram_link`. O brief resume as
 * tarefas (hoje + atrasadas) e as finanças do mês, com síntese LLM PT-PT
 * (gpt-4o-mini) e fallback determinístico.
 *
 * Inclui a agenda do Google Calendar de hoje (follow-up de J-3): quando o
 * utilizador tem o OAuth ligado, o brief abre com os eventos do dia (ordem do
 * PRD: agenda → tarefas → finanças). A agenda degrada graciosamente — nunca
 * derruba o brief.
 *
 * Implementação:
 *   - Trigger: `{ cron: 'TZ=Europe/Lisbon 30 7 * * *' }` — Inngest v3 suporta o
 *     prefixo TZ, resolvendo WET/WEST (DST) nativamente.
 *   - Identidade: `getServiceDb()` lê `telegram_link` (uso legítimo SEC-10 —
 *     identidade fora de sessão HTTP, igual ao webhook J-2). Os dados de
 *     domínio (tarefas/finanças) e o cache de idempotência correm dentro de
 *     `withHousehold({ userId, householdId })` — RLS viva (lição SEC-8.1).
 *   - Idempotência (AC7): `daily_briefing_cache` unique `(household_id,
 *     briefing_date)`. `briefing_date` em Europe/Lisbon. Inngest é
 *     at-least-once → reruns no mesmo dia não re-enviam.
 *   - Envio falha não-fatal por household (AC8): log + continue; NÃO grava o
 *     cache nesse caso (permite re-tentativa).
 *   - Observability (AC9): `withSpan` + `childLogger` + `hashForCorrelation`;
 *     nunca o texto do brief, títulos ou valores em claro.
 *
 * Trace: Story J-4 AC3-AC9, epic-jarvis-fase1 §J-4, Story 3.7
 *        `generate-recurring-tasks.ts` (template).
 */
import { sql } from 'drizzle-orm';

import { childLogger, captureException, hashForCorrelation, withSpan } from '@meu-jarvis/observability';

import { getServiceDb, withHousehold } from '@/lib/agent/db-shim';
import { buildBriefForHousehold } from '@/lib/brief/build-brief';
import { inngest } from '@/lib/inngest/client';
import { sendMessage } from '@/lib/telegram/client';

const JOB_ID = 'generate-daily-brief';

/** Row de `telegram_link` lida para resolver os destinatários. */
interface TelegramLinkRow {
  readonly chat_id: string;
  readonly user_id: string;
  readonly household_id: string;
}

/** Resumo agregado devolvido pelo handler (seguro para log). */
export interface GenerateDailyBriefSummary {
  readonly recipients: number;
  readonly sent: number;
  readonly skipped: number;
  readonly failures: number;
  readonly fallbackUsed: number;
}

/** Normaliza o resultado de `postgres-js` para um array de rows. */
function asRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return [];
}

/** 'YYYY-MM-DD' em Europe/Lisbon (alinha com o cron TZ=Europe/Lisbon). */
function lisbonDateString(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Lisbon',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export const generateDailyBrief = inngest.createFunction(
  {
    id: JOB_ID,
    name: 'Generate daily brief',
  },
  { cron: 'TZ=Europe/Lisbon 30 7 * * *' },
  async ({ step, runId }: { step: { run: <T>(id: string, cb: () => Promise<T>) => Promise<T> }; runId: string }) => {
    const log = childLogger({ job: JOB_ID });

    return await withSpan('jarvis.brief.generate', {}, async (span) => {
      const briefingDate = lisbonDateString(new Date());

      const summary = await step.run('process-briefs', async (): Promise<GenerateDailyBriefSummary> => {
        // (1) Destinatários — identidade via service_role (sem JWT). Uso legítimo
        // SEC-10: lê só a tabela de mapeamento de identidade, não dados de domínio.
        const serviceDb = getServiceDb();
        const recipients = asRows<TelegramLinkRow>(
          await serviceDb.execute(sql`
            select chat_id::text as chat_id, user_id, household_id
            from public.telegram_link
          `),
        );

        let sent = 0;
        let skipped = 0;
        let failures = 0;
        let fallbackUsed = 0;

        for (const r of recipients) {
          const householdHash = hashForCorrelation(r.household_id);
          const chatId = Number(r.chat_id);

          try {
            // (2) Tudo o que toca dados de domínio corre sob RLS (withHousehold).
            const outcome = await withHousehold(
              { userId: r.user_id, householdId: r.household_id },
              async (db) => {
                // (2a) Idempotência — já há brief para hoje?
                const existing = await db.execute(sql`
                  select 1
                  from public.daily_briefing_cache
                  where household_id = ${r.household_id}::uuid
                    and briefing_date = ${briefingDate}::date
                  limit 1
                `);
                if (existing.length > 0) {
                  return { status: 'skipped' as const };
                }

                // (2b) Agregar + sintetizar. `r.user_id` resolve a agenda do
                // Google Calendar (token por household+user) sob RLS.
                const brief = await buildBriefForHousehold(db, r.household_id, r.user_id, runId);

                // (2c) Enviar ao Telegram. Falha aqui é não-fatal: lançamos para
                // o catch externo NÃO gravar o cache (permite re-tentativa).
                await sendMessage({ chatId, text: brief.text });

                // (2d) Gravar idempotência só após envio com sucesso.
                await db.execute(sql`
                  insert into public.daily_briefing_cache
                    (household_id, briefing_date, message_text, generated_at)
                  values
                    (${r.household_id}::uuid, ${briefingDate}::date, ${brief.text}, now())
                  on conflict (household_id, briefing_date) do nothing
                `);

                return {
                  status: 'sent' as const,
                  usedFallback: brief.usedFallback,
                  tasksTodayCount: brief.tasksTodayCount,
                  tasksOverdueCount: brief.tasksOverdueCount,
                  calendarEventCount: brief.calendarEventCount,
                };
              },
            );

            if (outcome.status === 'skipped') {
              skipped += 1;
              log.info({ household: householdHash, briefing_date: briefingDate }, 'Brief já enviado hoje — skip');
            } else {
              sent += 1;
              if (outcome.usedFallback) fallbackUsed += 1;
              log.info(
                {
                  household: householdHash,
                  briefing_date: briefingDate,
                  tasks_today: outcome.tasksTodayCount,
                  tasks_overdue: outcome.tasksOverdueCount,
                  // Só a contagem agregada de eventos — NUNCA títulos nem
                  // localização (constraint J-3 AC9 / privacidade).
                  calendar_events: outcome.calendarEventCount,
                  fallback: outcome.usedFallback,
                },
                'Brief enviado',
              );
            }
          } catch (err) {
            // Falha por household (agregação, síntese fatal, ou envio Telegram) —
            // não bloqueia os restantes. Cache NÃO gravado → re-tentável.
            failures += 1;
            captureException(err, { tags: { job: JOB_ID } });
            log.error({ household: householdHash, briefing_date: briefingDate }, 'Brief falhou para este household');
          }
        }

        return { recipients: recipients.length, sent, skipped, failures, fallbackUsed };
      });

      span.setAttribute('jarvis.brief.recipients', summary.recipients);
      span.setAttribute('jarvis.brief.sent', summary.sent);
      span.setAttribute('jarvis.brief.skipped', summary.skipped);
      span.setAttribute('jarvis.brief.failures', summary.failures);
      span.setAttribute('inngest.run_id', runId);

      log.info({ ...summary, briefing_date: briefingDate }, 'generate-daily-brief concluído');

      return summary;
    });
  },
);
