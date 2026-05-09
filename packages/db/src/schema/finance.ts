/**
 * Schema — Módulo Finanças.
 *
 * Trace: PRD FR13-FR19, architecture §3.1 (grupo Finanças), Epic 4.
 *
 * Notas críticas:
 *   - **Valores monetários em CÊNTIMOS (`integer`)** — evita drift de floating point.
 *     `€78,70` = `7870` cents. UI converte via `formatEur(amount_cents / 100)` (ver types.ts).
 *     Decisão: `integer` em vez de `numeric(14,2)` para garantir aritmética exacta e
 *     compatibilidade Stripe (Stripe usa cents). Ver decisão DDL §1 nos próximos handoffs.
 *   - **EUR exclusiva** (CON9, FR19) — coluna `currency` é check-constrained.
 *   - Categorias têm dois "modos": template global (`household_id IS NULL`, `is_default=true`)
 *     ou per-household (override). Query típica: `WHERE household_id = $1 OR is_default = true`.
 *   - Transactions têm CHECK: pelo menos um de (account_id, card_id) NOT NULL.
 *   - Cartões com fecho/vencimento (FR15). Prestações (FR16) geram N transactions futuras.
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
  boolean,
  unique,
  check,
} from 'drizzle-orm/pg-core';

import { authUsers } from './auth';
import { households } from './tenancy';

// ─────────────────────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────────────────────

export const accountTypeEnum = pgEnum('account_type', [
  'corrente',
  'poupanca',
  'credito_consignado',
  'investimentos',
  'dinheiro', // físico/cash
  'outro',
]);

export const cardTypeEnum = pgEnum('card_type', ['credit', 'debit']);

export const categoryKindEnum = pgEnum('category_kind', ['expense', 'income', 'transfer']);

export const transactionKindEnum = pgEnum('transaction_kind', [
  'expense',
  'income',
  'transfer',
]);

export const paymentMethodFinanceEnum = pgEnum('payment_method_finance', [
  'cash',
  'card',
  'transfer',
  'direct_debit', // débito directo
  'multibanco',
  'mb_way',
  'other',
]);

export const recurrenceFreqFinanceEnum = pgEnum('recurrence_freq_finance', [
  'daily',
  'weekly',
  'biweekly',
  'monthly',
  'quarterly',
  'yearly',
  'custom',
]);

// ─────────────────────────────────────────────────────────────────────────────
// accounts — contas bancárias / dinheiro
// ─────────────────────────────────────────────────────────────────────────────

export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Banco emissor (ex: 'Millennium BCP', 'Caixa Geral de Depósitos', 'Revolut'). */
    bankName: text('bank_name'),
    accountType: accountTypeEnum('account_type').notNull().default('corrente'),
    /** Últimos 4 dígitos do IBAN — para identificação UI sem expor IBAN completo. */
    ibanLast4: text('iban_last4'),
    /** Saldo actual em cêntimos. Mantido sync via triggers ou recompute on read. */
    balanceCents: integer('balance_cents').notNull().default(0),
    /** Saldo inicial registado pelo utilizador (snapshot) — em cents. */
    initialBalanceCents: integer('initial_balance_cents').notNull().default(0),
    currency: text('currency').notNull().default('EUR'),
    /** Conta arquivada não aparece em listas mas mantém histórico. */
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    householdIdx: index('accounts_household_idx').on(t.householdId),
    activeIdx: index('accounts_active_idx').on(t.householdId, t.archivedAt),
    currencyCheck: check('accounts_currency_eur_only', sql`${t.currency} = 'EUR'`),
    ibanFormat: check(
      'accounts_iban_last4_format',
      sql`${t.ibanLast4} IS NULL OR ${t.ibanLast4} ~ '^[0-9]{4}$'`,
    ),
  }),
);

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// cards — cartões de crédito/débito (FR15)
// ─────────────────────────────────────────────────────────────────────────────

export const cards = pgTable(
  'cards',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    /** Conta a que está associado (cartão de débito) ou de pagamento (cartão de crédito). */
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    last4: text('last4'),
    cardType: cardTypeEnum('card_type').notNull().default('credit'),
    /** Dia do mês em que fecha a fatura (1-28 para evitar edge cases de fim de mês). */
    closingDay: integer('closing_day'),
    /** Dia do mês em que vence o pagamento. */
    dueDay: integer('due_day'),
    /** Limite de crédito em cents. NULL para débito. */
    creditLimitCents: integer('credit_limit_cents'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    householdIdx: index('cards_household_idx').on(t.householdId),
    accountIdx: index('cards_account_idx').on(t.accountId),
    last4Format: check(
      'cards_last4_format',
      sql`${t.last4} IS NULL OR ${t.last4} ~ '^[0-9]{4}$'`,
    ),
    closingDayRange: check(
      'cards_closing_day_range',
      sql`${t.closingDay} IS NULL OR (${t.closingDay} >= 1 AND ${t.closingDay} <= 28)`,
    ),
    dueDayRange: check(
      'cards_due_day_range',
      sql`${t.dueDay} IS NULL OR (${t.dueDay} >= 1 AND ${t.dueDay} <= 28)`,
    ),
    /** Cartão de crédito tem que ter limite. */
    creditNeedsLimit: check(
      'cards_credit_needs_limit',
      sql`${t.cardType} <> 'credit' OR ${t.creditLimitCents} IS NOT NULL`,
    ),
  }),
);

