/**
 * Fixture helpers — funções específicas de domínio para inserir dados de teste
 * via cliente admin (sem RLS).
 *
 * Convenção: cada helper aceita o `householdId` e devolve o UUID da entidade criada
 * para que o teste possa referenciar nas asserções RLS posteriores.
 *
 * Trace: Story 1.4 AC10 (documentação de padrões para futuros testes).
 */
import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';

import { getRlsHarness, type QuerySql } from '@/rls-harness';

// ─────────────────────────────────────────────────────────────────────────────
// Wrappers que aceitam connection custom (admin OU transactional via asUser)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Insere uma kanban_column. Devolve o id criado.
 */
export async function insertKanbanColumn(
  sql: QuerySql,
  householdId: string,
  overrides: { name?: string; sortOrder?: number } = {},
): Promise<string> {
  const id = randomUUID();
  const name = overrides.name ?? `Coluna ${randomUUID().slice(0, 8)}`;
  const sortOrder = overrides.sortOrder ?? Math.floor(Math.random() * 100_000);
  await sql`
    insert into public.kanban_columns (id, household_id, name, sort_order)
    values (${id}, ${householdId}, ${name}, ${sortOrder})
  `;
  return id;
}

/**
 * Insere uma task. Devolve o id criado.
 */
export async function insertTask(
  sql: QuerySql,
  householdId: string,
  createdByUserId: string,
  overrides: { title?: string } = {},
): Promise<string> {
  const id = randomUUID();
  const title = overrides.title ?? 'Tarefa de teste';
  await sql`
    insert into public.tasks (id, household_id, created_by_user_id, title)
    values (${id}, ${householdId}, ${createdByUserId}, ${title})
  `;
  return id;
}

/**
 * Insere uma task_recurrence (precisa de uma task template existente).
 */
export async function insertTaskRecurrence(
  sql: QuerySql,
  householdId: string,
  templateTaskId: string,
): Promise<string> {
  const id = randomUUID();
  await sql`
    insert into public.task_recurrences (id, household_id, template_task_id, frequency, starts_on)
    values (${id}, ${householdId}, ${templateTaskId}, 'weekly', '2026-01-01'::date)
  `;
  return id;
}

/**
 * Insere uma tag.
 */
export async function insertTag(
  sql: QuerySql,
  householdId: string,
  name = `Tag ${randomUUID().slice(0, 6)}`,
): Promise<string> {
  const id = randomUUID();
  await sql`
    insert into public.tags (id, household_id, name)
    values (${id}, ${householdId}, ${name})
  `;
  return id;
}

/**
 * Insere uma associação task_tags. PK composta (task_id, tag_id).
 */
export async function insertTaskTag(
  sql: QuerySql,
  taskId: string,
  tagId: string,
  householdId: string,
): Promise<void> {
  await sql`
    insert into public.task_tags (task_id, tag_id, household_id)
    values (${taskId}, ${tagId}, ${householdId})
  `;
}

/**
 * Insere uma account. Devolve o id criado.
 */
export async function insertAccount(
  sql: QuerySql,
  householdId: string,
  overrides: { name?: string } = {},
): Promise<string> {
  const id = randomUUID();
  const name = overrides.name ?? `Conta ${randomUUID().slice(0, 6)}`;
  await sql`
    insert into public.accounts (id, household_id, name)
    values (${id}, ${householdId}, ${name})
  `;
  return id;
}

/**
 * Insere um card. Devolve o id criado.
 */
export async function insertCard(
  sql: QuerySql,
  householdId: string,
  accountId: string,
  overrides: { name?: string } = {},
): Promise<string> {
  const id = randomUUID();
  const name = overrides.name ?? 'Cartão crédito';
  // Cartões credit precisam de credit_limit_cents.
  await sql`
    insert into public.cards (id, household_id, account_id, name, card_type, credit_limit_cents)
    values (${id}, ${householdId}, ${accountId}, ${name}, 'credit', 500000)
  `;
  return id;
}

/**
 * Insere uma category per-household (não default).
 */
export async function insertCategory(
  sql: QuerySql,
  householdId: string,
  name = `Cat ${randomUUID().slice(0, 6)}`,
): Promise<string> {
  const id = randomUUID();
  await sql`
    insert into public.categories (id, household_id, name, is_default, kind)
    values (${id}, ${householdId}, ${name}, false, 'expense')
  `;
  return id;
}

/**
 * Insere uma recurrence financeira.
 */
export async function insertRecurrence(
  sql: QuerySql,
  householdId: string,
  createdByUserId: string,
  accountId: string,
): Promise<string> {
  const id = randomUUID();
  await sql`
    insert into public.recurrences (
      id, household_id, created_by_user_id, description, kind, amount_cents,
      account_id, payment_method, frequency, starts_on
    )
    values (
      ${id}, ${householdId}, ${createdByUserId}, 'Recorrência teste', 'expense', 1500,
      ${accountId}, 'transfer', 'monthly', '2026-01-01'::date
    )
  `;
  return id;
}

