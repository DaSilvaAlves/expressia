/**
 * Schema — Google OAuth tokens + jarvis_facts (Story J-3).
 *
 * `google_oauth_tokens`: guarda o refresh_token OAuth do Google CIFRADO
 * (AES-256-GCM — ciphertext + IV + authTag em base64). O refresh_token nunca é
 * persistido em plaintext; a chave de cifragem vive APENAS em env var
 * (`OAUTH_TOKEN_ENCRYPTION_KEY`), nunca na DB. Um token por
 * `(household_id, user_id)`.
 *
 * `jarvis_facts`: factos simples key-value por household (ex.: `user_name`,
 * `timezone`, `brief_tone`). Um facto por `(household_id, key)` — upsert por
 * chave.
 *
 * Multi-tenancy (NFR5): `household_id` com FK + ON DELETE CASCADE; as 4 RLS
 * policies por tabela (SELECT/INSERT/UPDATE/DELETE) vivem em
 * `packages/db/migrations/0001_rls_policies.sql` via DO-block condicional
 * (pattern espelhado de `telegram_link` — `scripts/check-rls-coverage.ts` lê
 * APENAS 0001 como fonte de verdade do gate). A DDL das tabelas + triggers vive
 * em `packages/db/migrations/0029_google_oauth_jarvis_facts.sql`.
 *
 * Trace: Story J-3 AC2/AC3/AC4, PRD-Jarvis §4.4/§6 (FR-J9/FR-J10).
 */
import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, timestamp, index, unique } from 'drizzle-orm/pg-core';

import { authUsers } from './auth';
import { households } from './tenancy';

// ─────────────────────────────────────────────────────────────────────────────
// google_oauth_tokens — refresh_token OAuth Google cifrado (AES-256-GCM)
// ─────────────────────────────────────────────────────────────────────────────

export const googleOauthTokens = pgTable(
  'google_oauth_tokens',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    /** refresh_token OAuth cifrado AES-256-GCM (ciphertext em base64). */
    encryptedRefreshToken: text('encrypted_refresh_token').notNull(),
    /** IV AES-GCM em base64 — 12 bytes / 96 bits, aleatório por cifração. */
    tokenIv: text('token_iv').notNull(),
    /** Authentication tag GCM em base64 — 16 bytes / 128 bits (integridade). */
    tokenAuthTag: text('token_auth_tag').notNull(),
    /** Últimos 6 chars do access_token (debug) — NUNCA o token completo. */
    accessTokenHint: text('access_token_hint'),
    tokenExpiry: timestamp('token_expiry', { withTimezone: true }),
    /** Email da conta Google autorizada — referência para o utilizador. */
    googleEmail: text('google_email'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    householdIdx: index('google_oauth_tokens_household_id_idx').on(t.householdId),
    householdUserUnique: unique('google_oauth_tokens_household_user_unique').on(
      t.householdId,
      t.userId,
    ),
  }),
);

export type GoogleOauthToken = typeof googleOauthTokens.$inferSelect;
export type NewGoogleOauthToken = typeof googleOauthTokens.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// jarvis_facts — factos key-value por household
// ─────────────────────────────────────────────────────────────────────────────

export const jarvisFacts = pgTable(
  'jarvis_facts',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    /** Chave do facto — ex.: `user_name`, `timezone`, `brief_tone`. */
    key: text('key').notNull(),
    /** Valor do facto (texto livre). */
    value: text('value').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    householdIdx: index('jarvis_facts_household_id_idx').on(t.householdId),
    householdKeyUnique: unique('jarvis_facts_household_key_unique').on(t.householdId, t.key),
  }),
);

export type JarvisFact = typeof jarvisFacts.$inferSelect;
export type NewJarvisFact = typeof jarvisFacts.$inferInsert;
