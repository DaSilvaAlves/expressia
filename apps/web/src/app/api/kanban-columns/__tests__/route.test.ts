// @vitest-environment node
/**
 * Testes endpoints /api/kanban-columns/* (Story 3.4 T3.4).
 *
 * Cobre: GET list ordered, POST cria, POST count=6 rejeita, POST duplicado 409,
 * PATCH is_done_column single-true, DELETE com move_to, batch transaction +
 * invariants validation.
 *
 * Pattern: vi.hoisted + vi.mock (consistente Story 3.2 `tags/__tests__/crud.test.ts`).
 *
 * NOTA: audit_log INSERTs são best-effort (try/catch). Mocks deixam dbExecuteMock
 * a aceitar qualquer call — testes não validam audit por defeito (feature flag
 * `KANBAN_AUDIT_ENABLED` desligado por defeito em tests).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  fromMock: vi.fn(),
  dbExecuteMock: vi.fn(),
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
}));

import { NextRequest } from 'next/server';

const { GET, POST } = await import('@/app/api/kanban-columns/route');
const idRoute = await import('@/app/api/kanban-columns/[id]/route');
const batchRoute = await import('@/app/api/kanban-columns/batch/route');

const USER_UUID = '00000000-0000-0000-0000-000000000001';
const HOUSEHOLD_UUID = '00000000-0000-0000-0000-000000000002';
const COL1_UUID = '00000000-0000-0000-0000-000000000aa1';
const COL2_UUID = '00000000-0000-0000-0000-000000000aa2';
const COL3_UUID = '00000000-0000-0000-0000-000000000aa3';

function memberChain(field: string, value: unknown) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          maybeSingle: vi
            .fn()
            .mockResolvedValue({ data: value ? { [field]: value } : null, error: null }),
        }),
        eq: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            maybeSingle: vi
              .fn()
              .mockResolvedValue({ data: value ? { [field]: value } : null, error: null }),
          }),
        }),
      }),
    }),
  };
}

function authedAsOwner() {
  mocks.getUserMock.mockResolvedValue({ data: { user: { id: USER_UUID } }, error: null });
  let callCount = 0;
  mocks.fromMock.mockImplementation(() => {
    callCount++;
    if (callCount === 1) return memberChain('household_id', HOUSEHOLD_UUID);
    return memberChain('role', 'owner');
  });
}

function authedAsMember() {
  mocks.getUserMock.mockResolvedValue({ data: { user: { id: USER_UUID } }, error: null });
  let callCount = 0;
  mocks.fromMock.mockImplementation(() => {
    callCount++;
    if (callCount === 1) return memberChain('household_id', HOUSEHOLD_UUID);
    return memberChain('role', 'member');
  });
}

beforeEach(() => {
  mocks.getUserMock.mockReset();
  mocks.fromMock.mockReset();
  mocks.dbExecuteMock.mockReset();
});

// ─── GET ─────────────────────────────────────────────────────────────────────

describe('GET /api/kanban-columns', () => {
  it('401 sem auth', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: null }, error: null });
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('200 lista colunas ordenadas', async () => {
    authedAsOwner();
    mocks.dbExecuteMock.mockResolvedValue([
      {
        id: COL1_UUID,
        household_id: HOUSEHOLD_UUID,
        name: 'A fazer',
        sort_order: 0,
        color: '#6B7280',
        is_done_column: 'false',
        created_at: '2026-05-01',
        updated_at: '2026-05-01',
      },
      {
        id: COL2_UUID,
        household_id: HOUSEHOLD_UUID,
        name: 'Em curso',
        sort_order: 1,
        color: '#6B7280',
        is_done_column: 'false',
        created_at: '2026-05-01',
        updated_at: '2026-05-01',
      },
    ]);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.columns).toHaveLength(2);
    expect(body.columns[0].name).toBe('A fazer');
    expect(body.columns[0].is_done_column).toBe(false);
  });
});

// ─── POST ────────────────────────────────────────────────────────────────────

describe('POST /api/kanban-columns', () => {
  it('400 quando body vazio', async () => {
    authedAsOwner();
    const req = new NextRequest('http://localhost/api/kanban-columns', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'content-type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('400 quando name excede 40 chars', async () => {
    authedAsOwner();
    const req = new NextRequest('http://localhost/api/kanban-columns', {
      method: 'POST',
      body: JSON.stringify({ name: 'a'.repeat(41) }),
      headers: { 'content-type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('409 quando count atinge 6 (MAX_COLUMNS_PER_HOUSEHOLD)', async () => {
    authedAsOwner();
    mocks.dbExecuteMock.mockResolvedValueOnce([{ count: '6' }]);
    const req = new NextRequest('http://localhost/api/kanban-columns', {
      method: 'POST',
      body: JSON.stringify({ name: 'Nova' }),
      headers: { 'content-type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('COLUMN_LIMIT_REACHED');
  });

  it('409 quando nome duplicado', async () => {
    authedAsOwner();
    mocks.dbExecuteMock
      .mockResolvedValueOnce([{ count: '3' }]) // count check
      .mockResolvedValueOnce([{ id: COL1_UUID }]); // duplicate check returns row
    const req = new NextRequest('http://localhost/api/kanban-columns', {
      method: 'POST',
      body: JSON.stringify({ name: 'A fazer' }),
      headers: { 'content-type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('DUPLICATE_NAME');
  });

  it('201 cria com sort_order auto', async () => {
    authedAsOwner();
    mocks.dbExecuteMock
      .mockResolvedValueOnce([{ count: '3' }])
      .mockResolvedValueOnce([]) // no duplicate
      .mockResolvedValueOnce([{ max_order: 2 }])
      .mockResolvedValueOnce([
        {
          id: COL3_UUID,
          household_id: HOUSEHOLD_UUID,
          name: 'Bloqueado',
          sort_order: 3,
          color: '#6B7280',
          is_done_column: 'false',
          created_at: '2026-05-17',
          updated_at: '2026-05-17',
        },
      ])
      .mockResolvedValueOnce([]); // audit_log skipped (flag off)
    const req = new NextRequest('http://localhost/api/kanban-columns', {
      method: 'POST',
      body: JSON.stringify({ name: 'Bloqueado' }),
      headers: { 'content-type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.column.name).toBe('Bloqueado');
    expect(body.column.sort_order).toBe(3);
    expect(body.column.is_done_column).toBe(false);
  });
});

// ─── PATCH [id] ──────────────────────────────────────────────────────────────

describe('PATCH /api/kanban-columns/[id]', () => {
  it('400 quando id inválido', async () => {
    authedAsOwner();
    const req = new NextRequest('http://localhost/api/kanban-columns/not-uuid', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'X' }),
      headers: { 'content-type': 'application/json' },
    });
    const res = await idRoute.PATCH(req, {
      params: Promise.resolve({ id: 'not-uuid' }),
    });
    expect(res.status).toBe(400);
  });

  it('404 quando coluna não existe', async () => {
    authedAsOwner();
    mocks.dbExecuteMock.mockResolvedValueOnce([]);
    const req = new NextRequest(`http://localhost/api/kanban-columns/${COL1_UUID}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: 'X' }),
      headers: { 'content-type': 'application/json' },
    });
    const res = await idRoute.PATCH(req, {
      params: Promise.resolve({ id: COL1_UUID }),
    });
    expect(res.status).toBe(404);
  });

  it('200 update is_done_column=true desliga outros (transaction)', async () => {
    authedAsOwner();
    mocks.dbExecuteMock
      // SELECT current
      .mockResolvedValueOnce([
        {
          id: COL2_UUID,
          household_id: HOUSEHOLD_UUID,
          name: 'Em curso',
          sort_order: 1,
          color: '#6B7280',
          is_done_column: 'false',
        },
      ])
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce(undefined) // UPDATE outros set is_done_column=false
      .mockResolvedValueOnce(undefined) // UPDATE coluna principal
      .mockResolvedValueOnce(undefined) // COMMIT
      // audit_log skipped (KANBAN_AUDIT_ENABLED off — early return, no db.execute call)
      .mockResolvedValueOnce([
        {
          id: COL2_UUID,
          household_id: HOUSEHOLD_UUID,
          name: 'Em curso',
          sort_order: 1,
          color: '#6B7280',
          is_done_column: 'true',
        },
      ]);
    const req = new NextRequest(`http://localhost/api/kanban-columns/${COL2_UUID}`, {
      method: 'PATCH',
      body: JSON.stringify({ is_done_column: true }),
      headers: { 'content-type': 'application/json' },
    });
    const res = await idRoute.PATCH(req, {
      params: Promise.resolve({ id: COL2_UUID }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.column.is_done_column).toBe(true);
  });
});

// ─── DELETE [id] ─────────────────────────────────────────────────────────────

describe('DELETE /api/kanban-columns/[id]', () => {
  it('403 quando role é member (não owner/admin)', async () => {
    authedAsMember();
    const req = new NextRequest(`http://localhost/api/kanban-columns/${COL1_UUID}`, {
      method: 'DELETE',
    });
    const res = await idRoute.DELETE(req, {
      params: Promise.resolve({ id: COL1_UUID }),
    });
    expect(res.status).toBe(403);
  });

  it('409 quando coluna tem tasks e sem ?move_to', async () => {
    authedAsOwner();
    mocks.dbExecuteMock
      .mockResolvedValueOnce([
        {
          id: COL1_UUID,
          household_id: HOUSEHOLD_UUID,
          name: 'A fazer',
          sort_order: 0,
          color: '#6B7280',
          is_done_column: 'false',
        },
      ])
      .mockResolvedValueOnce([{ count: '5' }]);
    const req = new NextRequest(`http://localhost/api/kanban-columns/${COL1_UUID}`, {
      method: 'DELETE',
    });
    const res = await idRoute.DELETE(req, {
      params: Promise.resolve({ id: COL1_UUID }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('COLUMN_HAS_TASKS');
    expect(body.error.details.tasks_count).toBe(5);
  });

  it('200 elimina + move_to atómico', async () => {
    authedAsOwner();
    mocks.dbExecuteMock
      .mockResolvedValueOnce([
        {
          id: COL1_UUID,
          household_id: HOUSEHOLD_UUID,
          name: 'A fazer',
          sort_order: 0,
          color: '#6B7280',
          is_done_column: 'false',
        },
      ])
      .mockResolvedValueOnce([{ count: '3' }])
      .mockResolvedValueOnce([{ id: COL2_UUID }]) // destino exists
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce(undefined) // UPDATE tasks
      .mockResolvedValueOnce(undefined) // DELETE coluna
      .mockResolvedValueOnce(undefined) // COMMIT
      .mockResolvedValueOnce(undefined); // audit (skipped)
    const req = new NextRequest(
      `http://localhost/api/kanban-columns/${COL1_UUID}?move_to=${COL2_UUID}`,
      { method: 'DELETE' },
    );
    const res = await idRoute.DELETE(req, {
      params: Promise.resolve({ id: COL1_UUID }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deleted).toBe(true);
    expect(body.tasks_moved_count).toBe(3);
  });
});

// ─── PATCH batch ─────────────────────────────────────────────────────────────

describe('PATCH /api/kanban-columns/batch', () => {
  it('400 quando body inválido (campo extra)', async () => {
    authedAsOwner();
    const req = new NextRequest('http://localhost/api/kanban-columns/batch', {
      method: 'PATCH',
      body: JSON.stringify({ columns: [], unknownField: 'x' }),
      headers: { 'content-type': 'application/json' },
    });
    const res = await batchRoute.PATCH(req);
    expect(res.status).toBe(400);
  });

  it('422 quando deletes[].move_to é a mesma coluna', async () => {
    authedAsOwner();
    // validateInput: existing columns mock
    mocks.dbExecuteMock.mockResolvedValueOnce([
      { id: COL1_UUID, name: 'A fazer' },
      { id: COL2_UUID, name: 'Em curso' },
    ]);
    const req = new NextRequest('http://localhost/api/kanban-columns/batch', {
      method: 'PATCH',
      body: JSON.stringify({
        columns: [],
        deletes: [{ id: COL1_UUID, move_to: COL1_UUID }],
      }),
      headers: { 'content-type': 'application/json' },
    });
    const res = await batchRoute.PATCH(req);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.details.violations).toContain('move_to_self');
  });

  it('200 batch passes — return final state', async () => {
    authedAsOwner();
    mocks.dbExecuteMock
      // validateInput: existing
      .mockResolvedValueOnce([
        { id: COL1_UUID, name: 'A fazer' },
        { id: COL2_UUID, name: 'Em curso' },
        { id: COL3_UUID, name: 'Concluído' },
      ])
      // before snapshot
      .mockResolvedValueOnce([
        {
          id: COL1_UUID,
          household_id: HOUSEHOLD_UUID,
          name: 'A fazer',
          sort_order: 0,
          color: '#6B7280',
          is_done_column: 'false',
        },
        {
          id: COL2_UUID,
          household_id: HOUSEHOLD_UUID,
          name: 'Em curso',
          sort_order: 1,
          color: '#6B7280',
          is_done_column: 'false',
        },
        {
          id: COL3_UUID,
          household_id: HOUSEHOLD_UUID,
          name: 'Concluído',
          sort_order: 2,
          color: '#6B7280',
          is_done_column: 'true',
        },
      ])
      .mockResolvedValueOnce(undefined) // BEGIN
      // is_done_column flip — UPDATE others set false (porque newDoneCol existe em columns[])
      .mockResolvedValueOnce(undefined)
      // 3 columns × (step1 negative offset) = 3 calls
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      // 3 columns × (step2 final UPDATE) = 3 calls
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      // validateInvariants
      .mockResolvedValueOnce([
        { id: COL1_UUID, name: 'A fazer', is_done_column: 'false' },
        { id: COL2_UUID, name: 'Em curso', is_done_column: 'false' },
        { id: COL3_UUID, name: 'Concluído', is_done_column: 'true' },
      ])
      .mockResolvedValueOnce(undefined) // COMMIT
      // audit_log skipped (flag off — no db.execute call)
      // final state response
      .mockResolvedValueOnce([
        {
          id: COL1_UUID,
          household_id: HOUSEHOLD_UUID,
          name: 'A fazer',
          sort_order: 0,
          color: '#6B7280',
          is_done_column: 'false',
        },
        {
          id: COL2_UUID,
          household_id: HOUSEHOLD_UUID,
          name: 'Em curso',
          sort_order: 1,
          color: '#6B7280',
          is_done_column: 'false',
        },
        {
          id: COL3_UUID,
          household_id: HOUSEHOLD_UUID,
          name: 'Concluído',
          sort_order: 2,
          color: '#6B7280',
          is_done_column: 'true',
        },
      ]);
    const req = new NextRequest('http://localhost/api/kanban-columns/batch', {
      method: 'PATCH',
      body: JSON.stringify({
        columns: [
          { id: COL1_UUID, sort_order: 0 },
          { id: COL2_UUID, sort_order: 1 },
          { id: COL3_UUID, sort_order: 2, is_done_column: true },
        ],
      }),
      headers: { 'content-type': 'application/json' },
    });
    const res = await batchRoute.PATCH(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.columns).toHaveLength(3);
  });
});
