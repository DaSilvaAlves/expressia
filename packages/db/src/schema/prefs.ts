/**
 * Schema — User preferences (Story 2.7 FR4 toggle `always_preview`).
 *
 * 1:1 com auth.users (D29). `household_id` necessário para RLS pattern
 * (cross-tenancy isolation) — multi-household users partilham mesma
 * `always_preview` (edge case deferred DP — ver story 2.7 D29).
 *
 * Imports relativos `./` per Story 2.6 D27 directive (cross-package source
 * files no monorepo). Tabela detectada pelo gate NFR5
 * `scripts/check-rls-coverage.ts` via match `householdId` no schema.
 *
 * Trace: Story 2.7 D29 + AC1, PRD FR4, EPIC-2 §8 DP2.
 */
import { sql } from 'drizzle-orm';
import { pgTable, uuid, boolean, timestamp, index } from 'drizzle-orm/pg-core';

import { authUsers } from './auth';
import { households } from './tenancy';

/**
 * `user_prefs` — preferências cognitivas de utilizador.
 *
 * `user_id` é PK + FK CASCADE para auth.users (purge user purges prefs —
 * NFR17 GDPR). `household_id` é FK CASCADE para households (RLS predicate
 * `is_household_member(household_id)`).
 *
 * `always_preview` default false respeita threshold 0.70 do FR4 (DP2).
 * Quando true, força preview-then-confirm em todos os prompts
 * independentemente da confidence.
 */
export const userPrefs = pgTable(
  'user_prefs',
  {
    /** PK = FK auth.users(id) ON DELETE CASCADE — 1:1 user (D29). */
    userId: uuid('user_id')
      .primaryKey()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    /** Household activo do user — necessário para RLS pattern. */
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    /** FR4 toggle — quando true, força preview em todos os prompts. */
    alwaysPreview: boolean('always_preview').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    /** Index para lookups RLS-friendly por household. */
    householdIdx: index('user_prefs_household_idx').on(t.householdId),
  }),
);

export type UserPrefs = typeof userPrefs.$inferSelect;
export type NewUserPrefs = typeof userPrefs.$inferInsert;
