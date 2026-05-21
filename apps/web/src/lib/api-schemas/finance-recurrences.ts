/**
 * Zod schemas — endpoints `/api/financas/recorrencias` + `/[id]` (Story 4.4 AC3 + AC6).
 *
 * Convenções (AC8): `.strict()` rejeita campos extra; `household_id`,
 * `created_by_user_id`, `currency` e `next_run_on` NUNCA em payload —
 * `household_id`/`created_by_user_id` vêm do JWT; `currency` é fixo `'EUR'`;
 * `next_run_on` é inicializado pelo handler (= `starts_on`) e gerido a partir
 * daí pelo cron de Finanças (Story 4.5).
 *
 * DP-4.4.2 — colisão de nomes: `api-schemas/recurrences.ts` (Story 3.2) é
 * Tarefas-scoped (`task_recurrences`, exporta `RecurrenceCreateSchema`/
 * `recurrenceFrequencyValues`). Este ficheiro é distinto e exporta nomes
 * prefixados `FinanceRecurrence*` para não colidir no barrel `index.ts`. O
 * enum de frequência de Finanças é também distinto — inclui `quarterly` e
 * `biweekly`, NÃO inclui `weekdays`/`weekends`.
 *
 * Refinamentos compostos (AC6a + AC6d):
 *   (a) pelo menos um de `account_id`/`card_id` — alinha o CHECK
 *       `recurrences_account_or_card` (`finance.ts:274-277`).
 *   (d) se `frequency='custom'` então `custom_rrule` obrigatório e não-vazio.
 *
 * Enums traçáveis a `packages/db/src/schema/finance.ts`: `recurrenceFreqFinanceEnum`
 * (68), `transactionKindEnum` (52), `paymentMethodFinanceEnum` (58).
 */
import { z } from 'zod';

/** Frequências de recorrência de Finanças — espelha `recurrenceFreqFinanceEnum` (`finance.ts:68`). */
export const FINANCE_RECURRENCE_FREQUENCIES = [
  'daily',
  'weekly',
  'biweekly',
  'monthly',
  'quarterly',
  'yearly',
  'custom',
] as const;

/** Tipos de recorrência — espelha `transactionKindEnum` (`finance.ts:52`). */
export const FINANCE_RECURRENCE_KINDS = ['expense', 'income', 'transfer'] as const;

/** Métodos de pagamento — espelha `paymentMethodFinanceEnum` (`finance.ts:58`). */
export const FINANCE_PAYMENT_METHODS = [
  'cash',
  'card',
  'transfer',
  'direct_debit',
  'multibanco',
  'mb_way',
  'other',
] as const;

const FinanceRecurrenceFrequencySchema = z.enum(FINANCE_RECURRENCE_FREQUENCIES);
const FinanceRecurrenceKindSchema = z.enum(FINANCE_RECURRENCE_KINDS);
const FinancePaymentMethodSchema = z.enum(FINANCE_PAYMENT_METHODS);

const DescriptionSchema = z
  .string()
  .min(1, 'Descrição obrigatória.')
  .max(500, 'Descrição excede 500 caracteres.');

/** Valor em cents — sempre positivo (o sinal lógico vem de `kind`). */
const AmountCentsSchema = z
  .number()
  .int('Valor deve ser um inteiro (cêntimos de euro).')
  .positive('Valor deve ser positivo — o sinal lógico vem de `kind`.');

/** `interval` — alinha o CHECK `recurrences_interval_positive` (`finance.ts:272`). */
const IntervalSchema = z
  .number()
  .int('Intervalo deve ser um inteiro.')
  .min(1, 'Intervalo deve ser pelo menos 1.');

/**
 * Data `YYYY-MM-DD` — regex + `.refine()` de data válida (lição NIT-AR-4.3.2
 * da Story 4.3 — não deixar datas regex-válidas mas inválidas chegar ao
 * cast `::date`).
 */
const DateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida — formato esperado YYYY-MM-DD.')
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Data inválida.');

const CustomRruleSchema = z
  .string()
  .min(1, 'A regra de recorrência não pode ser vazia.')
  .max(1000, 'A regra de recorrência excede 1000 caracteres.');

/**
 * POST /api/financas/recorrencias body.
 *
 * Refinamentos (AC6a + AC6d): pelo menos um de `account_id`/`card_id`; se
 * `frequency='custom'` então `custom_rrule` obrigatório.
 */
export const FinanceRecurrenceCreateSchema = z
  .object({
    description: DescriptionSchema,
    kind: FinanceRecurrenceKindSchema,
    amount_cents: AmountCentsSchema,
    account_id: z.string().uuid('account_id inválido — deve ser um UUID.').optional(),
    card_id: z.string().uuid('card_id inválido — deve ser um UUID.').optional(),
    category_id: z.string().uuid('category_id inválido — deve ser um UUID.').optional(),
    payment_method: FinancePaymentMethodSchema.default('transfer'),
    frequency: FinanceRecurrenceFrequencySchema,
    interval: IntervalSchema.default(1),
    custom_rrule: CustomRruleSchema.optional(),
    starts_on: DateSchema,
    ends_on: DateSchema.optional(),
  })
  .strict()
  .refine((data) => data.account_id !== undefined || data.card_id !== undefined, {
    message: 'Recorrência requer conta ou cartão.',
    path: ['account_id'],
  })
  .refine(
    (data) => data.frequency !== 'custom' || data.custom_rrule !== undefined,
    {
      message:
        'Quando a frequência é personalizada, a regra de recorrência é obrigatória.',
      path: ['custom_rrule'],
    },
  );

export type FinanceRecurrenceCreateInput = z.infer<typeof FinanceRecurrenceCreateSchema>;

/**
 * PATCH /api/financas/recorrencias/[id] body — todos os campos opcionais.
 *
 * `household_id`/`currency`/`created_by_user_id`/`next_run_on` IMMUTABLE
 * (`.strict()` rejeita). `active` editável (permite reactivar/desactivar).
 *
 * Sem refinamento composto `account_or_card`: o schema de update não conhece
 * o estado existente da recorrência. Pôr ambos a `null` viola o CHECK
 * `recurrences_account_or_card` no DB — o handler PATCH converte essa
 * violação em 400 VALIDATION_ERROR (pattern D-4.2.C / D-4.3.B).
 */
export const FinanceRecurrenceUpdateSchema = z
  .object({
    description: DescriptionSchema.optional(),
    kind: FinanceRecurrenceKindSchema.optional(),
    amount_cents: AmountCentsSchema.optional(),
    account_id: z
      .string()
      .uuid('account_id inválido — deve ser um UUID.')
      .nullable()
      .optional(),
    card_id: z.string().uuid('card_id inválido — deve ser um UUID.').nullable().optional(),
    category_id: z
      .string()
      .uuid('category_id inválido — deve ser um UUID.')
      .nullable()
      .optional(),
    payment_method: FinancePaymentMethodSchema.optional(),
    frequency: FinanceRecurrenceFrequencySchema.optional(),
    interval: IntervalSchema.optional(),
    custom_rrule: CustomRruleSchema.nullable().optional(),
    starts_on: DateSchema.optional(),
    ends_on: DateSchema.nullable().optional(),
    active: z.boolean().optional(),
  })
  .strict();

export type FinanceRecurrenceUpdateInput = z.infer<typeof FinanceRecurrenceUpdateSchema>;
