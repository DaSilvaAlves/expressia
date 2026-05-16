/**
 * Zod schemas — endpoints `/api/tags` + `/api/tasks/[id]/tags` (Story 3.2 AC3 + AC4 + AC8).
 *
 * Convenções (AC8): `.strict()` rejeita campos extra; `household_id` NUNCA em payload.
 */
import { z } from 'zod';

const ColorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Cor inválida — usar formato #RRGGBB.');
const TagNameSchema = z.string().min(1, 'Nome obrigatório.').max(50, 'Nome excede 50 caracteres.');

/** POST /api/tags body. */
export const TagCreateSchema = z
  .object({
    name: TagNameSchema,
    color: ColorSchema.optional(),
  })
  .strict();

export type TagCreateInput = z.infer<typeof TagCreateSchema>;

/** PATCH /api/tags/[id] body — todos opcionais. */
export const TagUpdateSchema = z
  .object({
    name: TagNameSchema.optional(),
    color: ColorSchema.optional(),
  })
  .strict();

export type TagUpdateInput = z.infer<typeof TagUpdateSchema>;

/** POST /api/tasks/[id]/tags body — attach pivot. */
export const TaskTagAttachSchema = z
  .object({
    tag_id: z.string().uuid(),
  })
  .strict();

export type TaskTagAttachInput = z.infer<typeof TaskTagAttachSchema>;
