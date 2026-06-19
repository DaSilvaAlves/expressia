/**
 * Schemas / DTOs para `/api/conta/export` — Story 6.8 (Export GDPR, Art. 20).
 *
 * Espelho local do `dataExportStatusEnum` de `@meu-jarvis/db` como tuplo
 * (REQ-INLINE-1: nenhum import de `@meu-jarvis/db` no client bundle — os enums
 * são duplicados como tuplos `as const` para evitar resolução cross-package).
 *
 * Trace: Story 6.8 AC1/AC2; `packages/db/src/schema/audit.ts` (dataExportStatusEnum).
 */

/**
 * Estados do job de export — espelho de `data_export_status` (audit.ts:114-120).
 * Mantido como tuplo local (REQ-INLINE-1).
 */
export const EXPORT_JOB_STATUSES = [
  'pending',
  'generating',
  'ready',
  'expired',
  'failed',
] as const;

export type ExportJobStatus = (typeof EXPORT_JOB_STATUSES)[number];

/**
 * Resposta de `GET /api/conta/export/{jobId}` — estado do job.
 *
 * `downloadUrl`/`expiresAt` só presentes quando `status='ready'` e ainda válido.
 * `errorMessage` (genérico, PT-PT) só presente quando `status='failed'`.
 */
export interface ExportJobResponseDTO {
  readonly jobId: string;
  readonly status: ExportJobStatus;
  readonly downloadUrl: string | null;
  readonly expiresAt: string | null;
  readonly createdAt: string;
  readonly errorMessage?: string | null;
}

/**
 * Resposta síncrona de `POST /api/conta/export` (geração inline — PO-D1).
 * Devolve o link de download imediatamente após a geração do ZIP.
 */
export interface ExportInitiateResponseDTO {
  readonly jobId: string;
  readonly downloadUrl: string;
  readonly expiresAt: string;
}
