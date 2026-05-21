/**
 * Zod schemas — endpoints `/api/financas/cartoes` + `/[id]` (Story 4.2 AC3 + AC6).
 *
 * Convenções (AC8): `.strict()` rejeita campos extra; `household_id` NUNCA em
 * payload (RLS injection via JWT). `account_id` é IMMUTABLE no PATCH — `.strict()`
 * rejeita-o (mudar a conta de um cartão não é suportado no MVP).
 *
 * Refinamento composto (AC6): `card_type='credit'` ⇒ `credit_limit_cents`
 * obrigatório — alinha com o CHECK `cards_credit_needs_limit` (finance.ts:163-166),
 * defesa em profundidade (Zod antes do DB).
 *
 * Enum `card_type` traçável a `finance.ts:48` (`cardTypeEnum`).
 */
import { z } from 'zod';

/** Tipos de cartão — espelha `cardTypeEnum` (`finance.ts:48`). */
export const CARD_TYPES = ['credit', 'debit'] as const;

const CardTypeSchema = z.enum(CARD_TYPES);
const CardNameSchema = z
  .string()
  .min(1, 'Nome obrigatório.')
  .max(120, 'Nome excede 120 caracteres.');
/** Últimos 4 dígitos — alinha com CHECK `cards_last4_format` (finance.ts:150). */
const Last4Schema = z
  .string()
  .regex(/^[0-9]{4}$/, 'Últimos 4 dígitos inválidos — exactamente 4 dígitos.');
/** Dia do mês 1-28 — alinha com CHECK `cards_closing_day_range`/`cards_due_day_range`. */
const DayOfMonthSchema = z
  .number()
  .int('Dia deve ser um inteiro.')
  .min(1, 'Dia deve estar entre 1 e 28.')
  .max(28, 'Dia deve estar entre 1 e 28.');
const CreditLimitSchema = z
  .number()
  .int('Limite de crédito deve ser um inteiro (cêntimos de euro).')
  .nonnegative('Limite de crédito não pode ser negativo.');

/**
 * POST /api/financas/cartoes body.
 *
 * Refinamento (AC6): cartão de crédito requer `credit_limit_cents`.
 */
export const CardCreateSchema = z
  .object({
    account_id: z.string().uuid('account_id inválido — deve ser um UUID.'),
    name: CardNameSchema,
    card_type: CardTypeSchema.default('credit'),
    last4: Last4Schema.optional(),
    closing_day: DayOfMonthSchema.optional(),
    due_day: DayOfMonthSchema.optional(),
    credit_limit_cents: CreditLimitSchema.optional(),
  })
  .strict()
  .refine(
    (data) => data.card_type !== 'credit' || data.credit_limit_cents !== undefined,
    {
      message: 'Cartão de crédito requer limite de crédito.',
      path: ['credit_limit_cents'],
    },
  );

export type CardCreateInput = z.infer<typeof CardCreateSchema>;

/**
 * PATCH /api/financas/cartoes/[id] body — todos os campos opcionais.
 *
 * `household_id` e `account_id` são IMMUTABLE — `.strict()` rejeita-os com 400.
 * Não há refinamento composto: mudar `card_type` para `credit` sem limite é
 * apanhado pelo CHECK `cards_credit_needs_limit` no DB (o handler converte essa
 * violação em 400 VALIDATION_ERROR).
 */
export const CardUpdateSchema = z
  .object({
    name: CardNameSchema.optional(),
    card_type: CardTypeSchema.optional(),
    last4: Last4Schema.optional(),
    closing_day: DayOfMonthSchema.optional(),
    due_day: DayOfMonthSchema.optional(),
    credit_limit_cents: CreditLimitSchema.optional(),
  })
  .strict();

export type CardUpdateInput = z.infer<typeof CardUpdateSchema>;
