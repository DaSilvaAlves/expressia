/**
 * Testes unitários do helper `resolveDefaultAccount` (Story 2.13 AC4 / T2.3).
 *
 * Cobre: SELECT determinístico (filtro `archived_at IS NULL`, ordenação por
 * `dinheiro` primeiro), shape de retorno `{ accountId, accountType }`
 * (PO-FIX-A), e `ToolExecutionError` PT-PT quando não há conta.
 */
import { describe, expect, it, vi } from 'vitest';

import type { DrizzleDbClient } from '../../../contracts';
import { resolveDefaultAccount } from '../resolve-default-account';

function captureSqlText(query: unknown): string {
  let s = '';
  const walk = (n: unknown): void => {
    if (typeof n === 'string') {
      s += n;
      return;
    }
    if (!n || typeof n !== 'object') return;
    const o = n as { queryChunks?: unknown[]; value?: unknown };
    if (Array.isArray(o.queryChunks)) {
      for (const c of o.queryChunks) walk(c);
      return;
    }
    const v = o.value;
    if (Array.isArray(v)) {
      for (const x of v) if (typeof x === 'string') s += x;
    } else if (typeof v === 'string') {
      s += v;
    }
  };
  walk(query);
  return s;
}

function makeDb(rows: ReadonlyArray<unknown>): {
  db: DrizzleDbClient;
  sqlTexts: string[];
} {
  const sqlTexts: string[] = [];
  const db: DrizzleDbClient = {
    transaction: vi.fn() as unknown as DrizzleDbClient['transaction'],
    insert: vi.fn(),
    execute: vi.fn(async (q: unknown) => {
      sqlTexts.push(captureSqlText(q));
      return rows;
    }) as unknown as DrizzleDbClient['execute'],
  };
  return { db, sqlTexts };
}

const DINHEIRO_ID = '11111111-2222-4333-8444-555555555555';

describe('resolveDefaultAccount', () => {
  it('devolve { accountId, accountType } da conta resolvida', async () => {
    const { db } = makeDb([{ id: DINHEIRO_ID, account_type: 'dinheiro' }]);
    const result = await resolveDefaultAccount({ db, toolName: 'create_finance_variable' });
    expect(result).toEqual({ accountId: DINHEIRO_ID, accountType: 'dinheiro' });
  });

  it('SELECT filtra archived_at IS NULL e prioriza dinheiro', async () => {
    const { db, sqlTexts } = makeDb([{ id: DINHEIRO_ID, account_type: 'dinheiro' }]);
    await resolveDefaultAccount({ db, toolName: 'create_card' });
    const sql = sqlTexts[0]?.toLowerCase() ?? '';
    expect(sql).toContain('from accounts');
    expect(sql).toContain('archived_at is null');
    expect(sql).toContain("account_type = 'dinheiro'");
    expect(sql).not.toContain('is_archived');
  });

  it('fallback para conta não-dinheiro (legacy) devolve o tipo correcto', async () => {
    const { db } = makeDb([{ id: DINHEIRO_ID, account_type: 'corrente' }]);
    const result = await resolveDefaultAccount({ db, toolName: 'create_finance_recurrence' });
    expect(result.accountType).toBe('corrente');
  });

  it('lança ToolExecutionError PT-PT quando não há conta', async () => {
    const { db } = makeDb([]);
    try {
      await resolveDefaultAccount({ db, toolName: 'create_finance_variable' });
      expect.fail('devia ter lançado ToolExecutionError');
    } catch (err) {
      expect((err as Error).name).toBe('ToolExecutionError');
      const cause = (err as { cause?: unknown }).cause;
      expect(cause).toBeInstanceOf(Error);
      expect((cause as Error).message).toMatch(/Nenhuma conta encontrada/);
    }
  });
});
