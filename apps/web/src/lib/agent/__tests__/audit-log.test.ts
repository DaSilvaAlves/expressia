// @vitest-environment node
/**
 * Tests para `apps/web/src/lib/agent/audit-log.ts` — Story 2.9 AC15.
 *
 * Foco: D50 — `incrementQuota` deve usar `getServiceDb()` (bypass RLS),
 * não `getDb()` (authenticated bloqueado por RLS em agent_quotas).
 *
 * Trace: Story 2.9 AC9+AC15, D50+DN5, 0001_rls_policies.sql:353-362.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dbShimMocks = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  getServiceDbMock: vi.fn(),
  authenticatedExecute: vi.fn(),
  serviceExecute: vi.fn(),
}));

vi.mock('@/lib/agent/db-shim', () => ({
  getDb: dbShimMocks.getDbMock,
  getServiceDb: dbShimMocks.getServiceDbMock,
}));

import { incrementQuota } from '@/lib/agent/audit-log';

describe('incrementQuota — Story 2.9 D50 RLS critical fix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbShimMocks.getDbMock.mockReturnValue({ execute: dbShimMocks.authenticatedExecute });
    dbShimMocks.getServiceDbMock.mockReturnValue({ execute: dbShimMocks.serviceExecute });
    dbShimMocks.serviceExecute.mockResolvedValue([]);
    dbShimMocks.authenticatedExecute.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('AC15(audit-log i) — usa getServiceDb() (service_role bypass RLS)', async () => {
    await incrementQuota('00000000-0000-0000-0000-000000000001');
    expect(dbShimMocks.getServiceDbMock).toHaveBeenCalledTimes(1);
    expect(dbShimMocks.serviceExecute).toHaveBeenCalledTimes(1);
  });

  it('AC15(audit-log) — NÃO usa getDb() (authenticated — bloqueado por RLS)', async () => {
    await incrementQuota('00000000-0000-0000-0000-000000000001');
    expect(dbShimMocks.getDbMock).not.toHaveBeenCalled();
    expect(dbShimMocks.authenticatedExecute).not.toHaveBeenCalled();
  });

  it('AC15(audit-log) — assinatura sem param db (auto-suficiente per D55)', async () => {
    // Verifica que a função apenas precisa do householdId.
    // TS já garante shape; este test documenta a contract.
    const fn = incrementQuota as (h: string) => Promise<void>;
    await expect(fn('00000000-0000-0000-0000-000000000001')).resolves.toBeUndefined();
  });

  it('AC15(audit-log) — propaga erro DB do service_role (caller controla try/catch)', async () => {
    dbShimMocks.serviceExecute.mockRejectedValueOnce(new Error('service db crashed'));
    await expect(
      incrementQuota('00000000-0000-0000-0000-000000000001'),
    ).rejects.toThrow('service db crashed');
  });
});
