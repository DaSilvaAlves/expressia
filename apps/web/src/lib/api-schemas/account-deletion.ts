/**
 * Schemas / DTOs para `/api/conta/delete` — Story 6.9 (Eliminação de conta, Art. 17).
 *
 * Espelho local do `accountDeletionStatusEnum` de `@meu-jarvis/db` como tuplo
 * (REQ-INLINE-1: nenhum import de `@meu-jarvis/db` no client bundle — os enums
 * são duplicados como tuplos `as const` para evitar resolução cross-package).
 * Precedente: `apps/web/src/lib/api-schemas/export.ts` (Story 6.8).
 *
 * Trace: Story 6.9 AC1/AC2/AC3; `packages/db/src/schema/audit.ts:122-128`
 *        (accountDeletionStatusEnum).
 */

/**
 * Estados do job de eliminação — espelho de `account_deletion_status`
 * (audit.ts:122-128). Mantido como tuplo local (REQ-INLINE-1).
 */
export const ACCOUNT_DELETION_STATUSES = [
  'scheduled',
  'canceled',
  'in_progress',
  'completed',
  'failed',
] as const;

export type AccountDeletionStatus = (typeof ACCOUNT_DELETION_STATUSES)[number];

/**
 * DTO do job de eliminação devolvido por `GET /api/conta/delete` quando existe
 * uma eliminação agendada (ou em curso).
 */
export interface AccountDeletionJobDTO {
  readonly jobId: string;
  readonly status: AccountDeletionStatus;
  /** ISO 8601 — a UI converte para DD/MM/YYYY. */
  readonly scheduledFor: string;
  /** ISO 8601. */
  readonly createdAt: string;
}

/**
 * Resposta de `GET /api/conta/delete`. `job: null` se não houver eliminação
 * agendada nem em curso.
 */
export interface DeletionStatusResponseDTO {
  readonly job: AccountDeletionJobDTO | null;
}

/**
 * Resposta de `POST /api/conta/delete` — eliminação agendada.
 */
export interface ScheduleDeletionResponseDTO {
  readonly jobId: string;
  /** ISO 8601 — `now() + 30 dias`. */
  readonly scheduledFor: string;
}

/**
 * Resposta de `DELETE /api/conta/delete` — eliminação revogada.
 */
export interface CancelDeletionResponseDTO {
  readonly jobId: string;
  /** ISO 8601 — instante do cancelamento. */
  readonly canceledAt: string;
}
