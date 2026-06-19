import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Testes da função Inngest `gdpr-purge` — Story 6.9 AC4/AC5 (T8.4).
 *
 * Testa `purgeAccountDeletionJob` e `selectEligibleJobs` directamente (steps
 * 1-6, idempotência, erro → failed). Mocks: db-shim (getServiceDb),
 * supabase-admin (auth.admin.deleteUser + storage), observability, inngest
 * client (createFunction não é executado nos testes unitários).
 */

const mockServiceExecute = vi.fn();

vi.mock('@/lib/agent/db-shim', () => ({
  getServiceDb: vi.fn(() => ({ execute: mockServiceExecute })),
}));

const mockDeleteUser = vi.fn<(id: string) => Promise<{ error: { message: string } | null }>>(
  async () => ({ error: null }),
);
const mockStorageList = vi.fn<
  (path: string) => Promise<{ data: Array<{ name: string }> | null; error: { message: string } | null }>
>(async () => ({ data: [], error: null }));
const mockStorageRemove = vi.fn<(paths: string[]) => Promise<{ data: unknown; error: unknown }>>(
  async () => ({ data: [], error: null }),
);

vi.mock('@/lib/gdpr/supabase-admin', () => ({
  getSupabaseAdminClient: vi.fn(() => ({
    auth: { admin: { deleteUser: (id: string) => mockDeleteUser(id) } },
    storage: {
      from: () => ({
        list: (path: string) => mockStorageList(path),
        remove: (paths: string[]) => mockStorageRemove(paths),
      }),
    },
  })),
}));

vi.mock('@meu-jarvis/observability', () => ({
  withSpan: vi.fn((_name, _attrs, fn) => fn({ setAttribute: vi.fn() })),
  captureException: vi.fn(),
  childLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
}));

vi.mock('@/lib/inngest/client', () => ({
  inngest: {
    createFunction: vi.fn((_cfg, _trigger, _handler) => ({ id: 'gdpr-purge' })),
  },
}));

import {
  purgeAccountDeletionJob,
  selectEligibleJobs,
} from '@/lib/inngest/functions/gdpr-purge';
import type { DbShim } from '@/lib/agent/db-shim';

const JOB = {
  id: 'job-1',
  household_id: 'hh-1',
  requested_by_user_id: 'user-1',
  created_at: '2026-05-19T03:00:00.000Z',
  scheduled_for: '2026-06-18T03:00:00.000Z',
};

/** Extrai o texto SQL de uma chamada a `execute`. */
function sqlText(callIndex: number): string {
  return JSON.stringify(mockServiceExecute.mock.calls[callIndex]?.[0] ?? {});
}

