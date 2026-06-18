/**
 * GET /api/conta/export/[jobId] — Story 6.8 (Export GDPR, Art. 20).
 *
 * Verifica o estado de um job de export e devolve o link de download.
 *   - `requireAuth()` — 401 sem sessão.
 *   - SELECT via `getDb()` (RLS-enforced) + verificação app-level de pertença
 *     (`job.household_id === auth.householdId`) → 404 se não pertencer.
 *   - Se `status='ready'` e `expires_at < now()`: `getServiceDb()` actualiza
 *     `status='expired'` (UPDATE bloqueado a `authenticated` — AC8) e devolve
 *     `downloadUrl: null`.
 *   - Se `status='failed'`: inclui mensagem genérica PT-PT.
 *
 * Trace: Story 6.8 AC2/AC8; `dataExportStatusEnum`; `0001_rls_policies.sql:593-604`.
 */
import { NextResponse } from 'next/server';

import {
  annotateSpan,
  captureException,
  childLogger,
  withSpan,
} from '@meu-jarvis/observability';

import { requireAuth } from '@/lib/api-helpers/auth';
import type { ExportJobResponseDTO, ExportJobStatus } from '@/lib/api-schemas/export';
import { apiError } from '@/lib/errors';
import { loadOwnedJob, markJobExpired, type ExportJobRow } from '@/lib/gdpr/export-job';

const ROUTE = '/api/conta/export/[jobId]';

function toIso(value: string | Date | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

/** Verifica se um job `ready` já expirou (expires_at no passado). */
function isExpired(job: ExportJobRow): boolean {
  if (!job.expires_at) return false;
  const expires = job.expires_at instanceof Date ? job.expires_at : new Date(job.expires_at);
  return expires.getTime() < Date.now();
}

/**
 * GET /api/conta/export/[jobId]
 *
 * Responses: 200 `ExportJobResponseDTO` · 401 · 404 · 500.
 */
export async function GET(
  _req: Request,
  context: { params: Promise<{ jobId: string }> },
): Promise<NextResponse> {
  return withSpan(
    'GET /api/conta/export/[jobId]',
    { method: 'GET', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'GET' });
      const auth = await requireAuth(span);
      if (auth instanceof NextResponse) return auth;

      const { jobId } = await context.params;

      try {
        const job = await loadOwnedJob(auth.householdId, jobId);
        if (!job) {
          annotateSpan(span, { statusCode: 404 });
          return apiError('EXPORT_JOB_NOT_FOUND', 'Exportação não encontrada.', 404);
        }

        let status: ExportJobStatus = job.status;
        let downloadUrl = job.download_url;
        const expiresAt = toIso(job.expires_at);

        // Expiração lazy: `ready` mas já passou `expires_at` → `expired` (service-role).
        if (status === 'ready' && isExpired(job)) {
          await markJobExpired(job, auth.householdId);
          status = 'expired';
          downloadUrl = null;
        }

        // `expired`/`failed` nunca devolvem URL.
        if (status !== 'ready') {
          downloadUrl = null;
        }

        const body: ExportJobResponseDTO = {
          jobId: job.id,
          status,
          downloadUrl,
          expiresAt: status === 'ready' ? expiresAt : null,
          createdAt: toIso(job.created_at) ?? new Date().toISOString(),
          ...(status === 'failed'
            ? {
                errorMessage:
                  'Não foi possível gerar a exportação. Tenta novamente mais tarde.',
              }
            : {}),
        };

        annotateSpan(span, { statusCode: 200 });
        return NextResponse.json(body);
      } catch (err) {
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'GET /api/conta/export/[jobId] falhou');
        captureException(err instanceof Error ? err : new Error(String(err)), {
          userId: auth.userId,
          route: ROUTE,
        });
        return apiError('INTERNAL_ERROR', 'Erro ao consultar a exportação. Tenta novamente.', 500);
      }
    },
  );
}
