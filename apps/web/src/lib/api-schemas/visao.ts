/**
 * Zod schemas — endpoints `/api/visao/*` (Story 5.5 AC8).
 *
 * Schemas de resposta partilhados entre os 7 endpoints agregadores do dashboard
 * "Visão" (FR21) e o `<WidgetGrid>` da Story 5.6 que os consome.
 *
 * Convenções:
 *   - Single source-of-truth para shape das respostas: handlers fazem `parse`
 *     antes de devolver e o cliente usa `z.infer` para tipar.
 *   - Valores monetários em cêntimos (`*Cents: number`) — conversão para `€`
 *     é responsabilidade do `<MoneyDisplay>` no frontend (CON9 / Story 5.2).
 *   - `currency` literal `'EUR'` em todas as respostas financeiras (CON9).
 *   - Mensagens user-facing em PT-PT (CON3).
 *
 * Trace: Story 5.5 AC1-AC9; `WidgetId` em `@meu-jarvis/db/src/schema/prefs.ts`
 *        (`briefing | tasks_today | finance_month | recurrences_next |
 *        tasks_overdue | accounts_balance | calendar_week`).
 */
import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers partilhados
// ─────────────────────────────────────────────────────────────────────────────

const TaskStatusSchema = z.enum(['todo', 'doing', 'done', 'archived']);
const TaskPrioritySchema = z.enum(['low', 'medium', 'high']);
const RecurrenceKindSchema = z.enum(['expense', 'income', 'transfer']);
// `recurrence_freq_finance` enum em finance.ts:68 — match byte-a-byte (OBS-3).
const RecurrenceFrequencySchema = z.enum([
  'daily',
  'weekly',
  'biweekly',
  'monthly',
  'quarterly',
  'yearly',
  'custom',
]);

// ─────────────────────────────────────────────────────────────────────────────
// AC1 — Tarefas de hoje (widget `tasks_today`)
// ─────────────────────────────────────────────────────────────────────────────

export const TasksTodayItemSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  status: TaskStatusSchema,
  priority: TaskPrioritySchema,
  dueTime: z.string().nullable(),
});

export const TasksTodayResponseSchema = z.object({
  count: z.number().int().nonnegative(),
  tasks: z.array(TasksTodayItemSchema),
});

export type TasksTodayItem = z.infer<typeof TasksTodayItemSchema>;
export type TasksTodayResponse = z.infer<typeof TasksTodayResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// AC2 — Tarefas atrasadas (widget `tasks_overdue`)
// ─────────────────────────────────────────────────────────────────────────────

export const TasksOverdueItemSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  status: TaskStatusSchema,
  priority: TaskPrioritySchema,
  dueDate: z.string(), // 'YYYY-MM-DD'
  dueTime: z.string().nullable(),
});

export const TasksOverdueResponseSchema = z.object({
  count: z.number().int().nonnegative(),
  tasks: z.array(TasksOverdueItemSchema),
});

export type TasksOverdueItem = z.infer<typeof TasksOverdueItemSchema>;
export type TasksOverdueResponse = z.infer<typeof TasksOverdueResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// AC3 — Finanças do mês (widget `finance_month`)
// ─────────────────────────────────────────────────────────────────────────────

export const FinancesMonthResponseSchema = z.object({
  incomeTotal: z.number().int(),
  expenseTotal: z.number().int(),
  balance: z.number().int(),
  transactionCount: z.number().int().nonnegative(),
  currency: z.literal('EUR'),
});

export type FinancesMonthResponse = z.infer<typeof FinancesMonthResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// AC4 — Próximas recorrências (widget `recurrences_next`)
// ─────────────────────────────────────────────────────────────────────────────

export const RecurrencesNextItemSchema = z.object({
  id: z.string().uuid(),
  description: z.string(),
  kind: RecurrenceKindSchema,
  amountCents: z.number().int(),
  frequency: RecurrenceFrequencySchema,
  nextRunOn: z.string(), // 'YYYY-MM-DD'
});

export const RecurrencesNextResponseSchema = z.object({
  count: z.number().int().nonnegative(),
  recurrences: z.array(RecurrencesNextItemSchema),
});

export type RecurrencesNextItem = z.infer<typeof RecurrencesNextItemSchema>;
export type RecurrencesNextResponse = z.infer<typeof RecurrencesNextResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// AC5 — Saldo de contas (widget `accounts_balance`)
// ─────────────────────────────────────────────────────────────────────────────

export const AccountsBalanceResponseSchema = z.object({
  totalBalanceCents: z.number().int(),
  accountCount: z.number().int().nonnegative(),
  currency: z.literal('EUR'),
});

export type AccountsBalanceResponse = z.infer<typeof AccountsBalanceResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// AC6 — Calendário semana (widget `calendar_week`)
// ─────────────────────────────────────────────────────────────────────────────

export const CalendarWeekTaskSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  priority: TaskPrioritySchema,
  dueTime: z.string().nullable(),
});

export const CalendarWeekDaySchema = z.object({
  date: z.string(), // 'YYYY-MM-DD'
  taskCount: z.number().int().nonnegative(),
  tasks: z.array(CalendarWeekTaskSchema),
});

export const CalendarWeekResponseSchema = z.object({
  days: z.array(CalendarWeekDaySchema).length(7),
});

export type CalendarWeekTask = z.infer<typeof CalendarWeekTaskSchema>;
export type CalendarWeekDay = z.infer<typeof CalendarWeekDaySchema>;
export type CalendarWeekResponse = z.infer<typeof CalendarWeekResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// AC7 — Briefing (widget `briefing`) — stub forward-compatible
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stub do briefing diário. `version: 1` reservado para forward compatibility
 * (OBS-5) — quando o briefing real for implementado, a v2 poderá adicionar
 * campos (sections, summary, etc.) sem partir consumidores que validam pela v1.
 */
export const BriefingResponseSchema = z.object({
  version: z.literal(1),
  available: z.boolean(),
  message: z.string(),
  generatedAt: z.string().nullable(),
});

export type BriefingResponse = z.infer<typeof BriefingResponseSchema>;
