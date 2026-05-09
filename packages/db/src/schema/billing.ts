/**
 * Schema — Billing (Stripe).
 *
 * Trace: PRD FR32-36, architecture §6, ADR (planos €4,90 / €8,88 / €14,90).
 *
 * Notas críticas:
 *   - Moeda fixa EUR (CON9, FR19) — `currency` é check-constrained.
 *   - Payment methods PT (FR36): card, multibanco, mb_way.
 *   - Idempotência de webhooks via `payment_events.stripe_event_id` (PK).
 *   - NIF guardado em `invoices.nif_customer` para emissão de factura PT (FR35).
 */
import { sql } from 'drizzle-orm';
import {
  pgEnum,
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  index,
  unique,
  jsonb,
  boolean,
  numeric,
  check,
} from 'drizzle-orm/pg-core';

import { authUsers } from './auth';
import { households, planTierEnum } from './tenancy';

// ─────────────────────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────────────────────

export const subscriptionStatusEnum = pgEnum('subscription_status', [
  'trialing',
  'active',
  'past_due',
  'past_due_pending', // Multibanco a aguardar (architecture §6.2)
  'canceled',
  'incomplete',
  'incomplete_expired',
  'unpaid',
]);

export const paymentMethodTypeEnum = pgEnum('payment_method_type', [
  'card',
  'multibanco',
  'mb_way',
]);

export const invoiceStatusEnum = pgEnum('invoice_status', [
  'draft',
  'open',
  'paid',
  'void',
  'uncollectible',
]);

// ─────────────────────────────────────────────────────────────────────────────
// subscriptions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Uma subscrição por household. Estado canónico do Stripe replicado aqui via webhooks.
 *
 * Notas:
 *   - `trial_ends_at` permite expirar trials sem Stripe customer (FR33).
 *   - `current_period_*` define o ciclo de quotas LLM (NFR20).
 */
export const subscriptions = pgTable(
  'subscriptions',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    /** Pode ser null em trials internos sem Stripe customer (FR33). */
    stripeCustomerId: text('stripe_customer_id'),
    stripeSubscriptionId: text('stripe_subscription_id').unique(),
    plan: planTierEnum('plan').notNull(),
    status: subscriptionStatusEnum('status').notNull(),
    /** ISO 4217. Sempre EUR (CON9). */
    currency: text('currency').notNull().default('EUR'),
    /** Trial ends — usado por job Inngest `expire-trials`. */
    trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
    currentPeriodStart: timestamp('current_period_start', { withTimezone: true }),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
    canceledAt: timestamp('canceled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    householdIdx: index('subscriptions_household_idx').on(t.householdId),
    statusIdx: index('subscriptions_status_idx').on(t.status),
    trialIdx: index('subscriptions_trial_idx').on(t.trialEndsAt),
    currencyCheck: check('subscriptions_currency_eur_only', sql`${t.currency} = 'EUR'`),
    /** 1 subscrição activa por household (FR32). */
    uniqueActive: unique('subscriptions_one_per_household').on(t.householdId),
  }),
);

export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// payment_methods
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Métodos de pagamento associados ao Stripe customer do household.
 * Multibanco e MB Way são "single-use" no Stripe — guardamos último uso para UX.
 */
export const paymentMethods = pgTable(
  'payment_methods',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    stripePaymentMethodId: text('stripe_payment_method_id').notNull().unique(),
    type: paymentMethodTypeEnum('type').notNull(),
    /** Últimos 4 dígitos (cartão) ou null para MB/MBWay. */
    last4: text('last4'),
    brand: text('brand'), // 'visa', 'mastercard', 'amex'...
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    householdIdx: index('payment_methods_household_idx').on(t.householdId),
  }),
);

export type PaymentMethod = typeof paymentMethods.$inferSelect;
export type NewPaymentMethod = typeof paymentMethods.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// invoices
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Facturas/recibos emitidos pelo Stripe — replicados localmente para FR35.
 *
 * `invoice_number` é o número sequencial PT (`FT 2026/0001`); preenchido
 * por trigger ou por server function ao criar a invoice.
 */
export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    stripeInvoiceId: text('stripe_invoice_id').notNull().unique(),
    /** Número sequencial AT-friendly (`FT 2026/0001`). */
    invoiceNumber: text('invoice_number').unique(),
    status: invoiceStatusEnum('status').notNull(),
    /** Em cêntimos (€8,88 = 888). Stripe-native. */
    amountCents: integer('amount_cents').notNull(),
    currency: text('currency').notNull().default('EUR'),
    /** NIF do cliente para AT (FR35). NULL se não fornecido. */
    nifCustomer: text('nif_customer'),
    /** URL assinado do PDF gerado pelo Stripe. */
    invoicePdfUrl: text('invoice_pdf_url'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    /** Quando foi enviada por email ao cliente. */
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    householdIdx: index('invoices_household_idx').on(t.householdId),
    statusIdx: index('invoices_status_idx').on(t.status),
    paidAtIdx: index('invoices_paid_at_idx').on(t.paidAt),
    currencyCheck: check('invoices_currency_eur_only', sql`${t.currency} = 'EUR'`),
    /** NIF PT formato: 9 dígitos. NULL é permitido (cliente pode não fornecer). */
    nifFormat: check(
      'invoices_nif_format',
      sql`${t.nifCustomer} IS NULL OR ${t.nifCustomer} ~ '^[0-9]{9}$'`,
    ),
  }),
);

export type Invoice = typeof invoices.$inferSelect;
export type NewInvoice = typeof invoices.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// payment_events — idempotência de webhooks Stripe (architecture §6.3)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Append-only log de eventos Stripe — PK em `stripe_event_id` garante idempotência.
 * Inngest também tem own idempotency key, este é defesa em profundidade.
 */
export const paymentEvents = pgTable(
  'payment_events',
  {
    /** PK = `stripe_event_id` (idempotência forte). */
    stripeEventId: text('stripe_event_id').primaryKey(),
    /** household_id pode ser null para eventos sem subscrição associada (raro). */
    householdId: uuid('household_id').references(() => households.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(), // 'invoice.paid', 'customer.subscription.updated'...
    payload: jsonb('payload').notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    /** Se houve erro no processamento, guarda mensagem para retry/diagnose. */
    processingError: text('processing_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    householdIdx: index('payment_events_household_idx').on(t.householdId),
    typeIdx: index('payment_events_type_idx').on(t.eventType),
    processedIdx: index('payment_events_processed_idx').on(t.processedAt),
  }),
);

export type PaymentEvent = typeof paymentEvents.$inferSelect;
export type NewPaymentEvent = typeof paymentEvents.$inferInsert;
