/**
 * Zod schemas — endpoints `/api/tasks` (Story 3.2 AC1 + AC2 + AC6 + AC8).
 *
 * Convenções (AC8 defense-in-depth):
 *   - `.strict()` em POST/PATCH bodies — rejeita campos extra com 400.
 *   - NUNCA `household_id` em payload (derivado de JWT em handler).
 *   - NUNCA `created_by_user_id` em PATCH (immutable após POST).
 *   - NUNCA `id` em PATCH body (vem do URL param).
 */
import { z } from 'zod';

// Enum mirrors de packages/db/src/schema/tasks.ts (source-of-truth)
export const taskStatusValues = ['todo', 'doing', 'done', 'archived'] as const;
export const taskPriorityValues = ['low', 'medium', 'high'] as const;

export const TaskStatusSchema = z.enum(taskStatusValues);
export const TaskPrioritySchema = z.enum(taskPriorityValues);

export type TaskStatusInput = z.infer<typeof TaskStatusSchema>;
export type TaskPriorityInput = z.infer<typeof TaskPrioritySchema>;

// Story 3.6 G1.3 (Aria) — re-export TagSchema para uso em TaskListItemSchema.tags.
// Type-safety end-to-end: clientes recebem garantia de `tags: TaskRowTag[]` sempre array.
import { TagSchema } from '@/lib/api-schemas/tags';

/**
 * Shape de uma linha de tarefa devolvida pelo `GET /api/tasks` + RSC fetch
 * (Story 3.6 T6.0). `tags` default `[]` defende contra edge cases do LEFT JOIN
 * (G1.2 do Aria) e contra queries antigas que ainda não incluem o JOIN.
 */
export const TaskListItemSchema = z.object({
  id: z.string().uuid(),
  household_id: z.string().uuid(),
  created_by_user_id: z.string().uuid(),
  assigned_to_user_id: z.string().uuid().nullable(),
  title: z.string(),
  description: z.string().nullable(),
  due_date: z.string().nullable(),
  due_time: z.string().nullable(),
  priority: TaskPrioritySchema,
  status: TaskStatusSchema,
  kanban_column_id: z.string().uuid().nullable(),
  kanban_position: z.number().int().nonnegative(),
  project: z.string().nullable(),
  recurrence_id: z.string().uuid().nullable(),
  is_recurrence_template: z.boolean(),
  completed_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  tags: z.array(TagSchema).optional().default([]),
});

export type TaskListItem = z.infer<typeof TaskListItemSchema>;

/** Validations alinhadas com schema (check constraint tasks.ts:108-111). */
const TitleSchema = z.string().min(1, 'Título obrigatório.').max(200, 'Título excede 200 caracteres.');
const DescriptionSchema = z.string().max(5000, 'Descrição excede 5000 caracteres.').nullable();
const DueDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida — usar formato YYYY-MM-DD.').nullable();
const DueTimeSchema = z.string().regex(/^[0-2][0-9]:[0-5][0-9]$/, 'Hora inválida — usar formato HH:MM.').nullable();
const UuidSchema = z.string().uuid();
const UuidNullable = UuidSchema.nullable();
const ProjectSchema = z.string().max(100, 'Projecto excede 100 caracteres.').nullable();
const KanbanPositionSchema = z.number().int('Posição deve ser inteiro.').min(0, 'Posição não pode ser negativa.');

/**
 * POST /api/tasks body — criar tarefa.
 *
 * `household_id` e `created_by_user_id` derivados do JWT no handler.
 */
export const TaskCreateSchema = z
  .object({
    title: TitleSchema,
    description: DescriptionSchema.optional(),
    due_date: DueDateSchema.optional(),
    due_time: DueTimeSchema.optional(),
    priority: TaskPrioritySchema.optional(),
    status: TaskStatusSchema.optional(),
    kanban_column_id: UuidNullable.optional(),
    kanban_position: KanbanPositionSchema.optional(),
    project: ProjectSchema.optional(),
    assigned_to_user_id: UuidNullable.optional(),
  })
  .strict();

export type TaskCreateInput = z.infer<typeof TaskCreateSchema>;

/**
 * PATCH /api/tasks/[id] body — actualizar tarefa parcial.
 *
 * Todos os campos opcionais. `household_id`/`created_by_user_id`/`id` IMMUTABLE.
 */
export const TaskUpdateSchema = z
  .object({
    title: TitleSchema.optional(),
    description: DescriptionSchema.optional(),
    due_date: DueDateSchema.optional(),
    due_time: DueTimeSchema.optional(),
    priority: TaskPrioritySchema.optional(),
    status: TaskStatusSchema.optional(),
    kanban_column_id: UuidNullable.optional(),
    kanban_position: KanbanPositionSchema.optional(),
    project: ProjectSchema.optional(),
    assigned_to_user_id: UuidNullable.optional(),
    completed_at: z.string().datetime().nullable().optional(),
  })
  .strict();

export type TaskUpdateInput = z.infer<typeof TaskUpdateSchema>;

/**
 * PATCH /api/tasks/[id]/move body — drag-and-drop atómico (AC2).
 */
export const TaskMoveSchema = z
  .object({
    kanban_column_id: UuidNullable,
    kanban_position: KanbanPositionSchema,
  })
  .strict();

export type TaskMoveInput = z.infer<typeof TaskMoveSchema>;

/** Sort options aceites por GET /api/tasks (Story 3.3 DP5-3.3 A). */
export const taskSortValues = [
  'due_date_asc',
  'created_at_desc',
  'priority_desc',
  'title_asc',
] as const;
export const TaskSortSchema = z.enum(taskSortValues);
export type TaskSortInput = z.infer<typeof TaskSortSchema>;

/**
 * GET /api/tasks query params — filters + pagination cursor (AC1 + AC6) + sort (Story 3.3).
 *
 * Nota DP5-3.3: cursor pagination optimal apenas para `sort=due_date_asc` (default).
 * Para outros sorts a cursor encoding (`{ last_due_date, last_id }`) ainda funciona
 * mas pode degradar no boundary entre rows com mesmo sort key — aceite KISS para MVP.
 */
export const TaskFiltersSchema = z
  .object({
    status: TaskStatusSchema.optional(),
    tag_id: UuidSchema.optional(),
    due_date_from: DueDateSchema.optional(),
    due_date_to: DueDateSchema.optional(),
    kanban_column_id: UuidSchema.optional(),
    assigned_to_user_id: UuidSchema.optional(),
    project: z.string().max(100).optional(),
    priority: TaskPrioritySchema.optional(),
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    sort: TaskSortSchema.default('due_date_asc'),
  })
  .strict();

export type TaskFiltersInput = z.infer<typeof TaskFiltersSchema>;
