/**
 * Zod schema — endpoint `/api/financas/prestacoes` (Story 4.4 AC3 + AC6).
 *
 * Convenções (AC8): `.strict()` rejeita campos extra; `household_id`,
 * `created_by_user_id` e `per_installment_cents` NUNCA em payload —
 * `household_id`/`created_by_user_id` vêm do JWT; `per_installment_cents` é
 * calculado server-side (`floor(total_amount_cents / num_installments)` —
 * AC6c). `currency` é fixo `'EUR'`.
 *
 * SEM `InstallmentUpdateSchema` (DP-4.4.3) — as compras parceladas são
 * imutáveis no MVP (coerente com a migration 0014 que omite `installment.updated`).
 * Editar = eliminar + recriar.
 *
 * [PO_FIX_INLINE F1] — guarda `total_amount_cents >= num_installments`. Sem
 * ela, `per_installment_cents = floor(total/num) = 0` quando o total é menor
 * que o número de parcelas, e os N-1 primeiros `transactions` gerados teriam
 * `amount_cents = 0`, o que viola o CHECK `transactions_amount_positive`
 * (`finance.ts:422-423` — `amount_cents > 0`). O INSERT falharia dentro de
 * `db.transaction()`, faria rollback e o handler devolveria 500 em vez de um
 * 400 VALIDATION_ERROR limpo. A guarda cobre também o caso degenerado
 * `num_installments = 1` (válido — `per = total`).
 *
 * Enums/CHECKs traçáveis a `packages/db/src/schema/finance.ts`: `installments`
 * (294-341 — `card_id` NOT NULL, CHECK `installments_num_positive` 1-60,
 * `installments_total_positive`).
 */
import { z } from 'zod';

const DescriptionSchema = z
  .string()
  .min(1, 'Descrição obrigatória.')
  .max(500, 'Descrição excede 500 caracteres.');

/** Valor total da compra em cents — alinha o CHECK `installments_total_positive`. */
const TotalAmountCentsSchema = z
  .number()
  .int('Valor total deve ser um inteiro (cêntimos de euro).')
  .positive('Valor total deve ser positivo.');

/** Número de parcelas — alinha o CHECK `installments_num_positive` (1-60). */
const NumInstallmentsSchema = z
  .number()
  .int('Número de parcelas deve ser um inteiro.')
  .min(1, 'Número de parcelas deve estar entre 1 e 60.')
  .max(60, 'Número de parcelas deve estar entre 1 e 60.');

/**
 * Data `YYYY-MM-DD` — regex + `.refine()` de data válida (lição NIT-AR-4.3.2
 * da Story 4.3 — não deixar datas regex-válidas mas inválidas chegar ao
 * cast `::date`).
 */
const DateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida — formato esperado YYYY-MM-DD.')
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Data inválida.');

/**
 * POST /api/financas/prestacoes body.
 *
 * `card_id` é obrigatório — `installments.card_id` é NOT NULL (`finance.ts:305-307`).
 * Refinamento PO_FIX_INLINE F1: `total_amount_cents >= num_installments`.
 */
export const InstallmentCreateSchema = z
  .object({
    card_id: z.string().uuid('card_id inválido — deve ser um UUID.'),
    description: DescriptionSchema,
    total_amount_cents: TotalAmountCentsSchema,
    num_installments: NumInstallmentsSchema,
    category_id: z.string().uuid('category_id inválido — deve ser um UUID.').optional(),
    purchased_on: DateSchema,
    first_installment_on: DateSchema,
  })
  .strict()
  .refine((data) => data.total_amount_cents >= data.num_installments, {
    message:
      'O valor total tem de ser pelo menos o número de parcelas (mínimo 1 cêntimo por parcela).',
    path: ['total_amount_cents'],
  });

export type InstallmentCreateInput = z.infer<typeof InstallmentCreateSchema>;
