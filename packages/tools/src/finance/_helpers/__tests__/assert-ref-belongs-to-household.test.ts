/**
 * Testes do hardening cross-tenant de referências EXPLÍCITAS de finanças
 * (FASE A — 1.ª rede app-enforced, SEC-1).
 *
 * Cobre:
 *   - PRÉ-CHECK: `assertAccountBelongsToHousehold` / `assertCardBelongsToHousehold`
 *     lançam `ToolExecutionError` PT-PT quando o SELECT RLS-scoped devolve 0 rows
 *     (conta/cartão de outro household ou inexistente), e passam quando há row.
 *   - REDE FINAL: `mapFinanceFkGuardError` converte SQLSTATE 23P51 → ToolExecutionError
 *     PT-PT (conta vs cartão), e devolve intacto qualquer outro erro.
 *
 * Trace: handoff mj-handoff-smoke-pass-next-account-id-validation-20260614 (Fase A),
 *        migration 0023 (Fase 0 — contrato SQLSTATE 23P51).
 */
import { describe, expect, it, vi } from 'vitest';

import type { DrizzleDbClient } from '../../../contracts';
import {
  assertAccountBelongsToHousehold,
  assertCardBelongsToHousehold,
  FINANCE_FK_GUARD_SQLSTATE,
  mapFinanceFkGuardError,
} from '../assert-ref-belongs-to-household';

function makeDb(rows: ReadonlyArray<unknown>): DrizzleDbClient {
  return {
    transaction: vi.fn() as unknown as DrizzleDbClient['transaction'],
    insert: vi.fn(),
    execute: vi.fn(async () => rows) as unknown as DrizzleDbClient['execute'],
  };
}

const ACCOUNT_ID = '22222222-3333-4444-8555-666666666666';
const CARD_ID = '33333333-4444-4555-8666-777777777777';

// ─────────────────────────────────────────────────────────────────────────────
// PRÉ-CHECK — assertAccountBelongsToHousehold
// ─────────────────────────────────────────────────────────────────────────────

describe('assertAccountBelongsToHousehold', () => {
  it('passa quando a conta existe na vista RLS do household (1 row)', async () => {
    const db = makeDb([{ id: ACCOUNT_ID }]);
    await expect(
      assertAccountBelongsToHousehold({
        db,
        accountId: ACCOUNT_ID,
        toolName: 'create_finance_variable',
      }),
    ).resolves.toBeUndefined();
  });

  it('lança ToolExecutionError PT-PT quando 0 rows (conta de outro household)', async () => {
    const db = makeDb([]);
    try {
      await assertAccountBelongsToHousehold({
        db,
        accountId: ACCOUNT_ID,
        toolName: 'create_finance_variable',
      });
      expect.fail('devia ter lançado ToolExecutionError');
    } catch (err) {
      expect((err as Error).name).toBe('ToolExecutionError');
      const cause = (err as { cause?: unknown }).cause;
      expect(cause).toBeInstanceOf(Error);
      expect((cause as Error).message).toMatch(/conta indicada não existe ou não pertence/i);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PRÉ-CHECK — assertCardBelongsToHousehold
// ─────────────────────────────────────────────────────────────────────────────

describe('assertCardBelongsToHousehold', () => {
  it('passa quando o cartão existe na vista RLS do household (1 row)', async () => {
    const db = makeDb([{ id: CARD_ID }]);
    await expect(
      assertCardBelongsToHousehold({
        db,
        cardId: CARD_ID,
        toolName: 'create_installment',
      }),
    ).resolves.toBeUndefined();
  });

  it('lança ToolExecutionError PT-PT quando 0 rows (cartão de outro household)', async () => {
    const db = makeDb([]);
    try {
      await assertCardBelongsToHousehold({
        db,
        cardId: CARD_ID,
        toolName: 'create_installment',
      });
      expect.fail('devia ter lançado ToolExecutionError');
    } catch (err) {
      expect((err as Error).name).toBe('ToolExecutionError');
      const cause = (err as { cause?: unknown }).cause;
      expect((cause as Error).message).toMatch(/cartão indicado não existe ou não pertence/i);
    }
  });

  it('SELECT é RLS-scoped contra a tabela cards', async () => {
    let captured = '';
    const db: DrizzleDbClient = {
      transaction: vi.fn() as unknown as DrizzleDbClient['transaction'],
      insert: vi.fn(),
      execute: vi.fn(async (q: unknown) => {
        // Walker idêntico ao das suites de tools: extrai apenas as strings
        // estáticas dos queryChunks (os params/Param são ignorados).
        const walk = (n: unknown): void => {
          if (typeof n === 'string') {
            captured += n;
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
            for (const x of v) if (typeof x === 'string') captured += x;
          } else if (typeof v === 'string') {
            captured += v;
          }
        };
        walk(q);
        return [{ id: CARD_ID }];
      }) as unknown as DrizzleDbClient['execute'],
    };
    await assertCardBelongsToHousehold({ db, cardId: CARD_ID, toolName: 'create_card' });
    expect(captured.toLowerCase()).toContain('from cards');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REDE FINAL — mapFinanceFkGuardError (SQLSTATE 23P51)
// ─────────────────────────────────────────────────────────────────────────────

describe('mapFinanceFkGuardError', () => {
  it('o SQLSTATE do contrato é 23P51', () => {
    expect(FINANCE_FK_GUARD_SQLSTATE).toBe('23P51');
  });

  it('mapeia 23P51 (conta) → ToolExecutionError PT-PT de conta', () => {
    const pgErr = Object.assign(
      new Error('A conta indicada não pertence ao agregado familiar (account_id=...).'),
      { code: '23P51' },
    );
    const mapped = mapFinanceFkGuardError('create_finance_variable', pgErr);
    expect((mapped as Error).name).toBe('ToolExecutionError');
    const cause = (mapped as { cause?: unknown }).cause;
    expect((cause as Error).message).toMatch(/conta indicada não pertence ao teu agregado/i);
  });

  it('mapeia 23P51 (cartão) → ToolExecutionError PT-PT de cartão', () => {
    const pgErr = Object.assign(
      new Error('O cartão indicado não pertence ao agregado familiar (card_id=...).'),
      { code: '23P51' },
    );
    const mapped = mapFinanceFkGuardError('create_installment', pgErr);
    expect((mapped as Error).name).toBe('ToolExecutionError');
    const cause = (mapped as { cause?: unknown }).cause;
    expect((cause as Error).message).toMatch(/cartão indicado não pertence ao teu agregado/i);
  });

  it('devolve INTACTO um erro com outro SQLSTATE (não mascara)', () => {
    const other = Object.assign(new Error('deadlock detected'), { code: '40P01' });
    expect(mapFinanceFkGuardError('create_card', other)).toBe(other);
  });

  it('devolve INTACTO um erro sem code (não-Postgres)', () => {
    const plain = new Error('algo inesperado');
    expect(mapFinanceFkGuardError('create_card', plain)).toBe(plain);
  });
});
