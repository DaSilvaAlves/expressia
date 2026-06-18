/**
 * POST /api/conta/export — Story 6.8 (Export GDPR, Art. 20).
 *
 * Inicia um pedido de export e devolve o ficheiro (geração síncrona inline —
 * PO-D1). Fluxo:
 *   1. `requireAuth()` — 401 sem sessão.
 *   2. Verifica job duplicado em curso/disponível → 409 PT-PT.
 *   3. INSERT em `data_export_jobs` (`status='pending'`) via `getDb()` (RLS
 *      `data_export_jobs_insert_member` permite).
 *   4. `getServiceDb()` → `status='generating'` (UPDATE bloqueado para
 *      `authenticated` por `using(false)` — AC8; verificação de pertença antes).
 *   5. Audit `data_export_requested`.
 *   6. Gera ZIP (JSON+CSV), faz upload para Storage, signed URL 24h.
 *   7. `getServiceDb()` → `status='ready'` (download_url, expires_at, completed_at).
 *   8. Audit `data_export_completed`. Devolve `{ jobId, downloadUrl, expiresAt }`.
 *
 * Em falha de geração/upload: `getServiceDb()` → `status='failed'` e 500 genérico.
 *
 * RLS (AC8): SELECT/INSERT via `getDb()`; todo o UPDATE via `getServiceDb()` com
 * verificação app-level de pertença. NUNCA UPDATE via `authenticated`.
 *
 * Trace: Story 6.8 AC1/AC7/AC8; `0001_rls_policies.sql:593-604`; FR28; NFR9.
 */
import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import {
  annotateSpan,
  captureException,
  childLogger,
  hashForCorrelation,
  withSpan,
} from '@meu-jarvis/observability';

import { getDb } from '@/lib/agent/db-shim';
import { requireAuth } from '@/lib/api-helpers/auth';
import type { ExportInitiateResponseDTO } from '@/lib/api-schemas/export';
import { apiError } from '@/lib/errors';
import { insertExportAuditLog } from '@/lib/gdpr/audit';
import {
  ExportJobOwnershipError,
  loadOwnedJob,
  markJobFailed,
  markJobGenerating,
  markJobReady,
} from '@/lib/gdpr/export-job';
import { generateExportForJob } from '@/lib/gdpr/generate-export';

const ROUTE = '/api/conta/export';

interface JobIdRow {
  readonly id: string;
}

/**
 * POST /api/conta/export
 *
 * Responses: 200 `ExportInitiateResponseDTO` · 401 · 404 · 409 · 500.
 */
export async function POST(): Promise<NextResponse> {
  return withSpan(
    'POST /api/conta/export',
    { method: 'POST', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'POST' });
      const auth = await requireAuth(span);
      if (auth instanceof NextResponse) return auth;

      const db = getDb();

      // 2. Job duplicado em curso/disponível (pending|generating|ready ainda válido) → 409.
      try {
        const existing = await db.execute<JobIdRow>(sql`
          select id
          from public.data_export_jobs
          where household_id = ${auth.householdId}::uuid
            and status in ('pending', 'generating', 'ready')
            and (expires_at is null or expires_at > now())
          limit 1
        `);
        if (existing[0]) {
          annotateSpan(span, { statusCode: 409 });
          return apiError(
            'EXPORT_ALREADY_IN_PROGRESS',
            'Já tens um export em curso ou disponível para download.',
            409,
          );
        }
      } catch (err) {
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'POST /api/conta/export — verificação de duplicado falhou');
        captureException(err instanceof Error ? err : new Error(String(err)), {
          userId: auth.userId,
          route: ROUTE,
        });
        return apiError('INTERNAL_ERROR', 'Erro ao iniciar a exportação. Tenta novamente.', 500);
      }

      // 3. INSERT job (status='pending') via getDb() — RLS insert_member permite.
      let jobId: string;
      try {
        const inserted = await db.execute<JobIdRow>(sql`
          insert into public.data_export_jobs (household_id, requested_by_user_id, status)
          values (${auth.householdId}::uuid, ${auth.userId}::uuid, 'pending')
          returning id
        `);
        const row = inserted[0];
        if (!row) {
          annotateSpan(span, { statusCode: 500 });
          return apiError('INTERNAL_ERROR', 'Erro ao criar o pedido de exportação.', 500);
        }
        jobId = row.id;
      } catch (err) {
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'POST /api/conta/export — INSERT do job falhou');
        captureException(err instanceof Error ? err : new Error(String(err)), {
          userId: auth.userId,
          route: ROUTE,
        });
        return apiError('INTERNAL_ERROR', 'Erro ao iniciar a exportação. Tenta novamente.', 500);
      }

      // 4. status='generating' via service-role (UPDATE bloqueado a authenticated — AC8).
      const ownedJob = await loadOwnedJob(auth.householdId, jobId);
      await markJobGenerating(ownedJob, auth.householdId);

      // 5. Audit data_export_requested (best-effort).
      try {
        await insertExportAuditLog({
          db,
          householdId: auth.householdId,
          userId: auth.userId,
          action: 'data_export_requested',
          jobId,
        });
      } catch (auditErr) {
        log.warn({ err: auditErr }, 'audit_log data_export_requested falhou (best-effort)');
      }

      // 6-7. Gera ZIP + upload + status='ready' via service-role.
      try {
        const result = await generateExportForJob(
          { userId: auth.userId, householdId: auth.householdId },
          jobId,
        );

        await markJobReady(ownedJob, auth.householdId, {
          storagePath: result.storagePath,
          downloadUrl: result.downloadUrl,
          expiresAt: result.expiresAt,
        });

        // 8. Audit data_export_completed (best-effort).
        try {
          await insertExportAuditLog({
            db,
            householdId: auth.householdId,
            userId: auth.userId,
            action: 'data_export_completed',
            jobId,
          });
        } catch (auditErr) {
          log.warn({ err: auditErr }, 'audit_log data_export_completed falhou (best-effort)');
        }

        annotateSpan(span, { statusCode: 200 });
        log.info(
          {
            user_hash: hashForCorrelation(auth.userId),
            household_id: auth.householdId,
            action: 'data_export_completed',
          },
          'POST /api/conta/export OK',
        );

        const body: ExportInitiateResponseDTO = {
          jobId,
          downloadUrl: result.downloadUrl,
          expiresAt: result.expiresAt.toISOString(),
        };
        return NextResponse.json(body);
      } catch (err) {
        // Falha de geração/upload — marca o job failed (best-effort, nunca preso em generating).
        try {
          await markJobFailed(ownedJob, auth.householdId);
        } catch (failErr) {
          if (!(failErr instanceof ExportJobOwnershipError)) {
            log.error({ err: failErr }, 'markJobFailed falhou');
          }
        }
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'POST /api/conta/export — geração/upload falhou');
        captureException(err instanceof Error ? err : new Error(String(err)), {
          userId: auth.userId,
          route: ROUTE,
        });
        return apiError(
          'EXPORT_GENERATION_FAILED',
          'Não foi possível gerar a exportação. Tenta novamente mais tarde.',
          500,
        );
      }
    },
  );
}