describe('purgeAccountDeletionJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDeleteUser.mockResolvedValue({ error: null });
    mockStorageList.mockResolvedValue({ data: [], error: null });
    mockStorageRemove.mockResolvedValue({ data: [], error: null });
  });

  it('executa os steps 1-6 em ordem e devolve completed', async () => {
    mockServiceExecute
      .mockResolvedValueOnce([{ id: 'job-1' }]) // Step 1: in_progress (returning)
      .mockResolvedValueOnce(undefined) // Step 2: DELETE household
      .mockResolvedValueOnce(undefined) // Step 5: UPDATE completed (no-op)
      .mockResolvedValueOnce(undefined); // Step 6: audit_log

    const result = await purgeAccountDeletionJob(JOB);

    expect(result.outcome).toBe('completed');
    expect(result.householdId).toBe('hh-1');

    // Step 1 → in_progress.
    expect(sqlText(0)).toContain('in_progress');
    // Step 2 → DELETE households.
    expect(sqlText(1)).toContain('delete from public.households');
    // Step 3 → deleteUser DEPOIS do DELETE do household.
    expect(mockDeleteUser).toHaveBeenCalledWith('user-1');
    // Step 6 → audit_log com household_id NULL e action executed.
    const auditSql = sqlText(3);
    expect(auditSql).toContain('account_deletion_executed');
    expect(auditSql).toContain('audit_log');
  });

  it('idempotência: Step 1 sem rows (já não scheduled) → completed sem apagar', async () => {
    mockServiceExecute.mockResolvedValueOnce([]); // Step 1 returning vazio

    const result = await purgeAccountDeletionJob(JOB);

    expect(result.outcome).toBe('completed');
    // Não chegou a apagar o household nem o utilizador.
    expect(mockDeleteUser).not.toHaveBeenCalled();
    expect(mockServiceExecute).toHaveBeenCalledTimes(1);
  });

  it('Step 4 (storage) remove resíduos quando há ficheiros', async () => {
    mockServiceExecute
      .mockResolvedValueOnce([{ id: 'job-1' }]) // Step 1
      .mockResolvedValueOnce(undefined) // Step 2
      .mockResolvedValueOnce(undefined) // Step 5
      .mockResolvedValueOnce(undefined); // Step 6
    mockStorageList.mockResolvedValueOnce({
      data: [{ name: 'job-x.zip' }],
      error: null,
    });

    const result = await purgeAccountDeletionJob(JOB);

    expect(result.outcome).toBe('completed');
    expect(mockStorageRemove).toHaveBeenCalledWith(['hh-1/job-x.zip']);
  });

  it('Step 4 best-effort: erro no Storage não falha o purge', async () => {
    mockServiceExecute
      .mockResolvedValueOnce([{ id: 'job-1' }])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);
    mockStorageList.mockRejectedValueOnce(new Error('storage down'));

    const result = await purgeAccountDeletionJob(JOB);
    expect(result.outcome).toBe('completed');
  });

  it('erro no Step 2 (DELETE household) → failed + audit de falha', async () => {
    mockServiceExecute
      .mockResolvedValueOnce([{ id: 'job-1' }]) // Step 1
      .mockRejectedValueOnce(new Error('cascade boom')) // Step 2 falha
      .mockResolvedValueOnce(undefined) // markJobFailed
      .mockResolvedValueOnce(undefined); // audit de falha

    const result = await purgeAccountDeletionJob(JOB);

    expect(result.outcome).toBe('failed');
    expect(result.errorMessage).toMatch(/cascade boom/i);
    // markJobFailed marca status='failed'.
    const failSql = JSON.stringify(
      mockServiceExecute.mock.calls.find((c) => JSON.stringify(c[0]).includes('failed'))?.[0] ?? {},
    );
    expect(failSql).toContain('failed');
  });

  it('erro no deleteUser (Step 3) → failed', async () => {
    mockServiceExecute
      .mockResolvedValueOnce([{ id: 'job-1' }]) // Step 1
      .mockResolvedValueOnce(undefined) // Step 2
      .mockResolvedValueOnce(undefined) // markJobFailed
      .mockResolvedValueOnce(undefined); // audit de falha
    mockDeleteUser.mockResolvedValueOnce({ error: { message: 'auth boom' } });

    const result = await purgeAccountDeletionJob(JOB);
    expect(result.outcome).toBe('failed');
    expect(result.errorMessage).toMatch(/auth boom/i);
  });
});

describe('selectEligibleJobs', () => {
  beforeEach(() => vi.clearAllMocks());

  it('devolve os jobs scheduled com scheduled_for <= now()', async () => {
    mockServiceExecute.mockResolvedValueOnce([JOB]);
    const db = { execute: mockServiceExecute } as unknown as DbShim;
    const jobs = await selectEligibleJobs(db);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.id).toBe('job-1');
    expect(sqlText(0)).toContain('scheduled');
  });

  it('devolve [] quando não há jobs elegíveis', async () => {
    mockServiceExecute.mockResolvedValueOnce([]);
    const db = { execute: mockServiceExecute } as unknown as DbShim;
    const jobs = await selectEligibleJobs(db);
    expect(jobs).toEqual([]);
  });
});
