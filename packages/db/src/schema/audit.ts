/**
 * Schema — Audit log + GDPR jobs + sistema.
 *
 * Trace: PRD NFR9 (audit), FR28-29 (GDPR), architecture §12.4.
 *
 * `audit_log` é APPEND-ONLY: triggers em migrations RLS revogam UPDATE/DELETE
 * para o role `authenticated`. Apenas service_role pode purge após retenção 12m.
 */
import { sql } from 'drizzle-orm';
import {
  pgEnum,
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
  boolean,
} from 'drizzle-orm/pg-core';

import { authUsers } from '@/schema/auth';
import { households } from '@/schema/tenancy';

// ─────────────────────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────────────────────

export const auditActionEnum = pgEnum('audit_action', [
  // Auth
  'login',
  'logout',
  'password_change',
  'mfa_enabled',
  'mfa_disabled',
  // Billing
  'plan_changed',
  'invoice_paid',
  'payment_failed',
  // GDPR
  'data_export_requested',
  'data_export_completed',
  'account_deletion_requested',
  'account_deletion_canceled',
  'account_deletion_executed',
  // Household
  'household_created',
  'household_invite_sent',
  'household_invite_accepted',
  'household_invite_revoked',
  'household_member_removed',
  'household_role_changed',
  // Agent
  'agent_run_executed',
  'agent_run_reverted',
]);

export const dataExportStatusEnum = pgEnum('data_export_status', [
  'pending',
  'generating',
  'ready',
  'expired',
  'failed',
]);

export const accountDeletionStatusEnum = pgEnum('account_deletion_status', [
  'scheduled',
  'canceled',
  'in_progress',
  'completed',
  'failed',
]);

// ─────────────────────────────────────────────────────────────────────────────
// audit_log — append-only (NFR9)
// ─────────────────────────────────────────────────────────────────────────────

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    householdId: uuid('household_id').references(() => households.id, {
      onDelete: 'cascade',
    }),
    userId: uuid('user_id').references(() => authUsers.id, { onDelete: 'set null' }),
    action: auditActionEnum('action').notNull(),
    entityTable: text('entity_table'),
    entityId: uuid('entity_id'),
    /** Estado anterior (para rectificação/auditoria). */
    beforeState: jsonb('before_state'),
    /** Estado novo. */
    afterState: jsonb('after_state'),
    /** IP do cliente (anonimizado /24 ou /48 se desejado em handler). */
    ip: text('ip'),
    userAgent: text('user_agent'),
    /** Trace ID OTel para correlation. */
    traceId: text('trace_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    householdIdx: index('audit_log_household_idx').on(t.householdId),
    userIdx: index('audit_log_user_idx').on(t.userId),
    actionIdx: index('audit_log_action_idx').on(t.action, t.createdAt.desc()),
    entityIdx: index('audit_log_entity_idx').on(t.entityTable, t.entityId),
    createdAtIdx: index('audit_log_created_at_idx').on(t.createdAt.desc()),
  }),
);

export type AuditLog = typeof auditLog.$inferSelect;
export type NewAuditLog = typeof auditLog.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// data_export_jobs — GDPR Art. 20 (FR28)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Job de export de dados — Inngest function processa async.
 * Output ZIP fica em Supabase Storage com signed URL válido 24h.
 */
export const dataExportJobs = pgTable(
  'data_export_jobs',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    requestedByUserId: uuid('requested_by_user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    status: dataExportStatusEnum('status').notNull().default('pending'),
    /** Path no Supabase Storage (`exports/{household_id}/{job_id}.zip`). */
    storagePath: text('storage_path'),
    /** Signed URL temporário (24h). */
    downloadUrl: text('download_url'),
    /** Expira o link às 24h. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    householdIdx: index('data_export_jobs_household_idx').on(t.householdId),
    statusIdx: index('data_export_jobs_status_idx').on(t.status),
  }),
);

export type DataExportJob = typeof dataExportJobs.$inferSelect;
export type NewDataExportJob = typeof dataExportJobs.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// account_deletion_jobs — GDPR Art. 17 (FR29)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Eliminação de conta agendada para 30 dias após pedido (revogável até execução).
 * Inngest function `gdpr-purge` executa após `scheduled_for`.
 */
export const accountDeletionJobs = pgTable(
  'account_deletion_jobs',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    requestedByUserId: uuid('requested_by_user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    status: accountDeletionStatusEnum('status').notNull().default('scheduled'),
    /** 30 dias após `created_at`. */
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }).notNull(),
    canceledAt: timestamp('canceled_at', { withTimezone: true }),
    canceledByUserId: uuid('canceled_by_user_id').references(() => authUsers.id, {
      onDelete: 'set null',
    }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    householdIdx: index('account_deletion_jobs_household_idx').on(t.householdId),
    scheduledIdx: index('account_deletion_jobs_scheduled_idx').on(t.scheduledFor, t.status),
  }),
);

export type AccountDeletionJob = typeof accountDeletionJobs.$inferSelect;
export type NewAccountDeletionJob = typeof accountDeletionJobs.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// feature_flags — sistema simples DB-backed (architecture §4.4)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Feature flags por household. Cada household pode ter overrides; default vem do plano.
 */
export const featureFlags = pgTable(
  'feature_flags',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    /** NULL = flag global (default). */
    householdId: uuid('household_id').references(() => households.id, {
      onDelete: 'cascade',
    }),
    flagKey: text('flag_key').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    /** Razão / contexto para auditoria. */
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    householdIdx: index('feature_flags_household_idx').on(t.householdId),
    flagIdx: index('feature_flags_flag_idx').on(t.flagKey),
  }),
);

export type FeatureFlag = typeof featureFlags.$inferSelect;
export type NewFeatureFlag = typeof featureFlags.$inferInsert;
