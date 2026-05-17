/**
 * Zod schemas — endpoints `/api/kanban-columns/*` (Story 3.4 AC7-AC11).
 *
 * Convenções (alinhadas com Story 3.2 patterns):
 *   - `.strict()` em todos os bodies — rejeita campos extra com 400.
 *   - NUNCA `household_id` em payload (derivado de JWT em handler).
 *   - `name` 1-40 chars; `color` hex 6 dígitos.
 *   - Batch schema (DP-3.4.6 + G2.1): columns array obrigatório; creates/deletes
 *     opcionais; 3 valida invariants pós-batch server-side (G2.3).
 */
import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// Primitivas
// ─────────────────────────────────────────────────────────────────────────────

const ColumnNameSchema = z
  .string()
  .min(1, 'Nome da coluna obrigatório.')
  .max(40, 'Nome da coluna excede 40 caracteres.');

const ColorHexSchema = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/, 'Cor inválida — utilizar formato hex #RRGGBB.');

const SortOrderSchema = z.number().int('Ordem deve ser inteiro.').min(0, 'Ordem não pode ser negativa.');

const UuidSchema = z.string().uuid();

// ─────────────────────────────────────────────────────────────────────────────
// Response shape — KanbanColumn row
// ─────────────────────────────────────────────────────────────────────────────

export const KanbanColumnSchema = z.object({
  id: UuidSchema,
  name: z.string(),
  sort_order: z.number().int(),
  color: z.string(),
  is_done_column: z.boolean(),
});

export type KanbanColumnRow = z.infer<typeof KanbanColumnSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/kanban-columns — criar coluna (AC8)
// ─────────────────────────────────────────────────────────────────────────────

export const CreateKanbanColumnSchema = z
  .object({
    name: ColumnNameSchema,
    color: ColorHexSchema.optional(),
    sort_order: SortOrderSchema.optional(),
  })
  .strict();

export type CreateKanbanColumnInput = z.infer<typeof CreateKanbanColumnSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/kanban-columns/[id] — actualizar coluna parcial (AC9)
// ─────────────────────────────────────────────────────────────────────────────

export const UpdateKanbanColumnSchema = z
  .object({
    name: ColumnNameSchema.optional(),
    color: ColorHexSchema.optional(),
    is_done_column: z.boolean().optional(),
    sort_order: SortOrderSchema.optional(),
  })
  .strict();

export type UpdateKanbanColumnInput = z.infer<typeof UpdateKanbanColumnSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/kanban-columns/[id]?move_to=... query (AC10)
// ─────────────────────────────────────────────────────────────────────────────

export const DeleteKanbanColumnQuerySchema = z
  .object({
    move_to: UuidSchema.optional(),
  })
  .strict();

export type DeleteKanbanColumnQuery = z.infer<typeof DeleteKanbanColumnQuerySchema>;

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/kanban-columns/batch — batch transaction (AC11 + DP-3.4.6 + G2.1)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Batch input schema (G2.1 Aria strict):
 *   - `columns[]`: updates a colunas existentes (id obrigatório, sort_order obrigatório,
 *     name/is_done_column opcionais para reorder + rename + done toggle).
 *   - `creates?[]`: novas colunas (name obrigatório, color/sort_order opcionais).
 *   - `deletes?[]`: ids a eliminar (move_to opcional — destino tasks).
 *
 * Validações server-side adicionais (G2.3):
 *   (a) `columns[].id` ∈ household
 *   (b) `deletes[].move_to` ∈ household e ≠ `deletes[].id`
 *   (c) `creates[].name` ≠ existing names
 */
export const BatchKanbanColumnsSchema = z
  .object({
    columns: z
      .array(
        z
          .object({
            id: UuidSchema,
            sort_order: SortOrderSchema,
            name: ColumnNameSchema.optional(),
            is_done_column: z.boolean().optional(),
            color: ColorHexSchema.optional(),
          })
          .strict(),
      )
      .default([]),
    creates: z
      .array(
        z
          .object({
            name: ColumnNameSchema,
            color: ColorHexSchema.optional(),
            sort_order: SortOrderSchema.optional(),
          })
          .strict(),
      )
      .optional(),
    deletes: z
      .array(
        z
          .object({
            id: UuidSchema,
            move_to: UuidSchema.optional(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

export type BatchKanbanColumnsInput = z.infer<typeof BatchKanbanColumnsSchema>;
