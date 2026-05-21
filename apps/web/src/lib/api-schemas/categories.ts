/**
 * Zod schemas — endpoints `/api/financas/categorias` + `/[id]` (Story 4.3 AC3).
 *
 * Convenções (AC8): `.strict()` rejeita campos extra; `household_id` NUNCA em
 * payload (RLS injection via JWT); `is_default` NUNCA em payload — a policy
 * `categories_insert_member` (`0001:485-492`) exige `is_default = false`
 * (criação de templates globais via API é bloqueada).
 *
 * Enum `kind` traçável a `categoryKindEnum` (`finance.ts:50`).
 */
import { z } from 'zod';

/** Tipos de categoria — espelha `categoryKindEnum` (`finance.ts:50`). */
export const CATEGORY_KINDS = ['expense', 'income', 'transfer'] as const;

const CategoryKindSchema = z.enum(CATEGORY_KINDS);
const CategoryNameSchema = z
  .string()
  .min(1, 'Nome obrigatório.')
  .max(120, 'Nome excede 120 caracteres.');
/** Nome de ícone Lucide (ex: `shopping-cart`, `fuel`). */
const IconSchema = z.string().min(1, 'Ícone vazio.').max(60, 'Nome do ícone excede 60 caracteres.');
/** Cor do badge — hex `#RRGGBB` (alinha `categories.color`, `finance.ts:194`). */
const ColorSchema = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/, 'Cor inválida — formato esperado #RRGGBB.');
const SortOrderSchema = z.number().int('Ordem deve ser um inteiro.');

/**
 * POST /api/financas/categorias body — categoria per-household.
 *
 * `is_default` ausente — RLS força `false`. `household_id` ausente — vem do JWT.
 */
export const CategoryCreateSchema = z
  .object({
    name: CategoryNameSchema,
    icon: IconSchema.optional(),
    color: ColorSchema.default('#6B7280'),
    parent_id: z.string().uuid('parent_id inválido — deve ser um UUID.').optional(),
    kind: CategoryKindSchema.default('expense'),
    sort_order: SortOrderSchema.default(0),
  })
  .strict();

export type CategoryCreateInput = z.infer<typeof CategoryCreateSchema>;

/**
 * PATCH /api/financas/categorias/[id] body — todos os campos opcionais.
 *
 * `household_id` e `is_default` são IMMUTABLE — `.strict()` rejeita-os com 400.
 * `parent_id` aceita `null` (remover a sub-categorização).
 */
export const CategoryUpdateSchema = z
  .object({
    name: CategoryNameSchema.optional(),
    icon: IconSchema.nullable().optional(),
    color: ColorSchema.optional(),
    parent_id: z.string().uuid('parent_id inválido — deve ser um UUID.').nullable().optional(),
    kind: CategoryKindSchema.optional(),
    sort_order: SortOrderSchema.optional(),
  })
  .strict();

export type CategoryUpdateInput = z.infer<typeof CategoryUpdateSchema>;
