// @vitest-environment node
/**
 * Testes unitários do wrapper `withHousehold` (SEC-2 / ADR-003 Fase 1, AC-A1 a A5).
 *
 * Não tocam num Postgres real (o teste de APLICAÇÃO real vive em
 * `@meu-jarvis/db-test/src/tests/rls-application.test.ts`, com Testcontainers).
 * Aqui mockamos o módulo `postgres` para capturar a sequência de comandos emitidos
 * dentro da transação e provar:
 *   - assinatura pública correcta;
 *   - `SET LOCAL ROLE authenticated` é emitido (nunca `SET` simples);
 *   - claims parametrizados com `sub` + `household_id` + `role`;
 *   - valor do callback propagado;
 *   - erro no callback rejeita (rollback implícito).
 *
 * Trace: SEC-2 AC-A1, AC-A2, AC-A3, AC-A4, AC-A5.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Comandos capturados dentro da transação simulada. */
const captured: { sql: string; params: unknown[] }[] = [];

/**
 * `pgTx` simulado — regista cada chamada (`unsafe` e tagged template) e devolve `[]`.
 * Suficiente para o `withHousehold` correr a sequência completa sem DB real.
 */
function makeFakeTx() {
  const tagged = (strings: TemplateStringsArray, ...params: unknown[]) => {
    captured.push({ sql: strings.join('?'), params });
    return Promise.resolve([] as unknown[]);
  };
  // `unsafe` é uma propriedade da função tagged em postgres-js.
  (tagged as unknown as { unsafe: (q: string) => Promise<unknown[]> }).unsafe = (q: string) => {
    captured.push({ sql: q, params: [] });
    return Promise.resolve([] as unknown[]);
  };
  return tagged;
}

/** Mock do módulo `postgres`: a pool tem `begin(cb)` que corre `cb(fakeTx)`. */
vi.mock('postgres', () => {
  const fakeTx = makeFakeTx();
  const sqlFn = () => ({
    begin: (cb: (tx: typeof fakeTx) => Promise<unknown>) => cb(fakeTx),
  });
  return { default: sqlFn };
});

/** Mock do Drizzle: `drizzle(tx)` devolve um objecto sentinela identificável. */
const DRIZZLE_SENTINEL = { __drizzle: true } as const;
vi.mock('drizzle-orm/postgres-js', () => ({
  drizzle: () => DRIZZLE_SENTINEL,
}));

describe('withHousehold (SEC-2 / ADR-003 Fase 1)', () => {
  beforeEach(() => {
    captured.length = 0;
    process.env.DATABASE_URL = 'postgres://stub';
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.DATABASE_URL;
  });

  it('AC-A1: exporta withHousehold e propaga o valor do callback', async () => {
    const { withHousehold } = await import('@/client');
    expect(typeof withHousehold).toBe('function');

    const result = await withHousehold(
      { userId: 'u-1', householdId: 'h-1' },
      async (tx) => {
        expect(tx).toBe(DRIZZLE_SENTINEL);
        return 42;
      },
    );
    expect(result).toBe(42);
  });

  it('AC-A2/A3: emite SET LOCAL ROLE authenticated e claims parametrizados (nunca SET simples)', async () => {
    const { withHousehold } = await import('@/client');
    await withHousehold({ userId: 'u-abc', householdId: 'h-xyz' }, async () => 'ok');

    const allSql = captured.map((c) => c.sql.toLowerCase());

    // SET LOCAL ROLE authenticated presente.
    expect(allSql.some((s) => s.includes('set local role authenticated'))).toBe(true);

    // Nunca `SET` sem `LOCAL` (anti-leak cross-request) — AC-A3 bloqueante.
    const hasBareSet = captured.some((c) => /\bset\b(?!\s+local)/i.test(c.sql));
    expect(hasBareSet).toBe(false);

    // request.jwt.claims via set_config parametrizado.
    const claimsCall = captured.find((c) => c.sql.includes('request.jwt.claims'));
    expect(claimsCall).toBeDefined();
    const claimsJson = claimsCall?.params[0] as string;
    const parsed = JSON.parse(claimsJson) as Record<string, string>;
    expect(parsed).toEqual({ sub: 'u-abc', household_id: 'h-xyz', role: 'authenticated' });

    // app.current_household_id GUC (defense-in-depth) parametrizado com o householdId.
    const gucCall = captured.find((c) => c.sql.includes('app.current_household_id'));
    expect(gucCall).toBeDefined();
    expect(gucCall?.params[0]).toBe('h-xyz');
  });

  it('AC-A4: erro no callback rejeita (rollback implícito)', async () => {
    const { withHousehold } = await import('@/client');
    await expect(
      withHousehold({ userId: 'u-1', householdId: 'h-1' }, async () => {
        throw new Error('falha no callback');
      }),
    ).rejects.toThrow('falha no callback');
  });

  it('AC-A5: getDb e getServiceDb continuam exportados', async () => {
    const mod = await import('@/client');
    expect(typeof mod.getDb).toBe('function');
    expect(typeof mod.getServiceDb).toBe('function');
    expect(typeof mod.setHouseholdContext).toBe('function');
  });
});
