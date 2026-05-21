/**
 * Zod schemas — endpoints `/api/financas/contas` + `/[id]` (Story 4.2 AC3).
 *
 * Convenções (AC8): `.strict()` rejeita campos extra; `household_id` e `currency`
 * NUNCA em payload — `household_id` vem do JWT do Supabase (RLS injection),
 * `currency` é fixo `'EUR'` (CON9, default da coluna na DB). `.strict()` rejeita
 * ambos com 400 VALIDATION_ERROR se presentes (defesa em profundidade, AC4).
 *
 * Espelha o pattern `tags.ts` (Story 3.2). Enum `account_type` traçável a
 * `packages/db/src/schema/finance.ts:39` (`accountTypeEnum`).
 */
import { z } from 'zod';

/** Tipos de conta — espelha `accountTypeEnum` (`finance.ts:39-46`). */
export const ACCOUNT_TYPES = [
  'corrente',
  'poupanca',
  'credito_consignado',
  'investimentos',
  'dinheiro',
  'outro',
] as const;

const AccountTypeSchema = z.enum(ACCOUNT_TYPES);
const AccountNameSchema = z
  .string()
  .min(1, 'Nome obrigatório.')
  .max(120, 'Nome excede 120 caracteres.');
const BankNameSchema = z
  .string()
  .min(1, 'Nome do banco vazio.')
  .max(120, 'Nome do banco excede 120 caracteres.');
/** Últimos 4 dígitos do IBAN — alinha com CHECK `accounts_iban_last4_format` (finance.ts:109). */
const IbanLast4Schema = z
  .string()
  .regex(/^[0-9]{4}$/, 'IBAN (últimos 4 dígitos) inválido — exactamente 4 dígitos.');

/** POST /api/financas/contas body. `currency` ausente — fixo `'EUR'` (default DB). */
export const AccountCreateSchema = z
  .object({
    name: AccountNameSchema,
    account_type: AccountTypeSchema.default('corrente'),
    bank_name: BankNameSchema.optional(),
    iban_last4: IbanLast4Schema.optional(),
    initial_balance_cents: z
      .number()
      .int('Saldo inicial deve ser um inteiro (cêntimos de euro).')
      .default(0),
  })
  .strict();

export type AccountCreateInput = z.infer<typeof AccountCreateSchema>;

/**
 * PATCH /api/financas/contas/[id] body — todos os campos opcionais.
 *
 * `household_id` e `currency` são IMMUTABLE — `.strict()` rejeita-os com 400.
 * `initial_balance_cents`/`balance_cents` não são editáveis aqui: o saldo é um
 * snapshot (DP-4.2.4) e o seu recompute pertence à Story 4.9 (vista Património).
 */
export const AccountUpdateSchema = z
  .object({
    name: AccountNameSchema.optional(),
    account_type: AccountTypeSchema.optional(),
    bank_name: BankNameSchema.optional(),
    iban_last4: IbanLast4Schema.optional(),
  })
  .strict();

export type AccountUpdateInput = z.infer<typeof AccountUpdateSchema>;
