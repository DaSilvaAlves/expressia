/**
 * Inngest function — `gdpr-purge` (Story 6.9 AC4/AC5, GDPR Art. 17).
 *
 * Cron diário 03:00 UTC que executa o purge das contas cuja eliminação foi
 * agendada há ≥30 dias e não revogada (`status='scheduled' AND scheduled_for <=
 * now()`). App single-user (pivot 19/06/2026): cada job → apagar o household
 * (CASCADE total da árvore de dados) → apagar `auth.users` → limpar resíduos no
 * Storage.
 *
 * Implementação:
 *   - Trigger: cron Inngest nativo `0 3 * * *` ([DEV-DECISION D-6.9.3] —
 *     alinhado com `cleanup-expired-reverse-ops`, `generate-recurring-tasks`,
 *     `generate-finance-recurrences`; sem dependência de `vercel.json`).
 *   - Selecção: 1 step lê todos os jobs elegíveis; cada job é processado num
 *     `step.run('purge-job-{id}')` independente ([DEV-DECISION D-6.9.4] —
 *     granularidade de retry por job; volume baixo no single-user).
 *   - TODO o processamento usa `getServiceDb()` / Supabase Admin (job controlado
 *     sem JWT — categoria 1 do guard de `getServiceDb()`). Verificação app-level
 *     de pertença antes de qualquer write destrutivo (precedente D-12C).
 *   - Idempotência (AC4): jobs `completed`/`failed`/`canceled` são saltados; a
 *     selecção só apanha `scheduled`.
 *
 * Ordem crítica dos steps (AC4):
 *   1. `status='in_progress'` (marca + valida que o job ainda existe).
 *   2. `DELETE FROM households` — CASCADE apaga toda a árvore (incluindo o
 *      próprio job `account_deletion_jobs`, FK household_id CASCADE).
 *   3. `auth.admin.deleteUser` — DEPOIS do DELETE do household (RESTRICT em
 *      `households.owner_user_id`).
 *   4. Storage Admin — remover `exports/{householdId}/*` (best-effort).
 *   5. `status='completed'` — PO-FIX-3: NO-OP GARANTIDO (o job já foi apagado
 *      pelo CASCADE do Step 2). O estado terminal real é o audit_log do Step 6.
 *   6. `audit_log (action='account_deletion_executed', household_id=NULL)` — o
 *      `household_id=NULL` é OBRIGATÓRIO para o rasto sobreviver ao CASCADE.
 *
 * Erro em qualquer step → `status='failed'` (se o job ainda existir) + audit_log
 * de falha.
 *
 * Trace: Story 6.9 AC4/AC5/AC7; `docs/runbooks/rgpd-account-deletion.md`
 *        §3/§4/§5/§6.1; `tenancy.ts:55` (owner_user_id RESTRICT);
 *        `0000_initial_schema.sql:690-691`; padrão `generate-finance-recurrences.ts`.
 */
import { sql } from 'drizzle-orm';

import { childLogger, captureException, withSpan } from '@meu-jarvis/observability';

import { getServiceDb, type DbShim } from '@/lib/agent/db-shim';
import { getSupabaseAdminClient } from '@/lib/gdpr/supabase-admin';
import { inngest } from '@/lib/inngest/client';

const JOB_ID = 'gdpr-purge';

/** Bucket privado onde residem os exports (Story 6.8). */
const EXPORTS_BUCKET = 'exports';

/** Row de `account_deletion_jobs` elegível para purge. */
interface EligibleJobRow {
  readonly id: string;
  readonly household_id: string;
  readonly requested_by_user_id: string;
  readonly created_at: string;
  readonly scheduled_for: string;
}

/** Resultado do processamento de um único job. */
export interface PurgeJobResult {
  readonly jobId: string;
  readonly householdId: string;
  readonly outcome: 'completed' | 'failed';
  readonly errorMessage?: string;
}

/** Resumo agregado do run. */
export interface GdprPurgeSummary {
  readonly eligible: number;
  readonly completed: number;
  readonly failed: number;
}

/** Normaliza o resultado de `postgres-js` para um array de rows. */
function asRows<T>(result: unknown): T[] {
  return Array.isArray(result) ? (result as T[]) : [];
}

