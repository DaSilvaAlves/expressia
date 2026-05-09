/**
 * Schema — Módulo Tarefas.
 *
 * Trace: PRD FR7-FR12, architecture §3.1 (grupo Tarefas), Epic 3.
 *
 * Notas:
 *   - Recorrência usa formato iCal RRULE (`recurrence_rule`) — biblioteca `rrule` no client/server.
 *   - `kanban_column_id` é FK opcional para suportar "lista" (sem coluna) e "kanban" (com coluna).
 *   - `tags` é global por household (FR12); pivot `task_tags` permite muitos-para-muitos.
 */
import { sql } from 'drizzle-orm';
import {
  pgEnum,
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  date,
  index,
  jsonb,
  boolean,
  primaryKey,
  unique,
  check,
} from 'drizzle-orm/pg-core';

import { authUsers } from './auth';
import { households, kanbanColumns } from './tenancy';

// ─────────────────────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────────────────────

export const taskPriorityEnum = pgEnum('task_priority', ['low', 'medium', 'high']);

export const taskStatusEnum = pgEnum('task_status', [
  'todo',
  'doing',
  'done',
  'archived',
]);

export const recurrenceFrequencyEnum = pgEnum('recurrence_frequency', [
  'daily',
  'weekdays',
  'weekends',
  'weekly',
  'biweekly',
  'monthly',
  'yearly',
  'custom', // RRULE livre
]);

// ─────────────────────────────────────────────────────────────────────────────
// tasks
// ─────────────────────────────────────────────────────────────────────────────

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    /** Quem criou — para "minhas tarefas" e auditoria. */
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'restrict' }),
    /** Atribuição opcional (futura: multi-assignee). */
    assignedToUserId: uuid('assigned_to_user_id').references(() => authUsers.id, {
      onDelete: 'set null',
    }),
    title: text('title').notNull(),
    description: text('description'),
    /** Data prevista (sem hora). Hora opcional em `due_time`. */
    dueDate: date('due_date'),
    /** Hora prevista (HH:MM, format text). NULL se "dia inteiro". */
    dueTime: text('due_time'),
    priority: taskPriorityEnum('priority').notNull().default('medium'),
    status: taskStatusEnum('status').notNull().default('todo'),
    /** Coluna Kanban. NULL = fora de qualquer Kanban (vista lista pura). */
    kanbanColumnId: uuid('kanban_column_id').references(() => kanbanColumns.id, {
      onDelete: 'set null',
    }),
    /** Posição dentro da coluna (drag-and-drop persiste isto — FR10). */
    kanbanPosition: integer('kanban_position').default(0),
    /** Projecto/etiqueta livre (FR7 menciona "projecto opcional"). */
    project: text('project'),
    /** Se esta task foi gerada por uma recurrence, aponta para a recurrence template. */
    recurrenceId: uuid('recurrence_id'), // FK definida abaixo via SQL para evitar circular
    /** Se é a "instância template" da recurrence (para evitar gerar múltiplas vezes). */
    isRecurrenceTemplate: boolean('is_recurrence_template').notNull().default(false),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    householdIdx: index('tasks_household_idx').on(t.householdId),
    statusIdx: index('tasks_status_idx').on(t.householdId, t.status),
    dueDateIdx: index('tasks_due_date_idx').on(t.householdId, t.dueDate),
    createdByIdx: index('tasks_created_by_idx').on(t.createdByUserId),
    assignedIdx: index('tasks_assigned_idx').on(t.assignedToUserId),
    kanbanIdx: index('tasks_kanban_idx').on(t.kanbanColumnId, t.kanbanPosition),
    /** Vista "atrasadas" (FR11): due_date < today AND status NOT IN (done,archived). */
    overdueIdx: index('tasks_overdue_idx').on(t.householdId, t.dueDate, t.status),
    /** Format HH:MM 24h. */
    dueTimeFormat: check(
      'tasks_due_time_format',
      sql`${t.dueTime} IS NULL OR ${t.dueTime} ~ '^[0-2][0-9]:[0-5][0-9]$'`,
    ),
  }),
);

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// task_recurrences
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Definição de recorrência (FR8). Job Inngest diário gera as instâncias futuras
 * para os próximos N dias (default 30).
 *
 * Suporta os presets do FR8 (daily, weekly, monthly, weekdays, weekends, dia do mês)
 * + RRULE livre via `customRrule`.
 */
export const taskRecurrences = pgTable(
  'task_recurrences',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    /** Task template — primeira ocorrência ou modelo. */
    templateTaskId: uuid('template_task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    frequency: recurrenceFrequencyEnum('frequency').notNull(),
    /** Intervalo (every N days/weeks/months). */
    interval: integer('interval').notNull().default(1),
    /** RRULE livre (formato iCal RFC 5545) quando frequency='custom'. */
    customRrule: text('custom_rrule'),
    /** Data de início da recorrência. */
    startsOn: date('starts_on').notNull(),
    /** Fim opcional. */
    endsOn: date('ends_on'),
    /** Próxima execução prevista — query do cron filtra `next_run_on <= today`. */
    nextRunOn: date('next_run_on'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    householdIdx: index('task_recurrences_household_idx').on(t.householdId),
    templateIdx: index('task_recurrences_template_idx').on(t.templateTaskId),
    /** Query crítica do cron diário (FR8 generation). */
    nextRunIdx: index('task_recurrences_next_run_idx').on(t.nextRunOn, t.active),
    intervalCheck: check('task_recurrences_interval_positive', sql`${t.interval} >= 1`),
  }),
);

export type TaskRecurrence = typeof taskRecurrences.$inferSelect;
export type NewTaskRecurrence = typeof taskRecurrences.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// tags
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tags globais por household (FR12). Aplicáveis a tasks (e futuro: transactions).
 */
export const tags = pgTable(
  'tags',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Cor do badge (hex `#RRGGBB`). */
    color: text('color').notNull().default('#6B7280'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    householdIdx: index('tags_household_idx').on(t.householdId),
    /** Tag name único por household (case-insensitive via lower()). */
    uniqueName: unique('tags_unique_name_per_household').on(t.householdId, t.name),
  }),
);

export type Tag = typeof tags.$inferSelect;
export type NewTag = typeof tags.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// task_tags — pivot many-to-many
// ─────────────────────────────────────────────────────────────────────────────

export const taskTags = pgTable(
  'task_tags',
  {
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
    /** household_id denormalizado para RLS direct (evita JOIN nas policies). */
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.taskId, t.tagId] }),
    householdIdx: index('task_tags_household_idx').on(t.householdId),
    tagIdx: index('task_tags_tag_idx').on(t.tagId),
  }),
);

export type TaskTag = typeof taskTags.$inferSelect;
export type NewTaskTag = typeof taskTags.$inferInsert;