/**
 * Insere uma installment (compra parcelada). Precisa de card existente.
 */
export async function insertInstallment(
  sql: QuerySql,
  householdId: string,
  createdByUserId: string,
  cardId: string,
): Promise<string> {
  const id = randomUUID();
  await sql`
    insert into public.installments (
      id, household_id, created_by_user_id, card_id, description,
      total_amount_cents, num_installments, per_installment_cents,
      purchased_on, first_installment_on
    )
    values (
      ${id}, ${householdId}, ${createdByUserId}, ${cardId}, 'Parcelada teste',
      120000, 12, 10000,
      '2026-01-15'::date, '2026-02-15'::date
    )
  `;
  return id;
}

/**
 * Insere uma transaction. Precisa de account ou card.
 */
export async function insertTransaction(
  sql: QuerySql,
  householdId: string,
  createdByUserId: string,
  accountId: string,
): Promise<string> {
  const id = randomUUID();
  await sql`
    insert into public.transactions (
      id, household_id, created_by_user_id, account_id,
      amount_cents, kind, description, transaction_date, payment_method
    )
    values (
      ${id}, ${householdId}, ${createdByUserId}, ${accountId},
      8870, 'expense', 'Transacção teste', '2026-05-01'::date, 'card'
    )
  `;
  return id;
}

/**
 * Insere um agent_run. Devolve o id criado.
 */
export async function insertAgentRun(
  sql: QuerySql,
  householdId: string,
  userId: string,
): Promise<string> {
  const id = randomUUID();
  await sql`
    insert into public.agent_runs (
      id, household_id, user_id, prompt_text, prompt_hash,
      intents_detected, confidence
    )
    values (
      ${id}, ${householdId}, ${userId}, 'Cria uma tarefa', 'hash-test',
      '[]'::jsonb, 0.95
    )
  `;
  return id;
}

/**
 * Insere uma intent_classification associada a um agent_run.
 */
export async function insertIntentClassification(
  sql: QuerySql,
  householdId: string,
  agentRunId: string,
): Promise<string> {
  const id = randomUUID();
  await sql`
    insert into public.intent_classifications (
      id, agent_run_id, household_id, intent, confidence, params
    )
    values (
      ${id}, ${agentRunId}, ${householdId}, 'criar_tarefa', 0.92, '{}'::jsonb
    )
  `;
  return id;
}

/**
 * Insere uma agent_reverse_op (FR6 — undo 30s).
 */
export async function insertAgentReverseOp(
  sql: QuerySql,
  householdId: string,
  agentRunId: string,
): Promise<string> {
  const id = randomUUID();
  await sql`
    insert into public.agent_reverse_ops (
      id, agent_run_id, household_id, reverse_op, expires_at
    )
    values (
      ${id}, ${agentRunId}, ${householdId},
      '{"kind":"delete_row","table":"tasks","id":"00000000-0000-0000-0000-000000000000"}'::jsonb,
      now() + interval '30 seconds'
    )
  `;
  return id;
}

/**
 * Insere uma agent_quota (PK = household_id, logo é unique).
 */
export async function insertAgentQuota(sql: QuerySql, householdId: string): Promise<void> {
  await sql`
    insert into public.agent_quotas (
      household_id, plan, period_start, period_end
    )
    values (
      ${householdId}, 'familia',
      '2026-05-01T00:00:00Z'::timestamptz,
      '2026-06-01T00:00:00Z'::timestamptz
    )
  `;
}

/**
 * Insere uma subscription (PK unique por household).
 */
export async function insertSubscription(sql: QuerySql, householdId: string): Promise<string> {
  const id = randomUUID();
  await sql`
    insert into public.subscriptions (
      id, household_id, stripe_subscription_id, plan, status
    )
    values (
      ${id}, ${householdId}, ${'sub_' + randomUUID().slice(0, 12)},
      'familia', 'active'
    )
  `;
  return id;
}

/**
 * Insere um payment_method.
 */
export async function insertPaymentMethod(sql: QuerySql, householdId: string): Promise<string> {
  const id = randomUUID();
  await sql`
    insert into public.payment_methods (
      id, household_id, stripe_payment_method_id, type
    )
    values (
      ${id}, ${householdId}, ${'pm_' + randomUUID().slice(0, 12)}, 'card'
    )
  `;
  return id;
}

/**
 * Insere uma invoice.
 */
export async function insertInvoice(sql: QuerySql, householdId: string): Promise<string> {
  const id = randomUUID();
  await sql`
    insert into public.invoices (
      id, household_id, stripe_invoice_id, status, amount_cents
    )
    values (
      ${id}, ${householdId}, ${'in_' + randomUUID().slice(0, 12)}, 'paid', 888
    )
  `;
  return id;
}