export type Card = typeof cards.$inferSelect;
export type NewCard = typeof cards.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// categories — globais (template) ou por household (FR13, FR18, Epic 4 AC8)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Categorias podem ser:
 *   - Globais (`household_id IS NULL`, `is_default = true`): templates PT-PT seed.
 *   - Por household (`household_id NOT NULL`, `is_default = false`): overrides ou custom.
 *
 * Hierarquia simples via `parent_id` (max 1 nível para KISS no MVP).
 */
export const categories = pgTable(
  'categories',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    /** NULL para categorias globais (template). */
    householdId: uuid('household_id').references(() => households.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Lucide icon name (ex: 'shopping-cart', 'utensils', 'fuel'). */
    icon: text('icon'),
    /** Cor do badge (hex `#RRGGBB`). */
    color: text('color').notNull().default('#6B7280'),
    /** Sub-categorias (1 nível). */
    parentId: uuid('parent_id'),
    isDefault: boolean('is_default').notNull().default(false),
    kind: categoryKindEnum('kind').notNull().default('expense'),
    /** Ordem na UI. */
    sortOrder: integer('sort_order').notNull().default(0),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    householdIdx: index('categories_household_idx').on(t.householdId),
    parentIdx: index('categories_parent_idx').on(t.parentId),
    kindIdx: index('categories_kind_idx').on(t.kind),
    /** Templates globais únicos por (NULL household, name). */
    uniqueGlobalName: unique('categories_unique_global_name').on(t.householdId, t.name),
    /** Coerência: se is_default=true então household_id deve ser NULL. */
    defaultIsGlobal: check(
      'categories_default_is_global',
      sql`(${t.isDefault} = false) OR (${t.householdId} IS NULL)`,
    ),
  }),
);

export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// recurrences — finanças recorrentes (FR14)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Definição de finança recorrente (renda, salário, internet, etc.).
 *
 * Job Inngest diário materializa instâncias para `next_run_date <= today`.
 * Cada instância gera uma `transactions` row com `recurrence_id` preenchido.
 */
export const recurrences = pgTable(
  'recurrences',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    /** Quem criou. */
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'restrict' }),
    /** Descrição apresentada nas transactions geradas. */
    description: text('description').notNull(),
    kind: transactionKindEnum('kind').notNull(),
    /** Valor em cents (positivo, sinal vem de `kind`). */
    amountCents: integer('amount_cents').notNull(),
    currency: text('currency').notNull().default('EUR'),
    accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'set null' }),
    cardId: uuid('card_id').references(() => cards.id, { onDelete: 'set null' }),
    categoryId: uuid('category_id').references(() => categories.id, {
      onDelete: 'set null',
    }),
    paymentMethod: paymentMethodFinanceEnum('payment_method').notNull().default('transfer'),
    frequency: recurrenceFreqFinanceEnum('frequency').notNull(),
    interval: integer('interval').notNull().default(1),
    customRrule: text('custom_rrule'),
    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on'),
    /** Próxima execução. */
    nextRunOn: date('next_run_on'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    householdIdx: index('recurrences_household_idx').on(t.householdId),
    nextRunIdx: index('recurrences_next_run_idx').on(t.nextRunOn, t.active),
    accountIdx: index('recurrences_account_idx').on(t.accountId),
    cardIdx: index('recurrences_card_idx').on(t.cardId),
    currencyCheck: check('recurrences_currency_eur_only', sql`${t.currency} = 'EUR'`),
    intervalCheck: check('recurrences_interval_positive', sql`${t.interval} >= 1`),
    /** Pelo menos um de account_id ou card_id NOT NULL. */
    accountOrCard: check(
      'recurrences_account_or_card',
      sql`(${t.accountId} IS NOT NULL) OR (${t.cardId} IS NOT NULL)`,
    ),
  }),
);

export type Recurrence = typeof recurrences.$inferSelect;
export type NewRecurrence = typeof recurrences.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// installments — compras parceladas (FR16)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compra parcelada — gera N transactions futuras (uma por parcela).
 * Ex: €1.200 em 12x → 12 transactions com amount_cents=10000 cada.
 *
 * `installments.id` aparece em `transactions.installment_id` para link reverso.
 */
