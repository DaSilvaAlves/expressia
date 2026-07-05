/**
 * Schema — jarvis_memories (Story M-1, epic v2 "Memória rica").
 *
 * `jarvis_memories`: memórias explícitas de TEXTO LIVRE por household — factos
 * ou preferências que o utilizador dita ao Jarvis ("lembra-te que odeio
 * reuniões antes das 10h"). O texto é guardado tal-e-qual (sem parsing/
 * estruturação). Distinta de `jarvis_facts` (key-value, em `google-oauth.ts`),
 * que fica reservada a settings estruturados como `timezone`/`brief_tone`.
 *
 * Nesta story a memória é apenas CAPTURADA e GUARDADA — usá-la num prompt
 * (M-2), no brief diário (M-3) ou esquecê-la (M-4) fica para stories seguintes.
 *
 * Multi-tenancy (NFR5): `household_id` com FK + ON DELETE CASCADE; as 4 RLS
 * policies (SELECT/INSERT/UPDATE/DELETE) são aplicadas REALMENTE na
 * `packages/db/migrations/0034_agent_intent_memorizar.sql` (junto do CREATE
 * TABLE) e duplicadas no `0001_rls_policies.sql` via DO-block condicional
 * `$rls_jarvis_memories$` (só para o gate estático `scripts/check-rls-coverage.ts`
 * as detectar — o parser lê APENAS a 0001). Ver PO-FIX-1 na story.
 *
 * `created_by_user_id` segue o padrão de `tasks.created_by_user_id`
 * (FK auth.users on delete restrict). `source` default `'explicit'` (captura
 * via chat é sempre explícita; `'inferred'` fica reservado para v2.x sem nova
 * migration).
 *
 * Trace: Story M-1 AC1, brief epic v2-memoria-rica (D1+D2), PRD-Jarvis §5/§9.
 */
import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core';

import { authUsers } from './auth';
import { households } from './tenancy';

// ─────────────────────────────────────────────────────────────────────────────
// jarvis_memories — memórias explícitas de texto livre por household
// ─────────────────────────────────────────────────────────────────────────────

export const jarvisMemories = pgTable(
  'jarvis_memories',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    /** Autor da memória (padrão `tasks.created_by_user_id`). */
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'restrict' }),
    /** Texto da memória tal-e-qual ditado pelo utilizador (sem parsing). */
    content: text('content').notNull(),
    /** Origem: `'explicit'` (chat, M-1) ou `'inferred'` (v2.x). Sem CHECK. */
    source: text('source').notNull().default('explicit'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    householdIdx: index('jarvis_memories_household_id_idx').on(t.householdId),
  }),
);

export type JarvisMemory = typeof jarvisMemories.$inferSelect;
export type NewJarvisMemory = typeof jarvisMemories.$inferInsert;
