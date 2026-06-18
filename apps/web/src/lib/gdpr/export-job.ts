/**
 * Helpers de transição de estado do job de export GDPR (Story 6.8 AC8).
 *
 * RESTRIÇÃO CRÍTICA DE DESIGN: a policy `data_export_jobs_update_blocked`
 * (`0001_rls_policies.sql:599-601`) bloqueia QUALQUER UPDATE via role
 * `authenticated` (`using(false) with check(false)`). Por isso TODO o UPDATE de
 * status (`pending`→`generating`→`ready`/`failed`/`expired`) usa OBRIGATORIAMENTE
 * `getServiceDb()` (service-role, ignora RLS).
 *
 * Como o service-role ignora a RLS, cada write é precedido de uma verificação
 * app-level de pertença (`job.household_id === auth.householdId`) — defesa em
 * profundidade, precedente D-12C (commits f40b0a1/57beaff). O SELECT de
 * verificação corre via `getDb()` (RLS-enforced + filtro household app).
 *
 * Trace: Story 6.8 AC8; `0001_rls_policies.sql:593-604`; D-12C; CLAUDE.md §Multi-tenancy.
 */
import { sql } from 'drizzle-orm';

import { getDb, getServiceDb } from '@/lib/agent/db-shim';

import type { ExportJobStatus } from '@/lib/api-schemas/export';

/** Linha mínima do job lida do SELECT de verificação. */
export interface ExportJobRow {
  readonly id: string;
  readonly household_id: string;
  readonly status: ExportJobStatus;
  readonly storage_path: string | null;
  readonly download_url: string | null;
  readonly expires_at: string | Date | null;
  readonly created_at: string | Date;
  readonly error_message: string | null;
}

/**
 * Erro lançado quando a verificação app-level de pertença falha antes de um
 * write service-role. Tratado como 404 pelo route handler (não revela existência).
 */
export class ExportJobOwnershipError extends Error {
  constructor() {
    super('Job de export não pertence ao household.');
    this.name = 'ExportJobOwnershipError';
  }
}

/**
 * Lê um job pelo id via `getDb()` (RLS-enforced) e confirma a pertença ao
 * household autenticado. Devolve a row ou `null` se não existir/não pertencer.
 */
export async function loadOwnedJob(
  householdId: string,
  jobId: string,
): Promise<ExportJobRow | null> {
  const db = getDb();
  const rows = await db.execute<ExportJobRow>(sql`
    select id, household_id, status, storage_path, download_url,
           expires_at, created_at, error_message
    from public.data_export_jobs
    where id = ${jobId}::uuid
      and household_id = ${householdId}::uuid
    limit 1
  `);
  const job = rows[0];
  return job ?? null;
}

/**
 * Verificação app-level de pertença antes de um write service-role (AC8).
 * @throws ExportJobOwnershipError se o job não pertencer ao household.
 */
function assertOwnership(job: ExportJobRow | null, householdId: string): asserts job is ExportJobRow {
  if (!job || job.household_id !== householdId) {
    throw new ExportJobOwnershipError();
  }
}

/**
 * Actualiza `status='generating'` via service-role (UPDATE bloqueado para
 * `authenticated` — AC8). Verifica pertença antes da escrita.
 */
export async function markJobGenerating(
  job: ExportJobRow | null,
  householdId: string,
): Promise<void> {
  assertOwnership(job, householdId);
  const serviceDb = getServiceDb();
  await serviceDb.execute(sql`
    update public.data_export_jobs
    set status = 'generating'
    where id = ${job.id}::uuid
      and household_id = ${householdId}::uuid
  `);
}

/**
 * Actualiza o job para `status='ready'` com `storage_path`, `download_url`,
 * `expires_at` e `completed_at` via service-role (AC8).
 */
export async function markJobReady(
  job: ExportJobRow | null,
  householdId: string,
  args: { storagePath: string; downloadUrl: string; expiresAt: Date },
): Promise<void> {
  assertOwnership(job, householdId);
  const serviceDb = getServiceDb();
  await serviceDb.execute(sql`
    update public.data_export_jobs
    set status = 'ready',
        storage_path = ${args.storagePath},
        download_url = ${args.downloadUrl},
        expires_at = ${args.expiresAt.toISOString()}::timestamptz,
        completed_at = now()
    where id = ${job.id}::uuid
      and household_id = ${householdId}::uuid
  `);
}

/**
 * Actualiza o job para `status='failed'` com mensagem genérica via service-role.
 */
export async function markJobFailed(
  job: ExportJobRow | null,
  householdId: string,
): Promise<void> {
  assertOwnership(job, householdId);
  const serviceDb = getServiceDb();
  await serviceDb.execute(sql`
    update public.data_export_jobs
    set status = 'failed',
        error_message = 'Não foi possível gerar a exportação. Tenta novamente mais tarde.'
    where id = ${job.id}::uuid
      and household_id = ${householdId}::uuid
  `);
}

/**
 * Actualiza o job para `status='expired'` via service-role (AC2/AC8).
 */
export async function markJobExpired(
  job: ExportJobRow | null,
  householdId: string,
): Promise<void> {
  assertOwnership(job, householdId);
  const serviceDb = getServiceDb();
  await serviceDb.execute(sql`
    update public.data_export_jobs
    set status = 'expired'
    where id = ${job.id}::uuid
      and household_id = ${householdId}::uuid
  `);
}
