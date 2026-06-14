/**
 * Tool `create_finance_recurrence` — regista uma finança recorrente
 * (renda, salário, subscrição, etc.).
 *
 * Domínio: `finance`.
 *
 * Scope (Story 4.10 AC2):
 *   - `amountCents` inteiro positivo
 *   - `kind` = `'expense'` | `'income'` (sem `'transfer'` — DP-4.10.C)
 *   - `description` NOT NULL (schema `recurrences.description text not null` — PO_FIX_INLINE F2)
 *   - `frequency` subset MVP: `'monthly'` | `'weekly'` | `'yearly'` (schema enum tem 7 — restantes diferidos Fase 2)
 *   - `startsOn` ISO YYYY-MM-DD (schema NOT NULL — F2)
 *   - `accountId`/`cardId` AMBOS opcionais (Story 2.13 AC3 — refine relaxado):
 *       quando nenhum é fornecido, `resolveDefaultAccount` resolve a conta
 *       "Dinheiro" default do household dentro de `execute()`.
 *   - `categoryId` opcional → fallback por kind (F6)
 *   - `paymentMethod` opcional → inferido (DP-2.13.A): cardId → 'card';
 *       conta default tipo 'dinheiro' → 'cash'; outros → 'transfer'
 *
 * `next_run_on` é populado igual a `startsOn` — cron Inngest (Story 4.5)
 * materializa a primeira transacção nessa data.
 *
 * Trace: Story 4.10 AC2 + PRD FR14 + Architecture §3.1 + Epic 4 §5.
 */
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import type { ReverseOpPayload, ToolDefinition, ToolExecutionContext } from '../contracts';
import {
  assertAccountBelongsToHousehold,
  assertCardBelongsToHousehold,
  mapFinanceFkGuardError,
} from './_helpers/assert-ref-belongs-to-household';
import { formatEuroCents } from './_helpers/format-euro-cents';
import { resolveDefaultAccount } from './_helpers/resolve-default-account';
import { resolveDefaultCategory } from './_helpers/resolve-default-category';

const PAYMENT_METHOD_VALUES = [
  'cash',
  'card',
  'transfer',
  'direct_debit',
  'multibanco',
  'mb_way',
  'other',
] as const;

const FREQUENCY_LABELS_PT: Record<'monthly' | 'weekly' | 'yearly', string> = {
  monthly: 'mensal',
  weekly: 'semanal',
  yearly: 'anual',
};

const CreateFinanceRecurrenceInputSchema = z.object({
  amountCents: z.number().int().positive(),
  kind: z.enum(['expense', 'income']),
  description: z.string().min(1).max(500),
  frequency: z.enum(['monthly', 'weekly', 'yearly']),
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'startsOn deve estar no formato YYYY-MM-DD'),
  accountId: z.string().uuid().optional(),
  cardId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  paymentMethod: z.enum(PAYMENT_METHOD_VALUES).optional(),
});
// Story 2.13 AC3: refine `accountId` XOR `cardId` removido. A conta default é
// resolvida em `execute()` via `resolveDefaultAccount` quando ambos ausentes.

export type CreateFinanceRecurrenceInput = z.infer<typeof CreateFinanceRecurrenceInputSchema>;

const CreateFinanceRecurrenceOutputSchema = z.object({
  recurrenceId: z.string().uuid(),
  description: z.string(),
  amountCents: z.number().int(),
  kind: z.enum(['expense', 'income']),
  frequency: z.enum(['monthly', 'weekly', 'yearly']),
  startsOn: z.string(),
  nextRunOn: z.string(),
});

export type CreateFinanceRecurrenceOutput = z.infer<typeof CreateFinanceRecurrenceOutputSchema>;

interface RecurrencesInsertReturn {
  readonly id: string;
  readonly description: string;
  readonly amount_cents: number;
  readonly kind: 'expense' | 'income' | 'transfer';
  readonly frequency:
    | 'daily'
    | 'weekly'
    | 'biweekly'
    | 'monthly'
    | 'quarterly'
    | 'yearly'
    | 'custom';
  readonly starts_on: string;
  readonly next_run_on: string;
}

function formatDateForPreview(date: string): string {
  const [year, month, day] = date.split('-');
  if (!year || !month || !day) return date;
  return `${day}/${month}/${year}`;
}

export const createFinanceRecurrence: ToolDefinition<
  CreateFinanceRecurrenceInput,
  CreateFinanceRecurrenceOutput
