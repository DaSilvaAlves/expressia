import { NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

/**
 * Testes de `GET /api/conta/export/[jobId]` — Story 6.8 AC2/AC8 (T7.2).
 *
 * Cobre: 404 not-owner/not-found; 200 ready (URL); 200 expired (URL null +
 * verificação que o UPDATE de `expired` usa getServiceDb, NUNCA getDb — AC8);
 * 200 failed (mensagem genérica PT-PT).
 */

const mockGetDbExecute = vi.fn();
const mockServiceDbExecute = vi.fn();

vi.mock('@/lib/agent/db-shim', () => ({
  getDb: vi.fn(() => ({ execute: mockGetDbExecute })),
  getServiceDb: vi.fn(() => ({ execute: mockServiceDbExecute })),
}));

vi.mock('@/lib/api-helpers/auth', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@meu-jarvis/observability', () => ({
  withSpan: vi.fn((_name, _attrs, fn) => fn({ setAttribute: vi.fn() })),
  annotateSpan: vi.fn(),
  captureException: vi.fn(),
  childLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
}));

import { requireAuth } from '@/lib/api-helpers/auth';
import { getServiceDb } from '@/lib/agent/db-shim';

const AUTH = { userId: 'user-1', householdId: 'hh-1' };
const JOB_ID = '11111111-1111-1111-1111-111111111111';

function makeContext(jobId: string): { params: Promise<{ jobId: string }> } {
  return { params: Promise.resolve({ jobId }) };
}

describe('GET /api/conta/export/[jobId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (requireAuth as Mock).mockResolvedValue(AUTH);
  });

  it('401 quando requireAuth devolve NextResponse', async () => {
    (requireAuth as Mock).mockResolvedValue(NextResponse.json({}, { status: 401 }));
    const { GET } = await import('../route');
    const res = await GET(new Request('http://localhost'), makeContext(JOB_ID));
    expect(res.status).toBe(401);
  });

  it('404 quando o job não pertence ao household (loadOwnedJob → vazio)', async () => {
    mockGetDbExecute.mockResolvedValueOnce([]); // SELECT scoped não encontra
    const { GET } = await import('../route');
    const res = await GET(new Request('http://localhost'), makeContext(JOB_ID));
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error.code).toBe('EXPORT_JOB_NOT_FOUND');
    // Nunca chamou service-role para um job inexistente.
    expect(mockServiceDbExecute).not.toHaveBeenCalled();
  });

  it('200 ready devolve downloadUrl e expiresAt', async () => {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    mockGetDbExecute.mockResolvedValueOnce([
      {
        id: JOB_ID,
        household_id: 'hh-1',
        status: 'ready',
        storage_path: 'hh-1/job.zip',
        download_url: 'https://storage/signed',
        expires_at: future,
        created_at: '2026-06-18T10:00:00.000Z',
        error_message: null,
      },
    ]);
    const { GET } = await import('../route');
    const res = await GET(new Request('http://localhost'), makeContext(JOB_ID));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe('ready');
    expect(json.downloadUrl).toBe('https://storage/signed');
    expect(json.expiresAt).toBe(future);
    // Job válido — não houve transição de estado.
    expect(mockServiceDbExecute).not.toHaveBeenCalled();
  });

  it('200 expired: ready mas expirado → status expired + URL null, UPDATE via getServiceDb (AC8)', async () => {
    const past = new Date(Date.now() - 3_600_000).toISOString();
    mockGetDbExecute.mockResolvedValueOnce([
      {
        id: JOB_ID,
        household_id: 'hh-1',
        status: 'ready',
        storage_path: 'hh-1/job.zip',
        download_url: 'https://storage/signed',
        expires_at: past,
        created_at: '2026-06-17T10:00:00.000Z',
        error_message: null,
      },
    ]);
    mockServiceDbExecute.mockResolvedValueOnce(undefined);

    const { GET } = await import('../route');
    const res = await GET(new Request('http://localhost'), makeContext(JOB_ID));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe('expired');
    expect(json.downloadUrl).toBeNull();
    expect(json.expiresAt).toBeNull();

    // AC8 CRÍTICO: a transição para `expired` usou getServiceDb (UPDATE bloqueado
    // para authenticated), NUNCA getDb.
    expect(getServiceDb as Mock).toHaveBeenCalled();
    expect(mockServiceDbExecute).toHaveBeenCalledTimes(1);
  });

  it('200 failed devolve mensagem genérica PT-PT e URL null', async () => {
    mockGetDbExecute.mockResolvedValueOnce([
      {
        id: JOB_ID,
        household_id: 'hh-1',
        status: 'failed',
        storage_path: null,
        download_url: null,
        expires_at: null,
        created_at: '2026-06-18T10:00:00.000Z',
        error_message: 'erro interno',
      },
    ]);
    const { GET } = await import('../route');
    const res = await GET(new Request('http://localhost'), makeContext(JOB_ID));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe('failed');
    expect(json.downloadUrl).toBeNull();
    expect(json.errorMessage).toMatch(/não foi possível gerar/i);
    expect(mockServiceDbExecute).not.toHaveBeenCalled();
  });
});
