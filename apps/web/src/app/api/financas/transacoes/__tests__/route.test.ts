// @vitest-environment node
/**
 * Testes mockable-friendly — GET / POST /api/financas/transacoes (Story 4.3 AC1 + AC10).
 *
 * Cobre: auth (401), listagem, paginação cursor (`next_cursor`), cursor inválido
 * (400), Zod `.strict()` + refinamento `account_or_card` (400), FK cross-household
 * (404), happy path (201).
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

// Apenas `getDb` é mockado — os route handlers de Finanças NUNCA usam o cliente
// service-role (AC4 / R-4.7), portanto o factory não o fornece.
vi.mock('@/lib/agent/db-shim', () => ({
  getDb: () => ({ execute: mocks.dbExecuteMock }),
  // SEC-3: a operação principal passou a correr dentro de `withHousehold`. O mock
  // injecta um `tx` equivalente (`execute` é o único exercido pelas queries).
  withHousehold: (
    _auth: { userId: string; householdId: string },
    fn: (tx: { execute: typeof mocks.dbExecuteMock }) => unknown,
  ) => fn({ execute: mocks.dbExecuteMock }),
}));

import { NextRequest } from 'next/server';

const { GET, POST } = await import('@/app/api/financas/transacoes/route');

const USER_UUID = '00000000-0000-0000-0000-000000000001';
const HOUSEHOLD_UUID = '00000000-0000-0000-0000-000000000002';
const ACCOUNT_UUID = '00000000-0000-0000-0000-0000000000a1';
const CATEGORY_UUID = '00000000-0000-0000-0000-0000000000c1';

/**
 * Extrai recursivamente os valores dos parâmetros bound de um objecto `SQL` do
 * Drizzle (tagged template literal). Usado para provar que o `household_id`
 * autenticado é interpolado como parâmetro nas sub-queries de validação de FK
 * dos POST (isolamento de escrita app-enforced — SEC-1-F1).
 */
function boundParamValues(sqlObj: unknown): unknown[] {
  const out: unknown[] = [];
  const walkChunks = (chunks: unknown): void => {
    if (!Array.isArray(chunks)) return;
    for (const chunk of chunks) {
      if (chunk != null && typeof chunk === 'object') {
        const obj = chunk as Record<string, unknown>;
        if ('queryChunks' in obj) {
          walkChunks(obj.queryChunks); // SQL aninhado
        }
        // StringChunk (`.value` array) é texto SQL, não parâmetro — ignorar.
      } else {
        out.push(chunk); // valor primitivo = parâmetro bound
      }
    }
  };
  if (sqlObj != null && typeof sqlObj === 'object' && 'queryChunks' in (sqlObj as object)) {
    walkChunks((sqlObj as { queryChunks: unknown }).queryChunks);
  }
  return out;
}

function memberChain(field: string, value: unknown) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          maybeSingle: vi
            .fn()
            .mockResolvedValue({ data: value ? { [field]: value } : null, error: null }),
        }),
      }),
    }),
  };
}

function authed() {
  mocks.getUserMock.mockResolvedValue({ data: { user: { id: USER_UUID } }, error: null });
  mocks.fromMock.mockReturnValue(memberChain('household_id', HOUSEHOLD_UUID));
}

function getReq(qs = '') {
  return new NextRequest(new Request(`http://localhost/api/financas/transacoes${qs}`));
}

function postReq(body: unknown) {
  return new NextRequest(
    new Request('http://localhost/api/financas/transacoes', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }),
  );
}

const validBody = {
  account_id: ACCOUNT_UUID,
  amount_cents: 7870,
  kind: 'expense',
  description: 'Supermercado',
  transaction_date: '2026-05-21',
};

describe('GET /api/financas/transacoes', () => {
  beforeEach(() => {
    mocks.getUserMock.mockReset();
    mocks.fromMock.mockReset();
    mocks.dbExecuteMock.mockReset();
  });

  it('401 AUTH_REQUIRED se sem auth', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: null }, error: null });
    const res = await GET(getReq());
    expect(res.status).toBe(401);
  });

  it('200 lista transacções sem next_cursor quando cabem na página', async () => {
    authed();
    mocks.dbExecuteMock.mockResolvedValue([
      { id: 't1', transaction_date: '2026-05-21', amount_cents: 1000 },
      { id: 't2', transaction_date: '2026-05-20', amount_cents: 500 },
    ]);
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.transactions).toHaveLength(2);
    expect(body.next_cursor).toBeNull();
  });

  it('200 paginação devolve next_cursor quando há mais resultados', async () => {
    authed();
    // limit=2 → handler pede 3; a 3.ª row sinaliza próxima página.
    mocks.dbExecuteMock.mockResolvedValue([
      { id: 't1', transaction_date: '2026-05-21' },
      { id: 't2', transaction_date: '2026-05-20' },
      { id: 't3', transaction_date: '2026-05-19' },
    ]);
    const res = await GET(getReq('?limit=2'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.transactions).toHaveLength(2);
    expect(body.next_cursor).toBeTypeOf('string');
  });

  it('400 VALIDATION_ERROR se cursor é inválido', async () => {
    authed();
    const res = await GET(getReq('?cursor=isto-nao-e-um-cursor'));
    expect(res.status).toBe(400);
  });
});

