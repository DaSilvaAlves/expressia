// @vitest-environment node
/**
 * Testes unitários do wrapper `withHousehold` (SEC-2 / ADR-003 Fase 1, AC-A1 a A5).
 *
 * Não tocam num Postgres real (o teste de APLICAÇÃO real vive em
 * `@meu-jarvis/db-test/src/tests/rls-application.test.ts` + `executeAtomic.rls.test.ts`,
 * com Testcontainers — esse último exercita o `withHousehold` REAL de produção).
 * Aqui mockamos o cliente Drizzle para capturar a sequência de comandos emitidos
 * dentro da transação e provar:
 *   - assinatura pública correcta;
 *   - `SET LOCAL ROLE authenticated` é emitido (nunca `SET` simples);
 *   - claims parametrizados com `sub` + `household_id` + `role`;
 *   - valor do callback propagado;
 *   - erro no callback rejeita (rollback implícito).
 *
 * REGRESSÃO SEC-8.1 (2026-06-10): a mecânica mudou de `pgSql.begin()` +
 * `drizzle(pgTx)` (cliente Drizzle PARTIDO em runtime — `TypeError ...parsers`)
 * para `db.transaction()` do Drizzle. Este teste reflecte a nova mecânica:
 * capturamos os `tx.execute(sql\`…\`)` dentro de `db.transaction()`.
 *
 * Trace: SEC-2 AC-A1..A5; SEC-8.1 (regressão withHousehold).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Comandos capturados dentro da transação simulada. Cada `tx.execute(sql\`…\`)`
 * recebe um objecto Drizzle SQL — extraímos o texto (`queryChunks`) e os params.
 */
const captured: { sql: string; params: unknown[] }[] = [];

/**
 * Extrai um texto pesquisável + os params de um objecto `SQL` do drizzle-orm.
 * O `sql` template do drizzle guarda `queryChunks` (alternância de
 * `StringChunk` e `Param`). Não reconstruímos SQL exacto — basta texto + params
 * para as asserções (presença de `set local role`, ausência de `set` simples,
 * shape dos claims).
 */
function describeSql(query: unknown): { sql: string; params: unknown[] } {
  const chunks = (query as { queryChunks?: unknown[] }).queryChunks ?? [];
  const textParts: string[] = [];
  const params: unknown[] = [];
  for (const chunk of chunks) {
    if (chunk == null) continue;
    // StringChunk: { value: string[] } — texto SQL estático.
    const value = (chunk as { value?: unknown }).value;
    if (Array.isArray(value) && value.every((v) => typeof v === 'string')) {
      textParts.push((value as string[]).join(''));
      continue;
    }
    // Param bound — em drizzle-orm/postgres-js o valor interpolado vem como um
    // wrapper primitivo (ex: `String`/`Number` object). Normalizamos via valueOf.
    if (chunk instanceof String) {
      params.push(chunk.valueOf());
      continue;
    }
    if (chunk instanceof Number) {
      params.push(chunk.valueOf());
      continue;
    }
    if (typeof chunk === 'string') {
      params.push(chunk);
      continue;
    }
    // Fallback: objecto Param do drizzle com `.value`.
    if (chunk && typeof chunk === 'object' && 'value' in (chunk as object)) {
      params.push((chunk as { value: unknown }).value);
    }
  }
  return { sql: textParts.join('?'), params };
}

/**
 * `tx` simulado — `execute(query)` regista a query e devolve `[]`.
 */
function makeFakeTx() {
  return {
    execute: (query: unknown) => {
      captured.push(describeSql(query));
      return Promise.resolve([] as unknown[]);
    },
  };
}

/** `drizzle()` devolve um cliente cujo `transaction(fn)` corre `fn(fakeTx)`. */
vi.mock('drizzle-orm/postgres-js', () => ({
  drizzle: () => ({
    transaction: (fn: (tx: ReturnType<typeof makeFakeTx>) => Promise<unknown>) =>
      fn(makeFakeTx()),
  }),
}));

/** Mock do módulo `postgres`: a pool é um stub (não usada pelo Drizzle mockado). */
vi.mock('postgres', () => {
  const sqlFn = () => ({});
  return { default: sqlFn };
});

describe('withHousehold (SEC-2 / ADR-003 Fase 1 · regressão SEC-8.1)', () => {
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
        // O `tx` é o transaction client do Drizzle (mockado) — tem `execute`.
        expect(typeof (tx as unknown as { execute: unknown }).execute).toBe('function');
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
