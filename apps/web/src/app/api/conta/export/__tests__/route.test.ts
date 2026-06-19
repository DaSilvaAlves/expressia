import { NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

/**
 * Testes de `/api/conta/export` (POST) e `/api/conta/export/[jobId]` (GET) —
 * Story 6.8 AC1/AC2/AC8 (T7.1 + T7.2).
 *
 * Mocks: auth (requireAuth), db-shim (getDb/getServiceDb — CRÍTICO verificar que
 * o UPDATE usa SEMPRE getServiceDb, nunca getDb), generate-export (mock Storage),
 * audit GDPR, observability. Não toca DB real.
 */

const mockGetDbExecute = vi.fn();
const mockServiceDbExecute = vi.fn();

vi.mock('@/lib/agent/db-shim', () => ({
  getDb: vi.fn(() => ({ execute: mockGetDbExecute })),
  // getServiceDb é mockado em separado — assert crítico AC8 (UPDATE via service-role).
  getServiceDb: vi.fn(() => ({ execute: mockServiceDbExecute })),
}));

vi.mock('@/lib/api-helpers/auth', () => ({
  requireAuth: vi.fn(),
}));

const mockGenerateExportForJob = vi.fn();
vi.mock('@/lib/gdpr/generate-export', () => ({
  generateExportForJob: (auth: unknown, jobId: unknown) =>
    mockGenerateExportForJob(auth, jobId),
}));

const mockInsertExportAuditLog = vi.fn(async (_params: unknown) => undefined);
vi.mock('@/lib/gdpr/audit', () => ({
  insertExportAuditLog: (params: unknown) => mockInsertExportAuditLog(params),
}));

vi.mock('@meu-jarvis/observability', () => ({
  withSpan: vi.fn((_name, _attrs, fn) => fn({ setAttribute: vi.fn() })),
  annotateSpan: vi.fn(),
  captureException: vi.fn(),
  childLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
  hashForCorrelation: vi.fn((s: string) => `hash_${s}`),
}));

import { requireAuth } from '@/lib/api-helpers/auth';
import { getServiceDb } from '@/lib/agent/db-shim';

const AUTH = { userId: 'user-1', householdId: 'hh-1' };
const JOB_ID = '11111111-1111-1111-1111-111111111111';

describe('POST /api/conta/export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (requireAuth as Mock).mockResolvedValue(AUTH);
  });

  it('401 quando requireAuth devolve NextResponse', async () => {
    (requireAuth as Mock).mockResolvedValue(NextResponse.json({}, { status: 401 }));
    const { POST } = await import('../route');
    const res = await POST();
    expect(res.status).toBe(401);
  });

  it('409 quando já existe export em curso/disponível', async () => {
    // 1ª query getDb (verificação de duplicado) → devolve um job existente.
    mockGetDbExecute.mockResolvedValueOnce([{ id: 'existing-job' }]);
    const { POST } = await import('../route');
    const res = await POST();
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error.message).toMatch(/em curso ou disponível/i);
  });

  it('200 cria job, gera ZIP e devolve downloadUrl — UPDATE usa getServiceDb (AC8)', async () => {
    const expiresAt = new Date('2026-06-19T14:30:00Z');
    // getDb.execute por ordem:
    //   1) verificação duplicado → [] (sem duplicado)
    //   2) INSERT job → [{ id: JOB_ID }]
    //   3) loadOwnedJob SELECT → [{ ...job }]
    //   4) audit data_export_requested → undefined
    //   5) audit data_export_completed → undefined
    mockGetDbExecute
      .mockResolvedValueOnce([]) // duplicado
      .mockResolvedValueOnce([{ id: JOB_ID }]) // INSERT
      .mockResolvedValueOnce([
        { id: JOB_ID, household_id: 'hh-1', status: 'pending' },
      ]) // loadOwnedJob
      .mockResolvedValue(undefined); // audits (chamadas extra)

    mockServiceDbExecute.mockResolvedValue(undefined);

    mockGenerateExportForJob.mockResolvedValueOnce({
      storagePath: 'hh-1/job.zip',
      downloadUrl: 'https://storage/signed',
      expiresAt,
      zipFileName: 'hh-1-export-20260618.zip',
    });

    const { POST } = await import('../route');
    const res = await POST();

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.jobId).toBe(JOB_ID);
    expect(json.downloadUrl).toBe('https://storage/signed');
    expect(json.expiresAt).toBe(expiresAt.toISOString());

    // AC8 CRÍTICO: o UPDATE de status passou por getServiceDb (generating + ready),
    // NUNCA por getDb (que só fez SELECT/INSERT/audit).
    expect(getServiceDb as Mock).toHaveBeenCalled();
    expect(mockServiceDbExecute).toHaveBeenCalled();

    // Audit das duas acções GDPR.
    expect(mockInsertExportAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'data_export_requested', jobId: JOB_ID }),
    );
    expect(mockInsertExportAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'data_export_completed', jobId: JOB_ID }),
    );

    // generateExportForJob recebeu o auth + jobId.
    expect(mockGenerateExportForJob).toHaveBeenCalledWith(AUTH, JOB_ID);
  });

  it('500 e marca job failed quando a geração falha', async () => {
    mockGetDbExecute
      .mockResolvedValueOnce([]) // duplicado
      .mockResolvedValueOnce([{ id: JOB_ID }]) // INSERT
      .mockResolvedValueOnce([
        { id: JOB_ID, household_id: 'hh-1', status: 'pending' },
      ]) // loadOwnedJob
      .mockResolvedValue(undefined);
    mockServiceDbExecute.mockResolvedValue(undefined);
    mockGenerateExportForJob.mockRejectedValueOnce(new Error('storage down'));

    const { POST } = await import('../route');
    const res = await POST();

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error.code).toBe('EXPORT_GENERATION_FAILED');
    // markJobFailed → service-role UPDATE.
    expect(mockServiceDbExecute).toHaveBeenCalled();
  });
});