describe('POST /api/financas/transacoes', () => {
  beforeEach(() => {
    mocks.getUserMock.mockReset();
    mocks.fromMock.mockReset();
    mocks.dbExecuteMock.mockReset();
  });

  it('400 VALIDATION_ERROR se nem account_id nem card_id (refinamento account_or_card)', async () => {
    authed();
    const res = await POST(
      postReq({
        amount_cents: 1000,
        kind: 'expense',
        description: 'X',
        transaction_date: '2026-05-21',
      }),
    );
    expect(res.status).toBe(400);
  });

  it('400 VALIDATION_ERROR se body inclui household_id (Zod strict — RLS leak defense)', async () => {
    authed();
    const res = await POST(postReq({ ...validBody, household_id: HOUSEHOLD_UUID }));
    expect(res.status).toBe(400);
  });

  it('400 VALIDATION_ERROR se kind é inválido', async () => {
    authed();
    const res = await POST(postReq({ ...validBody, kind: 'banana' }));
    expect(res.status).toBe(400);
  });

  it('404 NOT_FOUND se account_id cross-household (RLS-scoped SELECT vazio)', async () => {
    authed();
    mocks.dbExecuteMock.mockResolvedValueOnce([]); // verificação account_id
    const res = await POST(postReq(validBody));
    expect(res.status).toBe(404);
  });

  it('201 cria transacção variável', async () => {
    authed();
    mocks.dbExecuteMock
      .mockResolvedValueOnce([{ id: ACCOUNT_UUID }]) // account_id existe
      .mockResolvedValueOnce([
        { id: 'new-tx', kind: 'expense', amount_cents: 7870, transaction_date: '2026-05-21' },
      ]) // INSERT
      .mockResolvedValueOnce([]); // audit
    const res = await POST(postReq(validBody));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.transaction.id).toBe('new-tx');
  });

  // SEC-1-F1 — IDOR de escrita: a sub-query de validação de FK do account_id tem
  // de filtrar pelo household autenticado (RLS inerte em runtime). Prova que um
  // account_id de OUTRO household não pode ser referenciado: a query carrega o
  // household_id autenticado como parâmetro bound (WHERE ... and household_id = ...).
  it('SEC-1-F1: validação de account_id no POST é filtrada pelo household autenticado', async () => {
    authed();
    mocks.dbExecuteMock.mockResolvedValueOnce([]); // FK-check cross-household → 0 rows
    const res = await POST(postReq(validBody));
    expect(res.status).toBe(404); // account_id de outro household não encontrado

    const fkCheck = mocks.dbExecuteMock.mock.calls[0]?.[0];
    expect(fkCheck).toBeDefined();
    // O id do recurso E o household autenticado estão bound — sem o segundo, a
    // query seria um probe-oracle cross-tenant + permitiria FK cross-household.
    const params = boundParamValues(fkCheck);
    expect(params).toContain(ACCOUNT_UUID);
    expect(params).toContain(HOUSEHOLD_UUID);
  });

  // SEC-1-F1 — a sub-query de validação de category_id tem de carregar o
  // household autenticado (com a excepção `OR household_id IS NULL` para globais).
  it('SEC-1-F1: validação de category_id no POST carrega o household autenticado', async () => {
    authed();
    mocks.dbExecuteMock
      .mockResolvedValueOnce([{ id: ACCOUNT_UUID }]) // account_id existe
      .mockResolvedValueOnce([]); // category_id cross-household → 0 rows
    const res = await POST(postReq({ ...validBody, category_id: CATEGORY_UUID }));
    expect(res.status).toBe(404); // category_id de outro household não encontrada

    const catCheck = mocks.dbExecuteMock.mock.calls[1]?.[0];
    expect(catCheck).toBeDefined();
    const params = boundParamValues(catCheck);
    expect(params).toContain(CATEGORY_UUID);
    expect(params).toContain(HOUSEHOLD_UUID);
  });
});