> = {
  name: 'create_finance_recurrence',
  domain: 'finance',
  description:
    'Usa esta tool quando o utilizador quer registar uma despesa ou receita recorrente (renda, salário, subscrição). Aceita amountCents, kind (expense/income), description, frequency (monthly/weekly/yearly), startsOn (YYYY-MM-DD — primeira ocorrência), accountId OU cardId, categoryId opcional e paymentMethod opcional.',
  inputSchema: CreateFinanceRecurrenceInputSchema,
  outputSchema: CreateFinanceRecurrenceOutputSchema,
  estimatedTokens: 100,

  preview(input) {
    const valor = formatEuroCents(input.amountCents);
    const freqLabel = FREQUENCY_LABELS_PT[input.frequency];
    return `Registar recorrência '${input.description}' de ${valor} — ${freqLabel} a partir de ${formatDateForPreview(input.startsOn)}`;
  },

  async execute(input, ctx: ToolExecutionContext): Promise<CreateFinanceRecurrenceOutput> {
    const categoryId =
      input.categoryId ??
      (await resolveDefaultCategory({
        db: ctx.db,
        kind: input.kind,
        toolName: 'create_finance_recurrence',
      }));

    // Story 2.13 AC3/AC4: resolver conta default quando NEM accountId NEM
    // cardId vêm do input. Devolve o tipo para inferir paymentMethod (DP-2.13.A).
    //
    // Hardening cross-tenant (1.ª rede app-enforced, SEC-1): accountId/cardId
    // EXPLÍCITO → PRÉ-CHECK RLS-scoped de pertença ao household ANTES do INSERT.
    let accountId = input.accountId;
    let resolvedAccountType: string | undefined;
    if (input.accountId === undefined && input.cardId === undefined) {
      const resolved = await resolveDefaultAccount({
        db: ctx.db,
        toolName: 'create_finance_recurrence',
      });
      accountId = resolved.accountId;
      resolvedAccountType = resolved.accountType;
    } else {
      if (input.accountId !== undefined) {
        await assertAccountBelongsToHousehold({
          db: ctx.db,
          accountId: input.accountId,
          toolName: 'create_finance_recurrence',
        });
      }
      if (input.cardId !== undefined) {
        await assertCardBelongsToHousehold({
          db: ctx.db,
          cardId: input.cardId,
          toolName: 'create_finance_recurrence',
        });
      }
    }

    const paymentMethod =
      input.paymentMethod ??
      (input.cardId !== undefined
        ? 'card'
        : resolvedAccountType === 'dinheiro'
          ? 'cash'
          : 'transfer');

    // REDE FINAL (2.ª rede): mapear o trigger DB (SQLSTATE 23P51, migration
    // 0023) para ToolExecutionError PT-PT em caso de race condition.
    let result: ReadonlyArray<RecurrencesInsertReturn>;
    try {
      result = (await ctx.db.execute(sql`
        insert into recurrences
          (household_id, created_by_user_id, description, kind, amount_cents,
           account_id, card_id, category_id, payment_method, frequency,
           starts_on, next_run_on, active)
        values
          (
            ${ctx.householdId},
            ${ctx.userId},
            ${input.description},
            ${input.kind}::transaction_kind,
            ${input.amountCents},
            ${accountId ?? null}::uuid,
            ${input.cardId ?? null}::uuid,
            ${categoryId}::uuid,
            ${paymentMethod}::payment_method_finance,
            ${input.frequency}::recurrence_freq_finance,
            ${input.startsOn}::date,
            ${input.startsOn}::date,
            true
          )
        returning id, description, amount_cents, kind, frequency, starts_on, next_run_on
      `)) as ReadonlyArray<RecurrencesInsertReturn>;
    } catch (err) {
      throw mapFinanceFkGuardError('create_finance_recurrence', err);
    }

    const row = result[0];
    if (!row) {
      throw new Error('INSERT em recurrences não devolveu row');
    }

    // O schema permite kind=transfer; o input nunca o introduz (DP-4.10.C),
    // mas defensivamente normalizamos.
    const kindOut: 'expense' | 'income' = row.kind === 'income' ? 'income' : 'expense';
    const freqOut: 'monthly' | 'weekly' | 'yearly' =
      row.frequency === 'monthly' || row.frequency === 'weekly' || row.frequency === 'yearly'
        ? row.frequency
        : 'monthly';

    return {
      recurrenceId: row.id,
      description: row.description,
      amountCents: row.amount_cents,
      kind: kindOut,
      frequency: freqOut,
      startsOn: row.starts_on,
      nextRunOn: row.next_run_on,
    };
  },

  async reverse(output): Promise<ReverseOpPayload> {
    return {
      kind: 'delete_row',
      table: 'recurrences',
      id: output.recurrenceId,
    };
  },
};
