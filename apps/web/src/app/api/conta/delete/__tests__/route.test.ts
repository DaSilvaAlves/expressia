import { NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

/**
 * Testes de `/api/conta/delete` — Story 6.9 AC1/AC2/AC3/AC7/AC8 (T8.1-T8.3).
 *
 * Mocks: auth (requireAuth), db-shim (getDb — PO-FIX-2: o mock é no path real
 * `@/lib/agent/db-shim`), audit dedicado, observability. Não toca DB real.
 *
 * PO-FIX-1: todas as queries filtram `household_id` explicitamente — os testes
 * verificam a presença do household no SQL parametrizado.
 */

const mockGetDbExecute = vi.fn();

vi.mock('@/lib/agent/db-shim', () => ({
  getDb: vi.fn(() => ({ execute: mockGetDbExecute })),
  getServiceDb: vi.fn(() => ({ execute: vi.fn() })),
}));

vi.mock('@/lib/api-helpers/auth', () => ({
  requireAuth: vi.fn(),
}));

const mockInsertAudit = vi.fn(async (_params: unknown) => undefined);
vi.mock('@/lib/gdpr/account-deletion-audit', () => ({
  insertAccountDeletionAuditLog: (params: unknown) => mockInsertAudit(params),
}));

vi.mock('@meu-jarvis/observability', () => ({
  withSpan: vi.fn((_name, _attrs, fn) => fn({ setAttribute: vi.fn() })),
  annotateSpan: vi.fn(),
  captureException: vi.fn(),
  childLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
  hashForCorrelation: vi.fn((s: string) => `hash_${s}`),
}));

import { requireAuth } from '@/lib/api-helpers/auth';

const AUTH = { userId: 'user-1', householdId: 'hh-1' };
const JOB_ID = '11111111-1111-1111-1111-111111111111';

describe('POST /api/conta/delete', () => {
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

  it('409 quando já existe uma eliminação agendada', async () => {
    mockGetDbExecute.mockResolvedValueOnce([{ id: 'existing-job' }]);
    const { POST } = await import('../route');
    const res = await POST();
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error.code).toBe('DELETION_ALREADY_SCHEDULED');
    expect(json.error.message).toMatch(/já tens uma eliminação/i);
  });

  it('200 agenda eliminação (job criado + audit + scheduledFor)', async () => {
    const scheduledFor = '2026-07-19T03:00:00.000Z';
    mockGetDbExecute
      .mockResolvedValueOnce([]) // duplicado → nenhum
      .mockResolvedValueOnce([{ id: JOB_ID, scheduled_for: scheduledFor }]); // INSERT

    const { POST } = await import('../route');
    const res = await POST();

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.jobId).toBe(JOB_ID);
    expect(json.scheduledFor).toBe(new Date(scheduledFor).toISOString());

    // Audit account_deletion_requested.
    expect(mockInsertAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'account_deletion_requested', jobId: JOB_ID }),
    );

    // PO-FIX-1: a query de INSERT inclui o household_id no SQL parametrizado.
    const insertCall = mockGetDbExecute.mock.calls[1]?.[0] as { queryChunks?: unknown };
    expect(JSON.stringify(insertCall)).toContain('hh-1');
  });

  it('500 quando o INSERT do job falha', async () => {
    mockGetDbExecute
      .mockResolvedValueOnce([]) // duplicado → nenhum
      .mockRejectedValueOnce(new Error('db down')); // INSERT

    const { POST } = await import('../route');
    const res = await POST();
    expect(res.status).toBe(500);
  });
});

describe('DELETE /api/conta/delete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (requireAuth as Mock).mockResolvedValue(AUTH);
  });

  it('401 quando requireAuth devolve NextResponse', async () => {
    (requireAuth as Mock).mockResolvedValue(NextResponse.json({}, { status: 401 }));
    const { DELETE } = await import('../route');
    const res = await DELETE();
    expect(res.status).toBe(401);
  });

  it('404 quando não há eliminação agendada (0 rows no UPDATE)', async () => {
    mockGetDbExecute.mockResolvedValueOnce([]); // UPDATE returning → nenhuma row
    const { DELETE } = await import('../route');
    const res = await DELETE();
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error.code).toBe('DELETION_NOT_SCHEDULED');
  });

  it('200 cancela a eliminação (UPDATE + audit)', async () => {
    const canceledAt = '2026-06-20T10:00:00.000Z';
    mockGetDbExecute.mockResolvedValueOnce([{ id: JOB_ID, canceled_at: canceledAt }]); // UPDATE

    const { DELETE } = await import('../route');
    const res = await DELETE();

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.jobId).toBe(JOB_ID);
    expect(json.canceledAt).toBe(new Date(canceledAt).toISOString());

    expect(mockInsertAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'account_deletion_canceled', jobId: JOB_ID }),
    );

    // PO-FIX-1: o UPDATE filtra household_id explicitamente.
    const updateCall = mockGetDbExecute.mock.calls[0]?.[0];
    expect(JSON.stringify(updateCall)).toContain('hh-1');
  });

  it('500 quando o UPDATE falha', async () => {
    mockGetDbExecute.mockRejectedValueOnce(new Error('db down'));
    const { DELETE } = await import('../route');
    const res = await DELETE();
    expect(res.status).toBe(500);
  });
});

describe('GET /api/conta/delete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (requireAuth as Mock).mockResolvedValue(AUTH);
  });

  it('401 quando requireAuth devolve NextResponse', async () => {
    (requireAuth as Mock).mockResolvedValue(NextResponse.json({}, { status: 401 }));
    const { GET } = await import('../route');
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('200 { job: null } quando não há eliminação agendada', async () => {
    mockGetDbExecute.mockResolvedValueOnce([]);
    const { GET } = await import('../route');
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.job).toBeNull();
  });

  it('200 { job: DTO } quando existe eliminação agendada', async () => {
    const scheduledFor = '2026-07-19T03:00:00.000Z';
    const createdAt = '2026-06-19T03:00:00.000Z';
    mockGetDbExecute.mockResolvedValueOnce([
      { id: JOB_ID, status: 'scheduled', scheduled_for: scheduledFor, created_at: createdAt },
    ]);

    const { GET } = await import('../route');
    const res = await GET();

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.job).toEqual({
      jobId: JOB_ID,
      status: 'scheduled',
      scheduledFor: new Date(scheduledFor).toISOString(),
      createdAt: new Date(createdAt).toISOString(),
    });
  });

  it('500 quando o SELECT falha', async () => {
    mockGetDbExecute.mockRejectedValueOnce(new Error('db down'));
    const { GET } = await import('../route');
    const res = await GET();
    expect(res.status).toBe(500);
  });
});
