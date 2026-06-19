/**
 * Schema — Tenancy (households, members, invites).
 *
 * Multi-tenancy por household (CON2). Toda a tabela de domínio tem `household_id`
 * com FK + ON DELETE CASCADE para garantir purge GDPR (NFR10) consistente.
 *
 * Trace: PRD FR24-29, architecture §3, §5.3, ADR-008.
 */
import { sql } from 'drizzle-orm';
import {
  pgEnum,
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  unique,
  index,
  primaryKey,
  check,
  boolean,
} from 'drizzle-orm/pg-core';

import { authUsers } from './auth';

// ─────────────────────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────────────────────

/** Planos de subscrição (FR34, directiva Eurico Família €8,88). */
export const planTierEnum = pgEnum('plan_tier', ['free', 'pessoal', 'familia', 'pro']);

/** Papel do utilizador num household (architecture §3.1). */
export const householdRoleEnum = pgEnum('household_role', ['owner', 'admin', 'member']);

// ─────────────────────────────────────────────────────────────────────────────
// households — agregado raiz multi-tenant
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Households — unidade de tenancy.
 *
 * Um utilizador pode pertencer a múltiplos households (Pro). O `plan` é derivado
 * do `subscriptions.plan` mais recente; mantemos cópia denormalizada aqui para
 * fast-path de RLS / quotas (sem JOIN em `subscriptions`).
 */
export const households = pgTable(
  'households',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    name: text('name').notNull(),
    /** UUID do `auth.users.id` que criou (e é owner inicial). */
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'restrict' }),
    /** Plano corrente — denormalizado de `subscriptions` para fast-path RLS/quotas. */
    plan: planTierEnum('plan').notNull().default('free'),
    /** Locale fixo PT-PT (CON3). Coluna existe para consistência futura mas não é UI-toggle. */
    locale: text('locale').notNull().default('pt-PT'),
    /** Timezone para cálculos de recorrência (default Europe/Lisbon). */
    timezone: text('timezone').notNull().default('Europe/Lisbon'),
    /** Moeda fixa EUR (CON9, FR19). */
    currency: text('currency').notNull().default('EUR'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    ownerIdx: index('households_owner_idx').on(t.ownerUserId),
    currencyCheck: check('households_currency_eur_only', sql`${t.currency} = 'EUR'`),
    localeCheck: check('households_locale_pt_only', sql`${t.locale} = 'pt-PT'`),
  }),
);

export type Household = typeof households.$inferSelect;
export type NewHousehold = typeof households.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// household_members — pivot user × household
// ─────────────────────────────────────────────────────────────────────────────

export const householdMembers = pgTable(
  'household_members',
  {
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    role: householdRoleEnum('role').notNull().default('member'),
    /** Display name específico deste membro neste household (opcional). */
    displayName: text('display_name'),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.householdId, t.userId] }),
    userIdx: index('household_members_user_idx').on(t.userId),
    householdIdx: index('household_members_household_idx').on(t.householdId),
  }),
);

export type HouseholdMember = typeof householdMembers.$inferSelect;
export type NewHouseholdMember = typeof householdMembers.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// kanban_columns — colunas customizáveis por household (FR9)
// ─────────────────────────────────────────────────────────────────────────────

export const kanbanColumns = pgTable(
  'kanban_columns',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Ordem de apresentação (0-based). */
    sortOrder: integer('sort_order').notNull().default(0),
    /** Cor do badge (hex `#RRGGBB`). */
    color: text('color').notNull().default('#6B7280'),
    /**
     * Se esta coluna representa o estado "concluído" (move tasks para `done`).
     *
     * Story 3.4 migration 0011: converted from text ('true'/'false') to boolean.
     * Partial unique index `kanban_columns_done_unique` garante máx 1 por household.
     */
    isDoneColumn: boolean('is_done_column').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    householdIdx: index('kanban_columns_household_idx').on(t.householdId),
    uniqueOrder: unique('kanban_columns_unique_order').on(t.householdId, t.sortOrder),
  }),
);

export type KanbanColumn = typeof kanbanColumns.$inferSelect;
export type NewKanbanColumn = typeof kanbanColumns.$inferInsert;
