// @vitest-environment node
/**
 * Testes unitários para `GET / PATCH /api/conta/preferencias` — Story 2.7.
 *
 * Estratégia: mockable-only. Mock pattern via `vi.hoisted()` + `vi.mock()`
 * (precedente Story 2.6). Sem real DB.
 *
 * Cobertura:
 *   - GET 401 quando user null
 *   - GET 404 quando user sem household
 *   - GET lazy-init UPSERT idempotente + retorna { always_preview }
 *   - GET 500 quando DB falha
 *   - PATCH 401 sem auth
 *   - PATCH 400 body inválido (Zod)
 *   - PATCH 400 body sem campo
 *   - PATCH golden path (UPSERT + retorna actualizado)
 *   - PATCH idempotência (segundo PATCH com mesmo valor)
 *   - PATCH 500 em DB error
 *   - RLS isolation: query usa getDb (RLS via JWT) — verificado por design
 *
 * Trace: Story 2.7 AC4/AC5/AC11 + DN1-mockable-only.
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
  // SEC-7 — `preferencias/route.ts` migrou de `getDb()` para `withHousehold`.
  // O mock invoca o callback com o fake db; o `dbExecuteMock` partilhado mantém
  // a contagem de calls (lazy-init UPSERT + SELECT / UPSERT parcial) intacta.
  withHousehold: (_auth: unknown, fn: (tx: { execute: typeof mocks.dbExecuteMock }) => unknown) =>
    fn({ execute: mocks.dbExecuteMock }),
}));

import { GET, PATCH } from '@/app/api/conta/preferencias/route';

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const TEST_HOUSEHOLD_ID = '00000000-0000-0000-0000-0000000000a1';

function setupAuth(authenticated: boolean = true): void {
  if (authenticated) {
    mocks.getUserMock.mockResolvedValue({
      data: { user: { id: TEST_USER_ID, email: 'tester@expressia.pt' } },
      error: null,
    });
  } else {
    mocks.getUserMock.mockResolvedValue({ data: { user: null }, error: null });
  }

  mocks.fromMock.mockReturnValue({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: { household_id: TEST_HOUSEHOLD_ID },
      error: null,
    }),
  });
}

function makePatch(body: unknown): Request {
  return new Request('http://localhost/api/conta/preferencias', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setupAuth();
});

describe('GET /api/conta/preferencias', () => {
  it('AC4 — 401 quando user é null', async () => {
    setupAuth(false);
    const res = await GET();
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('AUTH_REQUIRED');
  });

  it('AC4 — 404 quando user sem household', async () => {
    mocks.fromMock.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    });
    const res = await GET();
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('HOUSEHOLD_NOT_FOUND');
  });

  it('AC4 + D32 — lazy-init UPSERT + retorna always_preview=false default', async () => {
    let call = 0;
    mocks.dbExecuteMock.mockImplementation(async () => {
      call++;
      if (call === 1) return []; // INSERT ON CONFLICT
      if (call === 2) return [{ always_preview: false }]; // SELECT
      return [];
    });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { always_preview: boolean };
    expect(body.always_preview).toBe(false);
    // Verifica 2 calls: INSERT … ON CONFLICT + SELECT
    expect(mocks.dbExecuteMock).toHaveBeenCalledTimes(2);
  });

  it('AC4 + D32 — retorna always_preview=true quando user já tem row activa', async () => {
    let call = 0;
    mocks.dbExecuteMock.mockImplementation(async () => {
      call++;
      if (call === 1) return []; // INSERT no-op (ON CONFLICT)
      if (call === 2) return [{ always_preview: true }];
      return [];
    });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { always_preview: boolean };
    expect(body.always_preview).toBe(true);
  });

  it('AC4 — race condition lazy-init: SELECT sem rows trata como false', async () => {
    let call = 0;
    mocks.dbExecuteMock.mockImplementation(async () => {
      call++;
      if (call === 1) return [];
      if (call === 2) return []; // SELECT vazio (race)
      return [];
    });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { always_preview: boolean };
    expect(body.always_preview).toBe(false);
  });

  it('AC4 — 500 quando DB falha', async () => {
    mocks.dbExecuteMock.mockRejectedValue(new Error('DB connection refused'));
    const res = await GET();
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });
});

describe('PATCH /api/conta/preferencias', () => {
  beforeEach(() => {
    mocks.dbExecuteMock.mockResolvedValue([]);
  });

  it('AC5 — 401 sem sessão', async () => {
    setupAuth(false);
    const res = await PATCH(makePatch({ always_preview: true }) as never);
    expect(res.status).toBe(401);
  });

  it('AC5 — 404 sem household', async () => {
    mocks.fromMock.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    });
    const res = await PATCH(makePatch({ always_preview: true }) as never);
    expect(res.status).toBe(404);
  });

  it('AC5 — 400 quando body sem campo always_preview', async () => {
    const res = await PATCH(makePatch({ foo: 'bar' }) as never);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('AC5 — 400 quando always_preview não é boolean', async () => {
    const res = await PATCH(makePatch({ always_preview: 'sim' }) as never);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('AC5 — 400 quando body é JSON malformado', async () => {
    const req = new Request('http://localhost/api/conta/preferencias', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: '{invalid',
    });
    const res = await PATCH(req as never);
    expect(res.status).toBe(400);
  });

  it('AC5 — golden path UPSERT always_preview=true + retorna actualizado', async () => {
    const res = await PATCH(makePatch({ always_preview: true }) as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { always_preview: boolean };
    expect(body.always_preview).toBe(true);
    // 1 call para o UPSERT.
    expect(mocks.dbExecuteMock).toHaveBeenCalledTimes(1);
  });

  it('AC5 — golden path UPSERT always_preview=false (revert)', async () => {
    const res = await PATCH(makePatch({ always_preview: false }) as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { always_preview: boolean };
    expect(body.always_preview).toBe(false);
  });

  it('AC5 — 500 em DB error', async () => {
    mocks.dbExecuteMock.mockRejectedValueOnce(new Error('DB connection refused'));
    const res = await PATCH(makePatch({ always_preview: true }) as never);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });

  it('AC5 — idempotência: 2 PATCHes consecutivos com mesmo valor', async () => {
    const r1 = await PATCH(makePatch({ always_preview: true }) as never);
    const r2 = await PATCH(makePatch({ always_preview: true }) as never);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
  });

  it('AC11 / SEC-7 — RLS isolation by design: usa withHousehold (2.ª rede, role authenticated), não getServiceDb()', async () => {
    // SEC-7: o handler migrou para `withHousehold`, que abre uma transação com
    // `SET LOCAL ROLE authenticated` + JWT claims (2.ª rede RLS). Test indirecto:
    // o mock do db-shim só expõe `withHousehold` (não há `getServiceDb`). O facto
    // de o execute ser chamado prova que o callback de domínio correu dentro do
    // wrapper RLS-aware.
    await PATCH(makePatch({ always_preview: true }) as never);
    expect(mocks.dbExecuteMock).toHaveBeenCalled();
    // RLS via JWT é garantido pelo Supabase Auth Hook (migration 0002) +
    // role authenticated do `withHousehold` (packages/db/src/client.ts).
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Story 5.7 — widgets_enabled (AC1)
// ───────────────────────────────────────────────────────────────────────────

const VALID_WIDGETS = {
  briefing: true,
  tasks_today: true,
  finance_month: true,
  recurrences_next: true,
  tasks_overdue: false,
  accounts_balance: true,
  calendar_week: false,
};

describe('Story 5.7 — GET devolve widgets_enabled (AC1.b)', () => {
  it('retorna widgets_enabled válido lido da DB', async () => {
    let call = 0;
    mocks.dbExecuteMock.mockImplementation(async () => {
      call++;
      if (call === 1) return []; // INSERT ON CONFLICT
      if (call === 2) return [{ always_preview: true, widgets_enabled: VALID_WIDGETS }];
      return [];
    });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      always_preview: boolean;
      widgets_enabled: Record<string, boolean>;
    };
    expect(body.always_preview).toBe(true);
    expect(body.widgets_enabled).toEqual(VALID_WIDGETS);
  });

  it('fallback para DEFAULT_WIDGETS_ENABLED quando o JSONB é inválido', async () => {
    let call = 0;
    mocks.dbExecuteMock.mockImplementation(async () => {
      call++;
      if (call === 1) return [];
      if (call === 2) return [{ always_preview: false, widgets_enabled: { bad: 'shape' } }];
      return [];
    });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { widgets_enabled: Record<string, boolean> };
    // 5 ON / 2 OFF default (prefs.ts:69).
    expect(body.widgets_enabled).toEqual({
      briefing: true,
      tasks_today: true,
      finance_month: true,
      recurrences_next: true,
      tasks_overdue: true,
      accounts_balance: false,
      calendar_week: false,
    });
  });
});

describe('Story 5.7 — PATCH widgets_enabled (AC1.a)', () => {
  beforeEach(() => {
    mocks.dbExecuteMock.mockResolvedValue([]);
  });

  it('golden path — PATCH widgets_enabled válido → 200 + 1 call DB', async () => {
    const res = await PATCH(makePatch({ widgets_enabled: VALID_WIDGETS }) as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { widgets_enabled: Record<string, boolean> };
    expect(body.widgets_enabled).toEqual(VALID_WIDGETS);
    // UPSERT parcial = 1 statement (sem SELECT extra — retrocompat Story 2.7).
    expect(mocks.dbExecuteMock).toHaveBeenCalledTimes(1);
  });

  it('400 quando widgets_enabled tem chave a menos (strict + 7 obrigatórias)', async () => {
    const res = await PATCH(makePatch({ widgets_enabled: { briefing: true } }) as never);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('400 quando widgets_enabled tem chave desconhecida (.strict())', async () => {
    const res = await PATCH(
      makePatch({ widgets_enabled: { ...VALID_WIDGETS, ghost: true } }) as never,
    );
    expect(res.status).toBe(400);
  });

  it('400 quando body é vazio (nenhum campo)', async () => {
    const res = await PATCH(makePatch({}) as never);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('PATCH só widgets_enabled NÃO devolve always_preview (UPSERT parcial)', async () => {
    const res = await PATCH(makePatch({ widgets_enabled: VALID_WIDGETS }) as never);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty('always_preview');
    expect(body).toHaveProperty('widgets_enabled');
  });

  it('legacy — PATCH só always_preview continua a funcionar (retrocompat 2.7)', async () => {
    const res = await PATCH(makePatch({ always_preview: true }) as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { always_preview: boolean };
    expect(body.always_preview).toBe(true);
    expect(mocks.dbExecuteMock).toHaveBeenCalledTimes(1);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Story 5.8 — theme (AC4)
// ───────────────────────────────────────────────────────────────────────────

describe('Story 5.8 — GET devolve theme (AC4)', () => {
  it('retorna theme válido lido da DB', async () => {
    let call = 0;
    mocks.dbExecuteMock.mockImplementation(async () => {
      call++;
      if (call === 1) return []; // INSERT ON CONFLICT
      if (call === 2)
        return [{ always_preview: false, widgets_enabled: VALID_WIDGETS, theme: 'dark' }];
      return [];
    });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { theme: string };
    expect(body.theme).toBe('dark');
  });

  it('fallback para "system" quando theme na DB é inválido', async () => {
    let call = 0;
    mocks.dbExecuteMock.mockImplementation(async () => {
      call++;
      if (call === 1) return [];
      if (call === 2)
        return [{ always_preview: false, widgets_enabled: VALID_WIDGETS, theme: 'rainbow' }];
      return [];
    });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { theme: string };
    expect(body.theme).toBe('system');
  });

  it('fallback para "system" quando theme é null (row recém-criada)', async () => {
    let call = 0;
    mocks.dbExecuteMock.mockImplementation(async () => {
      call++;
      if (call === 1) return [];
      if (call === 2)
        return [{ always_preview: false, widgets_enabled: VALID_WIDGETS, theme: null }];
      return [];
    });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { theme: string };
    expect(body.theme).toBe('system');
  });

  it('resposta inclui sempre os 3 campos (always_preview + widgets_enabled + theme)', async () => {
    let call = 0;
    mocks.dbExecuteMock.mockImplementation(async () => {
      call++;
      if (call === 1) return [];
      if (call === 2)
        return [{ always_preview: true, widgets_enabled: VALID_WIDGETS, theme: 'light' }];
      return [];
    });
    const res = await GET();
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty('always_preview');
    expect(body).toHaveProperty('widgets_enabled');
    expect(body).toHaveProperty('theme', 'light');
  });
});

describe('Story 5.8 — PATCH theme (AC4.c)', () => {
  beforeEach(() => {
    mocks.dbExecuteMock.mockResolvedValue([]);
  });

  it('golden path — PATCH { theme: "dark" } → 200 + 1 call DB', async () => {
    const res = await PATCH(makePatch({ theme: 'dark' }) as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { theme: string };
    expect(body.theme).toBe('dark');
    expect(mocks.dbExecuteMock).toHaveBeenCalledTimes(1);
  });

  it('400 quando theme é um valor inválido (fora do enum)', async () => {
    const res = await PATCH(makePatch({ theme: 'rainbow' }) as never);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('PATCH só theme NÃO devolve always_preview (UPSERT parcial)', async () => {
    const res = await PATCH(makePatch({ theme: 'system' }) as never);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty('always_preview');
    expect(body).toHaveProperty('theme', 'system');
  });
});