export const installments = pgTable(
  'installments',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'restrict' }),
    /** Cartão onde foi feita a compra. */
    cardId: uuid('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'restrict' }),
    description: text('description').notNull(),
    /** Valor total da compra em cents. */
    totalAmountCents: integer('total_amount_cents').notNull(),
    /** Número de parcelas (1+). */
    numInstallments: integer('num_installments').notNull(),
    /** Valor por parcela (calculado: total / num — pode ter resto na última). */
    perInstallmentCents: integer('per_installment_cents').notNull(),
    /** Categoria a aplicar a todas as transactions geradas. */
    categoryId: uuid('category_id').references(() => categories.id, {
      onDelete: 'set null',
    }),
    /** Data da compra. */
    purchasedOn: date('purchased_on').notNull(),
    /** Data da primeira parcela (geralmente próxima fatura). */
    firstInstallmentOn: date('first_installment_on').notNull(),
    currency: text('currency').notNull().default('EUR'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    householdIdx: index('installments_household_idx').on(t.householdId),
    cardIdx: index('installments_card_idx').on(t.cardId),
    purchasedIdx: index('installments_purchased_idx').on(t.purchasedOn),
    currencyCheck: check('installments_currency_eur_only', sql`${t.currency} = 'EUR'`),
    numCheck: check(
      'installments_num_positive',
      sql`${t.numInstallments} >= 1 AND ${t.numInstallments} <= 60`,
    ),
    totalCheck: check('installments_total_positive', sql`${t.totalAmountCents} > 0`),
  }),
);

export type Installment = typeof installments.$inferSelect;
export type NewInstallment = typeof installments.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// transactions — variáveis e geradas (FR13, FR16)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Transacção financeira — fonte da verdade para todos os agregados.
 *
 * Origens possíveis:
 *   - Manual (UI ou agente): recurrence_id NULL, installment_id NULL.
 *   - Recorrente: recurrence_id NOT NULL, installment_id NULL.
 *   - Parcela: recurrence_id NULL, installment_id NOT NULL, installment_index >= 1.
 *
 * `transaction_date` é a data financeira (quando aconteceu),
 * `created_at` é quando foi inserida no sistema.
 */
export const transactions = pgTable(
  'transactions',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'restrict' }),
    accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'set null' }),
    cardId: uuid('card_id').references(() => cards.id, { onDelete: 'set null' }),
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
    /** Cents — sempre POSITIVO. Sinal lógico vem de `kind`. */
    amountCents: integer('amount_cents').notNull(),
    currency: text('currency').notNull().default('EUR'),
    kind: transactionKindEnum('kind').notNull(),
    description: text('description').notNull(),
    /** Data financeira (quando aconteceu na vida real). */
    transactionDate: date('transaction_date').notNull(),
    paymentMethod: paymentMethodFinanceEnum('payment_method').notNull().default('card'),
    /** Origem recorrente (FR14). */
    recurrenceId: uuid('recurrence_id').references(() => recurrences.id, {
      onDelete: 'set null',
    }),
    /** Origem parcela (FR16). */
    installmentId: uuid('installment_id').references(() => installments.id, {
      onDelete: 'set null',
    }),
    /** Índice da parcela (1..num_installments) — só preenchido se `installment_id NOT NULL`. */
    installmentIndex: integer('installment_index'),
    /** Origem agente AI (FR1-FR2) — para link reverso e auditoria. */
    agentRunId: uuid('agent_run_id'),
    /** Notas livres adicionais. */
    notes: text('notes'),
    /** Permite "stub" futuras (recurrences/installments materializadas mas ainda não realizadas). */
    isProjected: boolean('is_projected').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    householdIdx: index('transactions_household_idx').on(t.householdId),
    /** Query crítica: vista mensal — household + intervalo de datas (FR18). */
    dateRangeIdx: index('transactions_date_range_idx').on(t.householdId, t.transactionDate),
    /** Categoria (group by). */
    categoryIdx: index('transactions_category_idx').on(t.householdId, t.categoryId),
    accountIdx: index('transactions_account_idx').on(t.accountId, t.transactionDate),
    cardIdx: index('transactions_card_idx').on(t.cardId, t.transactionDate),
    recurrenceIdx: index('transactions_recurrence_idx').on(t.recurrenceId),
    installmentIdx: index('transactions_installment_idx').on(t.installmentId),
    kindIdx: index('transactions_kind_idx').on(t.householdId, t.kind, t.transactionDate),
    agentIdx: index('transactions_agent_idx').on(t.agentRunId),
    /** Projecções (FR18) — query separada do real. */
    projectedIdx: index('transactions_projected_idx').on(
      t.householdId,
      t.isProjected,
      t.transactionDate,
    ),
    currencyCheck: check('transactions_currency_eur_only', sql`${t.currency} = 'EUR'`),
    /** Pelo menos um de account_id ou card_id (não pode ser fantasma). */
    accountOrCard: check(
      'transactions_account_or_card',
      sql`(${t.accountId} IS NOT NULL) OR (${t.cardId} IS NOT NULL)`,
    ),
    /** amount_cents sempre positivo. */
    amountPositive: check('transactions_amount_positive', sql`${t.amountCents} > 0`),
    /** Coerência installment_index. */
    installmentIndexCoherent: check(
      'transactions_installment_index_coherent',
      sql`(${t.installmentId} IS NULL AND ${t.installmentIndex} IS NULL)
          OR (${t.installmentId} IS NOT NULL AND ${t.installmentIndex} >= 1)`,
    ),
  }),
);

export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
