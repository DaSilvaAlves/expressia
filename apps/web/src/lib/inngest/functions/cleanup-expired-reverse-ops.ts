/**
 * Inngest function — `cleanup_expired_reverse_ops`.
 *
 * Story 2.8 AC2 — cron diário 03:00 UTC que apaga rows antigas em
 * `agent_reverse_ops` cuja `expires_at` é anterior a `now() - 1h` (margem de
 * segurança vs janela undo de 30s). Mantém a tabela enxuta sem risco de
 * apagar uma op ainda dentro da janela undo.
 *
 * Implementação:
 *   - Trigger: cron Inngest nativo `0 3 * * *` (alinha com `apps/web/vercel.json`
 *     cron `/api/cron/daily` mencionado em CLAUDE.md). D38 KISS: cron Inngest
 *     directo em vez de fan-out via Vercel Cron — refactor trivial quando ≥2
 *     jobs Inngest entrarem (Story 2.9 quota reset, GDPR purge mensal).
 *   - Handler: `step.run('delete-expired', ...)` executa o DELETE via
 *     `getServiceDb()` (RLS bypass justificado para job sistémico — pattern
 *     análogo a GDPR purge mensal e Story 2.5 audit log inserts).
 *   - Idempotência: o WHERE condicional torna o DELETE naturalmente idempotente
 *     (rerun no mesmo dia → 0 rows deleted).
 *   - Observability: Pino structured log com `rows_deleted` count. Inngest
 *     auto-cria spans OTel por step.
 *   - Retry: errors são re-thrown para o Inngest engine retry policy
 *     (ADR-005 max 4 attempts com backoff exponencial).
 *
 * Trace: Architecture §4.5 linha 425 ("Job Inngest: limpa `agent_reverse_ops`
 * com `expires_at < now() - 1h` diariamente"), Story 2.8 AC2 + D38 + D43.
 */
import { sql } from 'drizzle-orm';

import { childLogger, captureException } from '@meu-jarvis/observability';

import { getServiceDb } from '@/lib/agent/db-shim';
import { inngest } from '@/lib/inngest/client';

const JOB_ID = 'cleanup-expired-reverse-ops';

/**
 * Shape da row retornada por `postgres-js` numa query DELETE — varia conforme
 * versão. Para tolerância usamos `unknown` + narrow opcional do count.
 */
interface DeleteResult {
  readonly count?: number;
}

export const cleanupExpiredReverseOps = inngest.createFunction(
  {
    id: JOB_ID,
    name: 'Cleanup expired reverse ops',
  },
  { cron: '0 3 * * *' },
  async ({ step }) => {
    const log = childLogger({ job: JOB_ID });

    const rowsDeleted = await step.run('delete-expired', async (): Promise<number> => {
      try {
        const db = getServiceDb();
        const result = (await db.execute(sql`
          delete from agent_reverse_ops
          where expires_at < now() - interval '1 hour'
        `)) as unknown as DeleteResult[] | DeleteResult;

        // postgres-js retorna `{ count }` no driver — defensivo para array.
        const count =
          Array.isArray(result)
            ? (result.length > 0 && typeof result[0]?.count === 'number' ? result[0].count : result.length)
            : typeof result?.count === 'number'
              ? result.count
              : 0;

        log.info({ rows_deleted: count }, 'Cleanup expired reverse ops completo');
        return count;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        log.error({ err: error }, 'Cleanup expired reverse ops falhou');
        captureException(error, { tags: { job: JOB_ID } });
        throw error; // Inngest retry engine pega (ADR-005 max 4 attempts)
      }
    });

    return { rows_deleted: rowsDeleted };
  },
);
