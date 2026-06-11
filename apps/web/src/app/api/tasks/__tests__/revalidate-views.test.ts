// @vitest-environment node
/**
 * Testes W2 (make-it-work) — os route handlers de mutação de tarefas invalidam
 * a Visão (`/visao`) após sucesso.
 *
 * Estes testes FALHARIAM sem o fix: antes de W2 nenhum handler chamava
 * `revalidatePath`, pelo que os widgets de /visao ficavam stale até refresh
 * manual. Asseguram a regressão para POST (criar), PATCH (editar/concluir) e
 * DELETE (eliminar). O caminho `/move` partilha o mesmo helper
 * (`revalidateTaskViews`, testado unitariamente em
 * `@/lib/api-helpers/__tests__/revalidate.test.ts`).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  fromMock: vi.fn(),
  dbExecuteMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock('@meu-jarvis/auth/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: { getUser: mocks.getUserMock },
    from: mocks.fromMock,
  })),
}));

vi.mock('@/lib/agent/db-shim', () => ({
  getDb: () => ({ execute: mocks.dbExecuteMock }),
  getServiceDb: () => ({ execute: mocks.dbExecuteMock }),
  withHousehold: (
    _auth: { userId: string; householdId: string },
    fn: (tx: { execute: typeof mocks.dbExecuteMock }) => unknown,
  ) => fn({ execute: mocks.dbExecuteMock }),
}));

vi.mock('next/cache', () => ({
  revalidatePath: mocks.revalidatePathMock,
}));

import { NextRequest } from 'next/server';

const { POST } = await import('@/app/api/tasks/route');
const { PATCH, DELETE } = await import('@/app/api/tasks/[id]/route');

const USER_UUID = '00000000-0000-0000-0000-000000000001';
const HOUSEHOLD_UUID = '00000000-0000-0000-0000-000000000002';
const TASK_UUID = '00000000-0000-0000-0000-000000000abc';

function householdChain(id: string | null) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          maybeSingle: vi
            .fn()
            .mockResolvedValue({ data: id ? { household_id: id } : null, error: null }),
        }),
      }),
    }),
  };
}

function authedDefaults() {
  mocks.getUserMock.mockResolvedValue({ data: { user: { id: USER_UUID } }, error: null });
  mocks.fromMock.mockReturnValue(householdChain(HOUSEHOLD_UUID));
}

function makeCtx() {
  return { params: Promise.resolve({ id: TASK_UUID }) };
}

function revalidatedPaths(): string[] {
  return mocks.revalidatePathMock.mock.calls.map((c) => c[0] as string);
}

describe('W2 — mutações de tarefas revalidam a Visão', () => {
  beforeEach(() => {
    mocks.getUserMock.mockReset();
    mocks.fromMock.mockReset();
    mocks.dbExecuteMock.mockReset();
    mocks.revalidatePathMock.mockReset();
  });

  it('POST /api/tasks revalida /visao após criar', async () => {
    authedDefaults();
    mocks.dbExecuteMock
      .mockResolvedValueOnce([{ id: TASK_UUID, title: 'X', status: 'todo', priority: 'medium' }])
      .mockResolvedValueOnce([]);
    const res = await POST(
      new NextRequest(
        new Request('http://localhost/api/tasks', {
          method: 'POST',
          body: JSON.stringify({ title: 'X' }),
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    expect(res.status).toBe(201);
    expect(revalidatedPaths()).toContain('/visao');
  });

  it('PATCH /api/tasks/[id] revalida /visao após concluir (status=done)', async () => {
    authedDefaults();
    mocks.dbExecuteMock
      .mockResolvedValueOnce([{ id: TASK_UUID, status: 'done', title: 'X' }])
      .mockResolvedValueOnce([]);
    const res = await PATCH(
      new NextRequest(
        new Request(`http://localhost/api/tasks/${TASK_UUID}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'done' }),
          headers: { 'content-type': 'application/json' },
        }),
      ),
      makeCtx(),
    );
    expect(res.status).toBe(200);
    expect(revalidatedPaths()).toContain('/visao');
  });

  it('DELETE /api/tasks/[id] revalida /visao após eliminar', async () => {
    authedDefaults();
    mocks.dbExecuteMock
      .mockResolvedValueOnce([{ id: TASK_UUID }])
      .mockResolvedValueOnce([]);
    const res = await DELETE(
      new NextRequest(new Request(`http://localhost/api/tasks/${TASK_UUID}`, { method: 'DELETE' })),
      makeCtx(),
    );
    expect(res.status).toBe(200);
    expect(revalidatedPaths()).toContain('/visao');
  });

  it('NÃO revalida quando a mutação falha (PATCH 404 — task inexistente)', async () => {
    authedDefaults();
    // UPDATE retorna 0 rows → 404; revalidação não deve ocorrer.
    mocks.dbExecuteMock.mockResolvedValueOnce([]);
    const res = await PATCH(
      new NextRequest(
        new Request(`http://localhost/api/tasks/${TASK_UUID}`, {
          method: 'PATCH',
          body: JSON.stringify({ title: 'Y' }),
          headers: { 'content-type': 'application/json' },
        }),
      ),
      makeCtx(),
    );
    expect(res.status).toBe(404);
    expect(revalidatedPaths()).not.toContain('/visao');
  });
});
