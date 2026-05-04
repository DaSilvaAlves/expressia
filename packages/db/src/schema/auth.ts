/**
 * Schema — Auth (referência a `auth.users` do Supabase).
 *
 * `auth.users` é gerido por Supabase Auth (não criamos nem alteramos a sua DDL).
 * Aqui só declaramos uma referência mínima para FK type-safety em Drizzle.
 *
 * Trace: PRD FR24 (registo), architecture §5.1 (Supabase Auth), ADR-002.
 */
import { pgSchema, uuid, timestamp, text } from 'drizzle-orm/pg-core';

/**
 * Schema `auth` é gerido pelo Supabase Auth.
 * Drizzle apenas referencia `auth.users.id` para FKs em
 * `household_members`, `tasks.created_by`, `transactions.created_by`, etc.
 */
export const authSchema = pgSchema('auth');

/**
 * Tabela espelho mínima de `auth.users` — APENAS para tipagem das FKs.
 * Não gerar migração: ficheiro `tablesFilter` em drizzle.config.ts ignora `auth.*`.
 *
 * Os campos abaixo são um sub-conjunto do que o Supabase Auth cria;
 * outros (encrypted_password, raw_user_meta_data, etc.) existem em runtime
 * mas não são necessários para a nossa lógica de domínio.
 */
export const authUsers = authSchema.table('users', {
  id: uuid('id').primaryKey(),
  email: text('email'),
  createdAt: timestamp('created_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
});

export type AuthUser = typeof authUsers.$inferSelect;
