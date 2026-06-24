/**
 * Schema — Telegram (mapeamento de identidade `chat_id` → household + user).
 *
 * Story J-2 — o webhook do Telegram não tem sessão Supabase (JWT). A resolução
 * de identidade `chat_id` → `{ userId, householdId }` faz-se via esta tabela de
 * mapeamento, lida com `getServiceDb()` (uso legítimo SEC-10 — resolve
 * identidade fora de sessão HTTP, não dados de domínio).
 *
 * Multi-tenancy (CON2 / NFR5): `household_id` com FK + ON DELETE CASCADE; as 4
 * RLS policies (SELECT/INSERT/UPDATE/DELETE) vivem em
 * `packages/db/migrations/0001_rls_policies.sql` via DO-block condicional
 * (pattern espelhado de `user_prefs` — `scripts/check-rls-coverage.ts` lê
 * APENAS 0001 como fonte de verdade do gate). A DDL da tabela + trigger vive em
 * `packages/db/migrations/0027_telegram_link.sql`.
 *
 * Trace: Story J-2 AC1/AC2/AC3, PRD-Jarvis §4.8, architecture §3.2.
 */
import { sql } from 'drizzle-orm';
import { pgTable, uuid, bigint, timestamp, index } from 'drizzle-orm/pg-core';

import { authUsers } from './auth';
import { households } from './tenancy';

// ─────────────────────────────────────────────────────────────────────────────
// telegram_link — mapeamento chat_id ↔ identidade (household + user)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Telegram link — uma linha por `chat_id` autorizado. Resolve a identidade do
 * utilizador a partir do `chat_id` do Telegram (que substitui a allowlist
 * env-var `TELEGRAM_ALLOWED_CHAT_ID` de J-1).
 *
 * O `chat_id` é `bigint` (os IDs do Telegram podem exceder o range de `integer`)
 * e tem unicidade garantida por constraint `unique`.
 */
export const telegramLink = pgTable(
  'telegram_link',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    /** `chat_id` do Telegram — único; bigint cobre o range completo dos IDs. */
    chatId: bigint('chat_id', { mode: 'number' }).notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    householdIdx: index('telegram_link_household_id_idx').on(t.householdId),
  }),
);

export type TelegramLink = typeof telegramLink.$inferSelect;
export type NewTelegramLink = typeof telegramLink.$inferInsert;
