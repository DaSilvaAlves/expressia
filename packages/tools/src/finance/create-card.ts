/**
 * Tool `create_card` — adiciona um cartão de crédito/débito ao agregado.
 *
 * Domínio: `finance`.
 *
 * Scope (Story 4.10 AC3 — major rewrite após PO_FIX_INLINE F3):
 *   - `name` 1..200 chars
 *   - `accountId` UUID NOT NULL — schema `cards.account_id references accounts.id ON DELETE restrict` (linha 131-133 finance.ts)
 *   - `cardType` enum literal EN `'credit'` | `'debit'` (schema linha 48 — F3 corrigiu PT→EN)
 *   - `closingDay` 1..28 (CHECK `cards_closing_day_range`)
 *   - `dueDay` 1..28
 *   - `last4` regex /^[0-9]{4}$/
 *   - `creditLimitCents` (NÃO `limitCents`)
 *   - Crédito EXIGE closingDay + dueDay + creditLimitCents (CHECK `cards_credit_needs_limit`)
 *
 * `brand` e `bankName` NÃO existem em `cards` (PO verificado contra schema). A
 * tool NÃO cria contas (FUP-4.9.A — `create_account` fora de scope).
 *
 * Trace: Story 4.10 AC3 + PRD FR15 + Architecture §3.1 + Epic 4 §5.
 */
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import type {
  ReverseOpPayload,
  ToolDefinition,
  ToolExecutionContext,
} from '../contracts';
import { formatEuroCents } from './_helpers/format-euro-cents';

const CreateCardInputSchema = z
  .object({
    name: z.string().min(1).max(200),
    accountId: z.string().uuid(),
    cardType: z.enum(['credit', 'debit']),
    closingDay: z.number().int().min(1).max(28).optional(),
    dueDay: z.number().int().min(1).max(28).optional(),
    last4: z
      .string()
      .regex(/^[0-9]{4}$/, 'last4 deve ter exactamente 4 dígitos')
      .optional(),
    creditLimitCents: z.number().int().nonnegative().optional(),
  })
  .refine(
    (d) => {
      if (d.cardType === 'credit') {
        return (
          d.closingDay !== undefined &&
          d.dueDay !== undefined &&
          d.creditLimitCents !== undefined
        );
      }
      return true;
    },
    {
      message:
        'Cartão de crédito requer closingDay, dueDay (1..28) e creditLimitCents (CHECK cards_credit_needs_limit)',
    },
  );

export type CreateCardInput = z.infer<typeof CreateCardInputSchema>;

const CreateCardOutputSchema = z.object({
  cardId: z.string().uuid(),
  name: z.string(),
  accountId: z.string().uuid(),
  cardType: z.enum(['credit', 'debit']),
  closingDay: z.number().nullable(),
  dueDay: z.number().nullable(),
  last4: z.string().nullable(),
  creditLimitCents: z.number().nullable(),
});

export type CreateCardOutput = z.infer<typeof CreateCardOutputSchema>;

interface CardsInsertReturn {
  readonly id: string;
  readonly name: string;
  readonly account_id: string;
  readonly card_type: 'credit' | 'debit';
  readonly closing_day: number | null;
  readonly due_day: number | null;
  readonly last4: string | null;
  readonly credit_limit_cents: number | null;
}

export const createCard: ToolDefinition<CreateCardInput, CreateCardOutput> = {
  name: 'create_card',
  domain: 'finance',
  description:
    'Usa esta tool quando o utilizador quer adicionar um cartão de crédito ou débito ao agregado. Aceita name, accountId (conta associada — obrigatória), cardType (credit/debit), e para crédito também closingDay (1..28), dueDay (1..28) e creditLimitCents. Aceita last4 opcional.',
  inputSchema: CreateCardInputSchema,
  outputSchema: CreateCardOutputSchema,
  estimatedTokens: 70,

  preview(input) {
    if (input.cardType === 'credit') {
      const limite =
        input.creditLimitCents !== undefined
          ? formatEuroCents(input.creditLimitCents)
          : '(sem limite definido)';
      return `Adicionar cartão '${input.name}' (Crédito, fecho dia ${String(input.closingDay)}, vencimento dia ${String(input.dueDay)}, limite ${limite})`;
    }
    return `Adicionar cartão '${input.name}' (Débito)`;
  },

  async execute(input, ctx: ToolExecutionContext): Promise<CreateCardOutput> {
    const result = (await ctx.db.execute(sql`
      insert into cards
        (household_id, account_id, name, card_type, closing_day, due_day, last4, credit_limit_cents)
      values
        (
          ${ctx.householdId},
          ${input.accountId}::uuid,
          ${input.name},
          ${input.cardType}::card_type,
          ${input.closingDay ?? null},
          ${input.dueDay ?? null},
          ${input.last4 ?? null},
          ${input.creditLimitCents ?? null}
        )
      returning id, name, account_id, card_type, closing_day, due_day, last4, credit_limit_cents
    `)) as ReadonlyArray<CardsInsertReturn>;

    const row = result[0];
    if (!row) {
      throw new Error('INSERT em cards não devolveu row');
    }

    return {
      cardId: row.id,
      name: row.name,
      accountId: row.account_id,
      cardType: row.card_type,
      closingDay: row.closing_day,
      dueDay: row.due_day,
      last4: row.last4,
      creditLimitCents: row.credit_limit_cents,
    };
  },

  async reverse(output): Promise<ReverseOpPayload> {
    return {
      kind: 'delete_row',
      table: 'cards',
      id: output.cardId,
    };
  },
};
