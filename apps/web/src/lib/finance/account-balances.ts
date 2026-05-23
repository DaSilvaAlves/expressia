/**
 * Helper de agregação da vista "Património" — saldo computado on-read
 * agregado por banco/conta (Story 4.9 AC2, D-4.9.1/2/3/4/5/6).
 *
 * `getAccountBalances` é `db`-injectável (padrão D-4.6.7) — testável sem
 * Postgres. Faz exactamente 2 queries fixas (contas não arquivadas; somas de
 * transacções por conta e kind) e faz o agrupamento por banco em JS — SEM
 * N+1 independentemente do número de contas (D-4.9.4). O household scoping é
 * feito pela RLS (`getDb()` authenticated, R-4.9.4).
 *
 * Saldo por conta = `initial_balance_cents + SUM(income) − SUM(expense)`:
 *   - Base do recompute = `initial_balance_cents` (imutável por D-4.2.A;
 *     `balance_cents` stored é ignorado — D-4.9.1).
 *   - `transfer` excluído (D-4.9.2 — schema modela `account_id` único; sem
 *     par origem/destino, a direcção é indeterminável). Coerente com
 *     D-4.6.5/D-4.8.6/R-4.10 do epic.
 *   - `is_projected = false` (D-4.9.3 — só dinheiro realizado; prestações
 *     futuras materializadas pertencem à vista "Cartões", não ao património).
 *
 * Trace: Story 4.9 AC2, D-4.9.1, D-4.9.2, D-4.9.3, D-4.9.4, D-4.9.5, D-4.9.6;
 * DP1=A (recompute on-read).
 */
import { sql } from 'drizzle-orm';

import type { DbShim } from '@/lib/agent/db-shim';

export type AccountType =
  | 'corrente'
  | 'poupanca'
  | 'credito_consignado'
  | 'investimentos'
  | 'dinheiro'
  | 'outro';

export interface AccountBalance {
  readonly id: string;
  readonly name: string;
  readonly accountType: AccountType;
  readonly bankName: string | null;
  readonly ibanLast4: string | null;
  readonly initialBalanceCents: number;
  /** `SUM(amount_cents) FILTER (kind='income')` para esta conta. */
  readonly incomeCents: number;
  /** `SUM(amount_cents) FILTER (kind='expense')` para esta conta. */
  readonly expenseCents: number;
  /** `initialBalanceCents + incomeCents − expenseCents` — pode ser negativo. */
  readonly balanceCents: number;
}

export interface BankGroupBalance {
  /** `null` → grupo "Sem banco" (D-4.9.6) — renderizado por último. */
  readonly bankName: string | null;
  readonly accounts: readonly AccountBalance[];
  /** Soma dos `balanceCents` das contas do grupo. */
  readonly subtotalCents: number;
}

export interface NetWorth {
  readonly groups: readonly BankGroupBalance[];
  /** Património total — soma dos `subtotalCents` de todos os grupos. */
  readonly totalCents: number;
  /** Número total de contas activas (= sum de `groups[i].accounts.length`). */
  readonly accountCount: number;
}

interface AccountRow {
  id: string;
  name: string;
  account_type: AccountType;
  bank_name: string | null;
  iban_last4: string | null;
  initial_balance_cents: number;
}

interface SumRow {
  account_id: string;
  income_cents: number;
  expense_cents: number;
}

/**
 * Agrega, por household, o saldo computado on-read de cada conta não arquivada,
 * agrupado por banco. 2 queries fixas — sem N+1 (D-4.9.4).
 */
export async function getAccountBalances({
  db,
}: {
  db: DbShim;
}): Promise<NetWorth> {
  const [accountRows, sumRows] = await Promise.all([
    db.execute<AccountRow>(sql`
      select
        id,
        name,
        account_type,
        bank_name,
        iban_last4,
        initial_balance_cents::int as initial_balance_cents
      from public.accounts
      where archived_at is null
    `),
    db.execute<SumRow>(sql`
      select
        account_id,
        coalesce(sum(amount_cents) filter (where kind = 'income'), 0)::int as income_cents,
        coalesce(sum(amount_cents) filter (where kind = 'expense'), 0)::int as expense_cents
      from public.transactions
      where account_id is not null
        and is_projected = false
      group by account_id
    `),
  ]);

  const sumByAccount = new Map(
    sumRows.map((s) => [s.account_id, { income: s.income_cents, expense: s.expense_cents }]),
  );

  const accounts: AccountBalance[] = accountRows.map((r) => {
    const sums = sumByAccount.get(r.id);
    const incomeCents = sums?.income ?? 0;
    const expenseCents = sums?.expense ?? 0;
    return {
      id: r.id,
      name: r.name,
      accountType: r.account_type,
      bankName: r.bank_name,
      ibanLast4: r.iban_last4,
      initialBalanceCents: r.initial_balance_cents,
      incomeCents,
      expenseCents,
      balanceCents: r.initial_balance_cents + incomeCents - expenseCents,
    };
  });

  // Agrupar por banco; `bank_name` NULL → grupo "Sem banco" (D-4.9.6).
  const groupMap = new Map<string | null, AccountBalance[]>();
  for (const acc of accounts) {
    const key = acc.bankName;
    const list = groupMap.get(key) ?? [];
    list.push(acc);
    groupMap.set(key, list);
  }

  // Ordenar bancos por nome PT-PT (case-insensitive); contas dentro de cada
  // grupo também por nome. Grupo `null` (Sem banco) por último (D-4.9.6).
  const bankNames: (string | null)[] = [...groupMap.keys()]
    .filter((b): b is string => b !== null)
    .sort((a, b) => a.localeCompare(b, 'pt-PT', { sensitivity: 'base' }));
  if (groupMap.has(null)) bankNames.push(null);

  const groups: BankGroupBalance[] = bankNames.map((bankName) => {
    const accountsInGroup = (groupMap.get(bankName) ?? []).slice().sort((a, b) =>
      a.name.localeCompare(b.name, 'pt-PT', { sensitivity: 'base' }),
    );
    const subtotalCents = accountsInGroup.reduce((acc, a) => acc + a.balanceCents, 0);
    return { bankName, accounts: accountsInGroup, subtotalCents };
  });

  const totalCents = groups.reduce((acc, g) => acc + g.subtotalCents, 0);
  const accountCount = accounts.length;

  return { groups, totalCents, accountCount };
}
