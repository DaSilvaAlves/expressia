/**
 * Schema — User preferences.
 *
 * 1:1 com auth.users (D29). `household_id` necessário para RLS pattern
 * (cross-tenancy isolation) — multi-household users partilham mesmas
 * preferências (edge case deferred DP — ver story 2.7 D29).
 *
 * Imports relativos `./` per Story 2.6 D27 directive (cross-package source
 * files no monorepo). Tabela detectada pelo gate NFR5
 * `scripts/check-rls-coverage.ts` via match `householdId` no schema.
 *
 * **Colunas de preferência (evolução incremental):**
 *   - `alwaysPreview` boolean — FR4 toggle preview-then-confirm (Story 2.7).
 *   - `theme` text + CHECK — FR22 modo claro/escuro (Story 5.1, DP2 Epic 5 = C híbrido).
 *   - `widgetsEnabled` jsonb — FR21 config de widgets do dashboard "Visão" (Story 5.1, DP3 Epic 5 = A).
 *
 * Trace: Story 2.7 D29 + AC1 (FR4); Story 5.1 AC1+AC2+AC3 (FR21, FR22);
 * Epic 2 §8 DP2; Epic 5 §8 DP2+DP3.
 */
import { sql } from 'drizzle-orm';
import { pgTable, uuid, boolean, jsonb, text, timestamp, index } from 'drizzle-orm/pg-core';

import { authUsers } from './auth';
import { households } from './tenancy';

/**
 * Modo de tema preferido pelo utilizador (FR22, Story 5.1).
 *
 * Story 5.1 AC1(a) usa `text + CHECK constraint` em vez do pattern
 * `pgEnum` usado em `finance.ts:39-76` — decisão consciente AC8(a):
 * 3 valores estáveis tornam CHECK mais flexível para evolução futura
 * (high-contrast, sepia, …) sem caveats de ALTER TYPE em transactions.
 */
export type Theme = 'light' | 'dark' | 'system';

/**
 * Identificadores canónicos dos widgets do dashboard "Visão" (FR21).
 *
 * Snake_case (não kebab-case) para evitar escape de hyphens em queries
 * JSONB e alinhar com convenção DB do projecto. Mapping para labels PT-PT
 * vive em `front-end-spec.md §5.4` (não na DB — separation of concerns).
 */
export type WidgetId =
  | 'briefing'
  | 'tasks_today'
  | 'finance_month'
  | 'recurrences_next'
  | 'tasks_overdue'
  | 'accounts_balance'
  | 'calendar_week';

/**
 * Mapa de widgets activos/inactivos para um utilizador. Todas as 7 chaves
 * são obrigatórias (Zod `.strict()` em runtime). Validado em
 * `apps/web/src/lib/api-schemas/preferences.ts`.
 */
export type WidgetsEnabled = Record<WidgetId, boolean>;

/**
 * Default JSONB aplicado pela migration 0016 e usado no schema Drizzle
 * para INSERTs no servidor sem valores explícitos.
 *
 * 5 default ON  : briefing, tasks_today, finance_month,
 *                 recurrences_next, tasks_overdue
 * 2 default OFF : accounts_balance, calendar_week
 *
 * Fonte: `front-end-spec.md §5.4` linhas 545-551.
 */
export const DEFAULT_WIDGETS_ENABLED: WidgetsEnabled = {
  briefing: true,
  tasks_today: true,
  finance_month: true,
  recurrences_next: true,
  tasks_overdue: true,
  accounts_balance: false,
  calendar_week: false,
};

/**
 * `user_prefs` — preferências cognitivas e UI do utilizador.
 *
 * `user_id` é PK + FK CASCADE para auth.users (purge user purges prefs —
 * NFR17 GDPR). `household_id` é FK CASCADE para households (RLS predicate
 * `is_household_member(household_id)`).
 *
 * Story 5.1 estende com `theme` e `widgets_enabled` — `theme` default
 * `'system'` respeita preferência do OS; `widgets_enabled` default JSONB
 * com 5 widgets ON e 2 OFF (front-end-spec §5.4).
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
    /**
     * FR22 — modo claro/escuro/system.
     *
     * Pattern `text + enum narrowing` (não `pgEnum`) é decisão consciente
     * AC8(a) da Story 5.1: 3 valores estáveis tornam CHECK constraint
     * mais flexível para evolução futura. CHECK aplicado pela migration
     * 0016 (`user_prefs_theme_check`).
     */
    theme: text('theme', { enum: ['light', 'dark', 'system'] })
      .notNull()
      .default('system'),
    /**
     * FR21 — config dos widgets activos no dashboard "Visão".
     *
     * `$type<WidgetsEnabled>()` narrowing TS do jsonb (default Drizzle é
     * `unknown`). Validado em runtime por Zod `WidgetsEnabledSchema.strict()`
     * no endpoint PATCH `/api/conta/preferencias`.
     */
    widgetsEnabled: jsonb('widgets_enabled')
      .$type<WidgetsEnabled>()
      .notNull()
      .default(DEFAULT_WIDGETS_ENABLED),
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