/**
 * Remove os ficheiros residuais do household no bucket `exports`
 * (`exports/{householdId}/*`). Best-effort: bucket inexistente, pasta vazia ou
 * erro de listagem NÃO falham o purge (os dados de domínio já foram apagados).
 */
async function removeExportResidues(householdId: string): Promise<number> {
  const admin = getSupabaseAdminClient();
  const { data: files, error: listError } = await admin.storage
    .from(EXPORTS_BUCKET)
    .list(householdId);

  if (listError || !files || files.length === 0) return 0;

  const paths = files.map((f) => `${householdId}/${f.name}`);
  await admin.storage.from(EXPORTS_BUCKET).remove(paths);
  return paths.length;
}

/**
 * Marca o job `failed` com a mensagem de erro PT-PT. Best-effort: se o job já foi
 * apagado pelo CASCADE (Step 2 concluiu antes da falha), o UPDATE é no-op.
 */
async function markJobFailed(
  db: DbShim,
  jobId: string,
  errorMessage: string,
): Promise<void> {
  await db.execute(sql`
    update public.account_deletion_jobs
    set status = 'failed', error_message = ${errorMessage}
    where id = ${jobId}::uuid
      and status not in ('completed', 'failed')
  `);
}

/**
 * Insere o audit_log terminal (`account_deletion_executed` ou contexto de falha)
 * com `household_id = NULL` — OBRIGATÓRIO para o rasto sobreviver ao CASCADE
 * (AC4 Step 6 / AC7). `user_id = NULL` (o utilizador foi apagado no Step 3).
 */
async function insertExecutedAuditLog(
  db: DbShim,
  payload: Record<string, unknown>,
): Promise<void> {
  // O único valor de enum para a execução do purge é `account_deletion_executed`
  // (tanto em sucesso como em falha; o `before_state.error` distingue o caso).
  const stateJson = JSON.stringify(payload);
  await db.execute(sql`
    insert into public.audit_log (
      household_id, user_id, action, entity_table, entity_id, before_state
    ) values (
      null, null, 'account_deletion_executed'::audit_action, 'account_deletion_jobs', null,
      ${stateJson}::jsonb
    )
  `);
}

/**
 * Processa UM job de eliminação (steps 1-6). Exportado para teste isolado.
 *
 * Toda a interacção destrutiva usa `getServiceDb()` / Supabase Admin. A
 * verificação de pertença (`job.household_id`) é feita pela própria query de
 * selecção (`status='scheduled'`) — o job carrega o household a apagar.
 *
 * @returns `{ outcome: 'completed' }` em sucesso, `{ outcome: 'failed' }` em erro
 *   (o erro é capturado e NÃO re-lançado — um job falhado não bloqueia os outros).
 */