/**
 * Insere uma audit_log row.
 */
export async function insertAuditLog(
  sql: QuerySql,
  householdId: string,
  userId: string,
): Promise<string> {
  const id = randomUUID();
  await sql`
    insert into public.audit_log (
      id, household_id, user_id, action
    )
    values (
      ${id}, ${householdId}, ${userId}, 'login'
    )
  `;
  return id;
}

/**
 * Insere um household_invite.
 */
export async function insertHouseholdInvite(
  sql: QuerySql,
  householdId: string,
  invitedByUserId: string,
  email = `convidado-${randomUUID().slice(0, 6)}@meu-jarvis.test`,
): Promise<string> {
  const id = randomUUID();
  await sql`
    insert into public.household_invites (
      id, household_id, invited_by_user_id, email, token, expires_at
    )
    values (
      ${id}, ${householdId}, ${invitedByUserId}, ${email},
      ${'tok_' + randomUUID()},
      now() + interval '7 days'
    )
  `;
  return id;
}

/**
 * Insere um data_export_job.
 */
export async function insertDataExportJob(
  sql: QuerySql,
  householdId: string,
  requestedByUserId: string,
): Promise<string> {
  const id = randomUUID();
  await sql`
    insert into public.data_export_jobs (
      id, household_id, requested_by_user_id
    )
    values (
      ${id}, ${householdId}, ${requestedByUserId}
    )
  `;
  return id;
}

/**
 * Insere um account_deletion_job.
 */
export async function insertAccountDeletionJob(
  sql: QuerySql,
  householdId: string,
  requestedByUserId: string,
): Promise<string> {
  const id = randomUUID();
  await sql`
    insert into public.account_deletion_jobs (
      id, household_id, requested_by_user_id, scheduled_for
    )
    values (
      ${id}, ${householdId}, ${requestedByUserId},
      now() + interval '30 days'
    )
  `;
  return id;
}

/**
 * Insere um feature_flag (suporta global se householdId === null).
 */
export async function insertFeatureFlag(
  sql: QuerySql,
  householdId: string | null,
  flagKey = `flag_${randomUUID().slice(0, 6)}`,
): Promise<string> {
  const id = randomUUID();
  if (householdId === null) {
    await sql`
      insert into public.feature_flags (id, flag_key, enabled)
      values (${id}, ${flagKey}, true)
    `;
  } else {
    await sql`
      insert into public.feature_flags (id, household_id, flag_key, enabled)
      values (${id}, ${householdId}, ${flagKey}, true)
    `;
  }
  return id;
}

/**
 * Insere user_prefs para um utilizador (Story 5.1 T4 — PO_FIX_INLINE F2).
 * Devolve o user_id da row criada (1:1 user — userId é PK).
 *
 * Por defeito grava com `theme='dark'` para tornar evidente em testes
 * que o valor não é o default (`'system'`). Overrides permitem testar
 * defaults SQL aplicados pela migration 0016.
 */
export async function insertUserPrefs(
  sql: QuerySql,
  userId: string,
  householdId: string,
  overrides: {
    alwaysPreview?: boolean;
    theme?: 'light' | 'dark' | 'system';
    widgetsEnabled?: Record<string, boolean>;
    useDefaults?: boolean;
  } = {},
): Promise<string> {
  if (overrides.useDefaults) {
    // INSERT sem valores explícitos para as colunas opcionais —
    // testa que defaults SQL (always_preview=false, theme='system',
    // widgets_enabled=JSONB literal) são aplicados pela migration.
    await sql`
      insert into public.user_prefs (user_id, household_id)
      values (${userId}, ${householdId})
    `;
    return userId;
  }
  const alwaysPreview = overrides.alwaysPreview ?? false;
  const theme = overrides.theme ?? 'dark';
  const widgetsEnabled = overrides.widgetsEnabled ?? {
    briefing: true,
    tasks_today: true,
    finance_month: false,
    recurrences_next: false,
    tasks_overdue: false,
    accounts_balance: true,
    calendar_week: true,
  };
  await sql`
    insert into public.user_prefs (user_id, household_id, always_preview, theme, widgets_enabled)
    values (
      ${userId},
      ${householdId},
      ${alwaysPreview},
      ${theme},
      ${JSON.stringify(widgetsEnabled)}::jsonb
    )
  `;
  return userId;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers admin-only (alguns testes querem a admin connection directamente)
// ─────────────────────────────────────────────────────────────────────────────

/** Devolve o cliente admin do harness (sem RLS). Atalho para testes que não usam asUser(). */
export function admin(): Sql {
  return getRlsHarness().adminSql;
}
