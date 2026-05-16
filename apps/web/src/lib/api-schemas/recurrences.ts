/**
 * Zod schemas — endpoints `/api/recurrences` (Story 3.2 AC5 + AC8).
 *
 * Convenções (AC8): `.strict()`; `household_id` NUNCA em payload;
 * `template_task_id` IMMUTABLE em PATCH.
 *
 * F2 MEDIUM: PATCH com `frequency='custom'` retorna 422 UNPROCESSABLE_ENTITY
 * (re-cálculo `custom_rrule` deferred Story 3.7 quando rrule lib instalada
 * per Epic plan ED7).
 */
import { z } from 'zod';

// Enum mirror de packages/db/src/schema/tasks.ts (recurrenceFrequencyEnum)
export const recurrenceFrequencyValues = [
  'daily',
  'weekdays',
  'weekends',
  'weekly',
  'biweekly',
  'monthly',
  'yearly',
  'custom',
] as const;

export const RecurrenceFrequencySchema = z.enum(recurrenceFrequencyValues);

const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida — usar formato YYYY-MM-DD.');
const DateNullable = DateSchema.nullable();
const UuidNullable = z.string().uuid().nullable();
const IntervalSchema = z.number().int('Intervalo deve ser inteiro.').min(1, 'Intervalo deve ser ≥ 1.');
const CustomRruleSchema = z.string().max(500, 'RRULE excede 500 caracteres.').nullable();
const TitleSchema = z.string().min(1).max(200);

/**
 * POST /api/recurrences body — criar recorrência (transacção atómica).
 *
 * Se `template_task_id` é null, handler INSERT task template primeiro (com
 * `is_recurrence_template=true`) e depois INSERT recurrence apontando para
 * esse template — tudo em transacção.
 */
export const RecurrenceCreateSchema = z
  .object({
    template_task_id: UuidNullable.optional(),
    title: TitleSchema.optional(),
    frequency: RecurrenceFrequencySchema,
    interval: IntervalSchema.default(1),
    custom_rrule: CustomRruleSchema.optional(),
    starts_on: DateSchema,
    ends_on: DateNullable.optional(),
  })
  .strict()
  .refine(
    (data) => data.frequency !== 'custom' || (data.custom_rrule != null && data.custom_rrule.length > 0),
    {
      message: "Quando frequency='custom', custom_rrule é obrigatório.",
      path: ['custom_rrule'],
    },
  )
  .refine(
    (data) => data.template_task_id != null || (data.title != null && data.title.length > 0),
    {
      message: 'Se template_task_id é null, title é obrigatório para criar task template.',
      path: ['title'],
    },
  );

export type RecurrenceCreateInput = z.infer<typeof RecurrenceCreateSchema>;

/**
 * PATCH /api/recurrences/[id] body — todos opcionais; `template_task_id` IMMUTABLE.
 */
export const RecurrenceUpdateSchema = z
  .object({
    frequency: RecurrenceFrequencySchema.optional(),
    interval: IntervalSchema.optional(),
    custom_rrule: CustomRruleSchema.optional(),
    starts_on: DateSchema.optional(),
    ends_on: DateNullable.optional(),
    active: z.boolean().optional(),
  })
  .strict();

export type RecurrenceUpdateInput = z.infer<typeof RecurrenceUpdateSchema>;

/**
 * GET /api/recurrences query params — filters list.
 */
export const RecurrenceFiltersSchema = z
  .object({
    active: z.coerce.boolean().optional(),
    frequency: RecurrenceFrequencySchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

export type RecurrenceFiltersInput = z.infer<typeof RecurrenceFiltersSchema>;

/**
 * Inline helper — re-compute `next_run_on` para preset frequencies (F2).
 *
 * Para `frequency='custom'` (custom_rrule), retorna null — handler retorna
 * 422 UNPROCESSABLE_ENTITY (deferred Story 3.7 quando rrule lib instalada).
 */
export function computeNextRunOn(
  frequency: (typeof recurrenceFrequencyValues)[number],
  interval: number,
  current: Date,
): Date | null {
  if (frequency === 'custom') return null;

  const next = new Date(current.getTime());
  next.setUTCHours(0, 0, 0, 0);

  switch (frequency) {
    case 'daily':
      next.setUTCDate(next.getUTCDate() + interval);
      break;
    case 'weekdays': {
      let added = 0;
      while (added < interval) {
        next.setUTCDate(next.getUTCDate() + 1);
        const dow = next.getUTCDay();
        if (dow !== 0 && dow !== 6) added += 1;
      }
      break;
    }
    case 'weekends': {
      let added = 0;
      while (added < interval) {
        next.setUTCDate(next.getUTCDate() + 1);
        const dow = next.getUTCDay();
        if (dow === 0 || dow === 6) added += 1;
      }
      break;
    }
    case 'weekly':
      next.setUTCDate(next.getUTCDate() + 7 * interval);
      break;
    case 'biweekly':
      next.setUTCDate(next.getUTCDate() + 14 * interval);
      break;
    case 'monthly':
      next.setUTCMonth(next.getUTCMonth() + interval);
      break;
    case 'yearly':
      next.setUTCFullYear(next.getUTCFullYear() + interval);
      break;
  }

  return next;
}
