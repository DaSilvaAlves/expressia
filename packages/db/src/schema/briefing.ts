/**
 * Schema — Brief diário (idempotência do `generate-daily-brief`).
 *
 * Story J-4 — o job Inngest envia 1 brief por dia por household no Telegram.
 * Como o Inngest tem entrega at-least-once, esta tabela garante idempotência:
 * uma linha por `(household_id, briefing_date)` (dia em Europe/Lisbon). Guarda
 * o texto sintetizado para replay/auditoria.
 *
 * Multi-tenancy (NFR5): `household_id` com FK + ON DELETE CASCADE; as 4 RLS
 * policies (SELECT/INSERT/UPDATE/DELETE) vivem em
 * `packages/db/migrations/0001_rls_policies.sql` via DO-block condicional
 * (pattern espelhado de `telegram_link` — `scripts/check-rls-coverage.ts` lê
 * APENAS 0001). A DDL da tabela vive em `0028_daily_briefing_cache.sql`.
 *
 * Trace: Story J-4 AC1/AC2/AC7.
 */
import { sql } from 'drizzle-orm';
import { pgTable, uuid, date, text, timestamp, index, unique } from 'drizzle-orm/pg-core';

import { households } from './tenancy';

export const dailyBriefingCache = pgTable(
  'daily_briefing_cache',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    /** Dia do brief em Europe/Lisbon (não UTC) — alinha com o cron TZ=Europe/Lisbon. */
    briefingDate: date('briefing_date').notNull(),
    /** Texto sintetizado enviado ao Telegram (replay/auditoria). */
    messageText: text('message_text').notNull(),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    householdDateIdx: index('daily_briefing_cache_household_date_idx').on(
      t.householdId,
      t.briefingDate,
    ),
    householdDateUnique: unique('daily_briefing_cache_household_date_unique').on(
      t.householdId,
      t.briefingDate,
    ),
  }),
);

export type DailyBriefingCache = typeof dailyBriefingCache.$inferSelect;
export type NewDailyBriefingCache = typeof dailyBriefingCache.$inferInsert;