export async function purgeAccountDeletionJob(job: EligibleJobRow): Promise<PurgeJobResult> {
  const log = childLogger({ job: JOB_ID, deletion_job_id: job.id });
  const db = getServiceDb();
  const requestedAt = job.created_at;
  const executedAt = new Date().toISOString();

  try {
    // Step 1 — marca in_progress + valida que o job ainda está scheduled.
    const marked = asRows<{ id: string }>(
      await db.execute<{ id: string }>(sql`
        update public.account_deletion_jobs
        set status = 'in_progress'
        where id = ${job.id}::uuid
          and status = 'scheduled'
        returning id
      `),
    );
    if (!marked[0]) {
      // Já não está scheduled (cancelado/processado entre a selecção e agora).
      log.info('Job já não está scheduled — saltado (idempotência)');
      return { jobId: job.id, householdId: job.household_id, outcome: 'completed' };
    }

    // Step 2 — DELETE household (CASCADE total; apaga também este próprio job).
    await db.execute(sql`
      delete from public.households where id = ${job.household_id}::uuid
    `);

    // Step 3 — apaga auth.users (DEPOIS do household, RESTRICT em owner_user_id).
    const admin = getSupabaseAdminClient();
    const { error: deleteUserError } = await admin.auth.admin.deleteUser(
      job.requested_by_user_id,
    );
    if (deleteUserError) {
      throw new Error(`Falha ao eliminar o utilizador: ${deleteUserError.message}`);
    }

    // Step 4 — Storage residues (best-effort, não falha o purge).
    let removedFiles = 0;
    try {
      removedFiles = await removeExportResidues(job.household_id);
    } catch (storageErr) {
      log.warn(
        { err: storageErr instanceof Error ? storageErr.message : String(storageErr) },
        'Limpeza de resíduos no Storage falhou (best-effort, ignorado)',
      );
    }

    // Step 5 — UPDATE status='completed': PO-FIX-3 NO-OP GARANTIDO (o job foi
    // apagado pelo CASCADE do Step 2). Tentativa best-effort; 0 rows é esperado.
    try {
      await db.execute(sql`
        update public.account_deletion_jobs
        set status = 'completed', completed_at = now()
        where id = ${job.id}::uuid
      `);
    } catch (updateErr) {
      log.info(
        { err: updateErr instanceof Error ? updateErr.message : String(updateErr) },
        'Step 5 (status=completed) no-op — job já apagado pelo CASCADE (esperado)',
      );
    }

    // Step 6 — audit_log terminal com household_id=NULL (sobrevive ao CASCADE).
    await insertExecutedAuditLog(db, {
      deletedHouseholdId: job.household_id,
      deletedUserId: job.requested_by_user_id,
      requestedAt,
      executedAt,
      removedStorageFiles: removedFiles,
    });

    log.info(
      { household_id: job.household_id, removed_storage_files: removedFiles },
      'Purge de conta concluído',
    );
    return { jobId: job.id, householdId: job.household_id, outcome: 'completed' };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    const message = `Purge falhou: ${error.message}`.slice(0, 500);
    log.error({ err: error }, 'Purge de conta falhou');
    captureException(error, { tags: { job: JOB_ID, deletion_job_id: job.id } });

    // markJobFailed best-effort (no-op se o household — e o job — já foram apagados).
    try {
      await markJobFailed(db, job.id, message);
    } catch (failErr) {
      log.warn(
        { err: failErr instanceof Error ? failErr.message : String(failErr) },
        'markJobFailed falhou (job possivelmente já apagado)',
      );
    }

    // audit_log de falha (household_id=NULL — pode já estar apagado).
    try {
      await insertExecutedAuditLog(db, {
        deletedHouseholdId: job.household_id,
        requestedAt,
        failedAt: new Date().toISOString(),
        error: message,
      });
    } catch (auditErr) {
      log.warn(
        { err: auditErr instanceof Error ? auditErr.message : String(auditErr) },
        'audit_log de falha falhou (best-effort)',
      );
    }

    return {
      jobId: job.id,
      householdId: job.household_id,
      outcome: 'failed',
      errorMessage: message,
    };
  }
}

/**
 * Selecciona os jobs elegíveis (`scheduled` e `scheduled_for <= now()`).
 * Exportado para teste isolado.
 */
export async function selectEligibleJobs(db: DbShim): Promise<EligibleJobRow[]> {
  return asRows<EligibleJobRow>(
    await db.execute<EligibleJobRow>(sql`
      select id, household_id, requested_by_user_id, created_at, scheduled_for
      from public.account_deletion_jobs
      where status = 'scheduled'
        and scheduled_for <= now()
      order by scheduled_for asc
    `),
  );
}

export const gdprPurge = inngest.createFunction(
  {
    id: JOB_ID,
    name: 'GDPR account purge',
  },
  { cron: '0 3 * * *' },
  async ({ step }: { step: { run: <T>(id: string, cb: () => Promise<T>) => Promise<T> } }) => {
    const log = childLogger({ job: JOB_ID });

    return await withSpan('gdpr.account.purge', {}, async (span): Promise<GdprPurgeSummary> => {
      const eligible = await step.run('select-eligible-jobs', async () => {
        const db = getServiceDb();
        return selectEligibleJobs(db);
      });

      log.info({ eligible: eligible.length }, 'Jobs de eliminação elegíveis para purge');

      let completed = 0;
      let failed = 0;

      for (const job of eligible) {
        const result = await step.run(`purge-job-${job.id}`, () => purgeAccountDeletionJob(job));
        if (result.outcome === 'completed') completed += 1;
        else failed += 1;
      }

      span.setAttribute('gdpr.purge.eligible_count', eligible.length);
      span.setAttribute('gdpr.purge.completed_count', completed);
      span.setAttribute('gdpr.purge.failed_count', failed);

      const summary: GdprPurgeSummary = { eligible: eligible.length, completed, failed };
      log.info(summary, 'Run de purge GDPR completo');
      return summary;
    });
  },
);
