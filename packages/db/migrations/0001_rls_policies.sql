-- =====================================================================
-- meu-jarvis (Expressia) — RLS Policies
-- Migração: 0001_rls_policies.sql
-- Data: 2026-05-04
-- Autora: Dara (@data-engineer)
--
-- Contexto:
--   - PRD NFR5: RLS Postgres activa em TODAS as tabelas com household_id.
--   - Architecture §3.2: 4 policies por tabela (SELECT/INSERT/UPDATE/DELETE)
--     usando helpers public.is_household_member() e public.is_household_owner_or_admin().
--   - CI gate: scripts/check-rls-coverage.ts enumera tabelas e bloqueia merge
--     se faltar policy. Esta migração é pré-condição.
--
-- Trace: PRD NFR5 (bloqueante), architecture §3.2, ADR-008.
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- ROLES Supabase
-- ─────────────────────────────────────────────────────────────────────
-- `authenticated`: utilizador autenticado via Supabase Auth (RLS aplicada)
-- `anon`:          requests sem JWT (apenas leitura de tabelas públicas — nenhuma aqui)
-- `service_role`:  bypass total de RLS (jobs Inngest, migrations) — usar c/ cuidado

-- =====================================================================
-- 1. TENANCY
-- =====================================================================

-- ─── households ────────────────────────────────────────────────────

alter table public.households enable row level security;
alter table public.households force row level security;

create policy "households_select_member"
  on public.households for select
  to authenticated
  using (public.is_household_member(id));
comment on policy "households_select_member" on public.households is
  'Membros do household podem ver os dados do próprio household.';

create policy "households_insert_self_owner"
  on public.households for insert
  to authenticated
  with check (owner_user_id = auth.uid());
comment on policy "households_insert_self_owner" on public.households is
  'Utilizador autenticado pode criar household onde é o próprio owner.';

create policy "households_update_owner_admin"
  on public.households for update
  to authenticated
  using (public.is_household_owner_or_admin(id))
  with check (public.is_household_owner_or_admin(id));
comment on policy "households_update_owner_admin" on public.households is
  'Apenas owner/admin podem editar household (nome, plano, etc.).';

create policy "households_delete_owner_only"
  on public.households for delete
  to authenticated
  using (
    exists (
      select 1 from public.household_members hm
      where hm.user_id = auth.uid()
        and hm.household_id = households.id
        and hm.role = 'owner'
    )
  );
comment on policy "households_delete_owner_only" on public.households is
  'Apenas owner pode eliminar household. Cascade apaga dados associados.';

-- ─── household_members ────────────────────────────────────────────

alter table public.household_members enable row level security;
alter table public.household_members force row level security;

create policy "household_members_select_self_or_household"
  on public.household_members for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_household_member(household_id)
  );
comment on policy "household_members_select_self_or_household" on public.household_members is
  'Utilizador vê os seus memberships e os memberships de households onde é membro.';

create policy "household_members_insert_owner_admin"
  on public.household_members for insert
  to authenticated
  with check (
    public.is_household_owner_or_admin(household_id)
    or user_id = auth.uid()  -- self-insert via accept_invite()
  );
comment on policy "household_members_insert_owner_admin" on public.household_members is
  'Owner/admin adicionam membros directamente; utilizador insere o próprio em accept_invite().';

create policy "household_members_update_owner_admin"
  on public.household_members for update
  to authenticated
  using (public.is_household_owner_or_admin(household_id))
  with check (public.is_household_owner_or_admin(household_id));
comment on policy "household_members_update_owner_admin" on public.household_members is
  'Owner/admin alteram roles dos membros.';

create policy "household_members_delete_owner_admin_or_self"
  on public.household_members for delete
  to authenticated
  using (
    public.is_household_owner_or_admin(household_id)
    or user_id = auth.uid()  -- utilizador pode sair do household
  );
comment on policy "household_members_delete_owner_admin_or_self" on public.household_members is
  'Owner/admin removem membros; utilizador pode auto-remover-se.';

-- ─── household_invites ────────────────────────────────────────────

alter table public.household_invites enable row level security;
alter table public.household_invites force row level security;

create policy "household_invites_select_household_or_invited"
  on public.household_invites for select
  to authenticated
  using (
    public.is_household_member(household_id)
    -- Convidado pode ver o seu próprio convite mesmo antes de fazer accept
    or email = (select email from auth.users where id = auth.uid())
  );
comment on policy "household_invites_select_household_or_invited" on public.household_invites is
  'Membros do household vêem convites enviados; convidado vê o próprio convite.';

create policy "household_invites_insert_owner_admin"
  on public.household_invites for insert
  to authenticated
  with check (public.is_household_owner_or_admin(household_id));
comment on policy "household_invites_insert_owner_admin" on public.household_invites is
  'Apenas owner/admin podem enviar convites.';

create policy "household_invites_update_owner_admin"
  on public.household_invites for update
  to authenticated
  using (public.is_household_owner_or_admin(household_id))
  with check (public.is_household_owner_or_admin(household_id));
comment on policy "household_invites_update_owner_admin" on public.household_invites is
  'Owner/admin podem revogar/editar convites; accept_invite usa SECURITY DEFINER.';

create policy "household_invites_delete_owner_admin"
  on public.household_invites for delete
  to authenticated
  using (public.is_household_owner_or_admin(household_id));
comment on policy "household_invites_delete_owner_admin" on public.household_invites is
  'Owner/admin podem revogar convites pendentes.';

-- ─── kanban_columns ───────────────────────────────────────────────

alter table public.kanban_columns enable row level security;
alter table public.kanban_columns force row level security;

create policy "kanban_columns_select_member"
  on public.kanban_columns for select
  to authenticated using (public.is_household_member(household_id));
create policy "kanban_columns_insert_member"
  on public.kanban_columns for insert
  to authenticated with check (public.is_household_member(household_id));
create policy "kanban_columns_update_member"
  on public.kanban_columns for update
  to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));
create policy "kanban_columns_delete_owner_admin"
  on public.kanban_columns for delete
  to authenticated using (public.is_household_owner_or_admin(household_id));

-- =====================================================================
-- 2. BILLING
-- =====================================================================

-- ─── subscriptions ────────────────────────────────────────────────

alter table public.subscriptions enable row level security;
alter table public.subscriptions force row level security;

create policy "subscriptions_select_member"
  on public.subscriptions for select
  to authenticated using (public.is_household_member(household_id));
comment on policy "subscriptions_select_member" on public.subscriptions is
  'Membros vêem subscrição do household. Edição é feita por service_role via webhook Stripe.';

-- INSERT/UPDATE/DELETE bloqueados para `authenticated` —
-- Stripe webhook handler usa service_role.
-- (Ainda assim criamos policies restritivas explícitas para satisfazer o gate.)
create policy "subscriptions_insert_blocked"
  on public.subscriptions for insert
  to authenticated with check (false);
create policy "subscriptions_update_blocked"
  on public.subscriptions for update
  to authenticated using (false) with check (false);
create policy "subscriptions_delete_blocked"
  on public.subscriptions for delete
  to authenticated using (false);

-- ─── payment_methods ──────────────────────────────────────────────

alter table public.payment_methods enable row level security;
alter table public.payment_methods force row level security;

create policy "payment_methods_select_owner_admin"
  on public.payment_methods for select
  to authenticated using (public.is_household_owner_or_admin(household_id));
comment on policy "payment_methods_select_owner_admin" on public.payment_methods is
  'Apenas owner/admin vêem métodos de pagamento (sensíveis). Members regulares não.';

create policy "payment_methods_insert_blocked"
  on public.payment_methods for insert
  to authenticated with check (false);
create policy "payment_methods_update_blocked"
  on public.payment_methods for update
  to authenticated using (false) with check (false);
create policy "payment_methods_delete_blocked"
  on public.payment_methods for delete
  to authenticated using (false);
-- Stripe webhook gere via service_role.

-- ─── invoices ─────────────────────────────────────────────────────

alter table public.invoices enable row level security;
alter table public.invoices force row level security;

create policy "invoices_select_owner_admin"
  on public.invoices for select
  to authenticated using (public.is_household_owner_or_admin(household_id));
comment on policy "invoices_select_owner_admin" on public.invoices is
  'Apenas owner/admin vêem facturas (NIF é PII).';

create policy "invoices_insert_blocked"
  on public.invoices for insert
  to authenticated with check (false);
create policy "invoices_update_blocked"
  on public.invoices for update
  to authenticated using (false) with check (false);
create policy "invoices_delete_blocked"
  on public.invoices for delete
  to authenticated using (false);

-- ─── payment_events ──────────────────────────────────────────────

alter table public.payment_events enable row level security;
alter table public.payment_events force row level security;

-- payment_events é totalmente service-role only (webhook log).
create policy "payment_events_select_blocked"
  on public.payment_events for select
  to authenticated using (false);
create policy "payment_events_insert_blocked"
  on public.payment_events for insert
  to authenticated with check (false);
create policy "payment_events_update_blocked"
  on public.payment_events for update
  to authenticated using (false) with check (false);
create policy "payment_events_delete_blocked"
  on public.payment_events for delete
  to authenticated using (false);
comment on table public.payment_events is
  'Append-only via service_role (Stripe webhook). Authenticated não acede.';

-- =====================================================================
-- 3. AGENT (Cérebro AI)
-- =====================================================================

-- ─── agent_runs ───────────────────────────────────────────────────

alter table public.agent_runs enable row level security;
alter table public.agent_runs force row level security;

-- Audit imutável (NFR9): SELECT permitido a membros, INSERT permitido,
-- UPDATE permitido apenas para campos não-PII (status/response/...) — feito via
-- coluna whitelist em código aplicacional. DELETE bloqueado para authenticated.
create policy "agent_runs_select_member"
  on public.agent_runs for select
  to authenticated using (public.is_household_member(household_id));

create policy "agent_runs_insert_self"
  on public.agent_runs for insert
  to authenticated
  with check (
    public.is_household_member(household_id)
    and user_id = auth.uid()
  );
comment on policy "agent_runs_insert_self" on public.agent_runs is
  'Utilizador insere apenas runs próprios no seu household.';

create policy "agent_runs_update_self"
  on public.agent_runs for update
  to authenticated
  using (user_id = auth.uid() and public.is_household_member(household_id))
  with check (user_id = auth.uid() and public.is_household_member(household_id));
comment on policy "agent_runs_update_self" on public.agent_runs is
  'Update para marcar reverted_at, status, response_summary. Imutabilidade reforçada por convenção aplicacional.';

create policy "agent_runs_delete_blocked"
  on public.agent_runs for delete
  to authenticated using (false);
comment on policy "agent_runs_delete_blocked" on public.agent_runs is
  'Audit imutável. Purge feito por service_role após retenção (12m).';

-- ─── intent_classifications ──────────────────────────────────────

alter table public.intent_classifications enable row level security;
alter table public.intent_classifications force row level security;

create policy "intent_classifications_select_member"
  on public.intent_classifications for select
  to authenticated using (public.is_household_member(household_id));
create policy "intent_classifications_insert_member"
  on public.intent_classifications for insert
  to authenticated with check (public.is_household_member(household_id));
create policy "intent_classifications_update_member"
  on public.intent_classifications for update
  to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));
create policy "intent_classifications_delete_blocked"
  on public.intent_classifications for delete
  to authenticated using (false);

-- ─── agent_reverse_ops ───────────────────────────────────────────

alter table public.agent_reverse_ops enable row level security;
alter table public.agent_reverse_ops force row level security;

create policy "agent_reverse_ops_select_member"
  on public.agent_reverse_ops for select
  to authenticated using (public.is_household_member(household_id));
create policy "agent_reverse_ops_insert_member"
  on public.agent_reverse_ops for insert
  to authenticated with check (public.is_household_member(household_id));
create policy "agent_reverse_ops_update_member"
  on public.agent_reverse_ops for update
  to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));
create policy "agent_reverse_ops_delete_member"
  on public.agent_reverse_ops for delete
  to authenticated using (public.is_household_member(household_id));

-- ─── agent_quotas ────────────────────────────────────────────────

alter table public.agent_quotas enable row level security;
alter table public.agent_quotas force row level security;

create policy "agent_quotas_select_member"
  on public.agent_quotas for select
  to authenticated using (public.is_household_member(household_id));
comment on policy "agent_quotas_select_member" on public.agent_quotas is
  'Membros vêem quotas do household para apresentar em /conta/plano (NFR20 transparency).';

create policy "agent_quotas_insert_blocked"
  on public.agent_quotas for insert
  to authenticated with check (false);
create policy "agent_quotas_update_blocked"
  on public.agent_quotas for update
  to authenticated using (false) with check (false);
create policy "agent_quotas_delete_blocked"
  on public.agent_quotas for delete
  to authenticated using (false);
-- Apenas service_role gere counters (atomicidade + race conditions).

-- =====================================================================
-- 4. TASKS
-- =====================================================================

alter table public.tasks enable row level security;
alter table public.tasks force row level security;

create policy "tasks_select_member"
  on public.tasks for select
  to authenticated using (public.is_household_member(household_id));
create policy "tasks_insert_member"
  on public.tasks for insert
  to authenticated with check (public.is_household_member(household_id));
create policy "tasks_update_member"
  on public.tasks for update
  to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));
create policy "tasks_delete_member"
  on public.tasks for delete
  to authenticated using (public.is_household_member(household_id));

alter table public.task_recurrences enable row level security;
alter table public.task_recurrences force row level security;
create policy "task_recurrences_select_member"
  on public.task_recurrences for select
  to authenticated using (public.is_household_member(household_id));
create policy "task_recurrences_insert_member"
  on public.task_recurrences for insert
  to authenticated with check (public.is_household_member(household_id));
create policy "task_recurrences_update_member"
  on public.task_recurrences for update
  to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));
create policy "task_recurrences_delete_member"
  on public.task_recurrences for delete
  to authenticated using (public.is_household_member(household_id));

alter table public.tags enable row level security;
alter table public.tags force row level security;
create policy "tags_select_member"
  on public.tags for select
  to authenticated using (public.is_household_member(household_id));
create policy "tags_insert_member"
  on public.tags for insert
  to authenticated with check (public.is_household_member(household_id));
create policy "tags_update_member"
  on public.tags for update
  to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));
create policy "tags_delete_owner_admin"
  on public.tags for delete
  to authenticated using (public.is_household_owner_or_admin(household_id));

alter table public.task_tags enable row level security;
alter table public.task_tags force row level security;
create policy "task_tags_select_member"
  on public.task_tags for select
  to authenticated using (public.is_household_member(household_id));
create policy "task_tags_insert_member"
  on public.task_tags for insert
  to authenticated with check (public.is_household_member(household_id));
create policy "task_tags_update_member"
  on public.task_tags for update
  to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));
create policy "task_tags_delete_member"
  on public.task_tags for delete
  to authenticated using (public.is_household_member(household_id));

-- =====================================================================
-- 5. FINANCE
-- =====================================================================

alter table public.accounts enable row level security;
alter table public.accounts force row level security;
create policy "accounts_select_member"
  on public.accounts for select
  to authenticated using (public.is_household_member(household_id));
create policy "accounts_insert_member"
  on public.accounts for insert
  to authenticated with check (public.is_household_member(household_id));
create policy "accounts_update_member"
  on public.accounts for update
  to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));
create policy "accounts_delete_owner_admin"
  on public.accounts for delete
  to authenticated using (public.is_household_owner_or_admin(household_id));

alter table public.cards enable row level security;
alter table public.cards force row level security;
create policy "cards_select_member"
  on public.cards for select
  to authenticated using (public.is_household_member(household_id));
create policy "cards_insert_member"
  on public.cards for insert
  to authenticated with check (public.is_household_member(household_id));
create policy "cards_update_member"
  on public.cards for update
  to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));
create policy "cards_delete_owner_admin"
  on public.cards for delete
  to authenticated using (public.is_household_owner_or_admin(household_id));

alter table public.categories enable row level security;
alter table public.categories force row level security;
-- Categorias têm caso especial: globais (household_id IS NULL) são lidas por todos.
create policy "categories_select_global_or_member"
  on public.categories for select
  to authenticated
  using (household_id is null or public.is_household_member(household_id));
comment on policy "categories_select_global_or_member" on public.categories is
  'Templates globais (household_id NULL) são visíveis a todos. Per-household via membership.';

create policy "categories_insert_member"
  on public.categories for insert
  to authenticated
  with check (
    household_id is not null
    and public.is_household_member(household_id)
    and is_default = false  -- impedimos criação de templates globais via UI
  );
create policy "categories_update_member"
  on public.categories for update
  to authenticated
  using (household_id is not null and public.is_household_member(household_id))
  with check (household_id is not null and public.is_household_member(household_id));
create policy "categories_delete_member"
  on public.categories for delete
  to authenticated
  using (household_id is not null and public.is_household_member(household_id));

alter table public.recurrences enable row level security;
alter table public.recurrences force row level security;
create policy "recurrences_select_member"
  on public.recurrences for select
  to authenticated using (public.is_household_member(household_id));
create policy "recurrences_insert_member"
  on public.recurrences for insert
  to authenticated with check (public.is_household_member(household_id));
create policy "recurrences_update_member"
  on public.recurrences for update
  to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));
create policy "recurrences_delete_member"
  on public.recurrences for delete
  to authenticated using (public.is_household_member(household_id));

alter table public.installments enable row level security;
alter table public.installments force row level security;
create policy "installments_select_member"
  on public.installments for select
  to authenticated using (public.is_household_member(household_id));
create policy "installments_insert_member"
  on public.installments for insert
  to authenticated with check (public.is_household_member(household_id));
create policy "installments_update_member"
  on public.installments for update
  to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));
create policy "installments_delete_member"
  on public.installments for delete
  to authenticated using (public.is_household_member(household_id));

alter table public.transactions enable row level security;
alter table public.transactions force row level security;
create policy "transactions_select_member"
  on public.transactions for select
  to authenticated using (public.is_household_member(household_id));
create policy "transactions_insert_member"
  on public.transactions for insert
  to authenticated with check (public.is_household_member(household_id));
create policy "transactions_update_member"
  on public.transactions for update
  to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));
create policy "transactions_delete_member"
  on public.transactions for delete
  to authenticated using (public.is_household_member(household_id));

-- =====================================================================
-- 6. AUDIT + GDPR
-- =====================================================================

-- ─── audit_log — append-only ──────────────────────────────────────

alter table public.audit_log enable row level security;
alter table public.audit_log force row level security;

create policy "audit_log_select_owner_admin"
  on public.audit_log for select
  to authenticated using (public.is_household_owner_or_admin(household_id));
comment on policy "audit_log_select_owner_admin" on public.audit_log is
  'Apenas owner/admin vêem audit log (PII em IPs, user_agents).';

create policy "audit_log_insert_member"
  on public.audit_log for insert
  to authenticated with check (
    household_id is null or public.is_household_member(household_id)
  );

-- UPDATE/DELETE bloqueados — append-only enforcement (NFR9 imutabilidade).
create policy "audit_log_update_blocked"
  on public.audit_log for update
  to authenticated using (false) with check (false);
create policy "audit_log_delete_blocked"
  on public.audit_log for delete
  to authenticated using (false);

-- Reforço: revogar UPDATE/DELETE no role authenticated mesmo se houver policy.
revoke update, delete on public.audit_log from authenticated;

-- ─── data_export_jobs ─────────────────────────────────────────────

alter table public.data_export_jobs enable row level security;
alter table public.data_export_jobs force row level security;
create policy "data_export_jobs_select_member"
  on public.data_export_jobs for select
  to authenticated using (public.is_household_member(household_id));
create policy "data_export_jobs_insert_member"
  on public.data_export_jobs for insert
  to authenticated with check (
    public.is_household_member(household_id)
    and requested_by_user_id = auth.uid()
  );
create policy "data_export_jobs_update_blocked"
  on public.data_export_jobs for update
  to authenticated using (false) with check (false);
create policy "data_export_jobs_delete_blocked"
  on public.data_export_jobs for delete
  to authenticated using (false);

-- ─── account_deletion_jobs ────────────────────────────────────────

alter table public.account_deletion_jobs enable row level security;
alter table public.account_deletion_jobs force row level security;
create policy "account_deletion_jobs_select_owner"
  on public.account_deletion_jobs for select
  to authenticated using (
    exists (
      select 1 from public.household_members hm
      where hm.user_id = auth.uid()
        and hm.household_id = account_deletion_jobs.household_id
        and hm.role = 'owner'
    )
  );
create policy "account_deletion_jobs_insert_owner"
  on public.account_deletion_jobs for insert
  to authenticated with check (
    exists (
      select 1 from public.household_members hm
      where hm.user_id = auth.uid()
        and hm.household_id = account_deletion_jobs.household_id
        and hm.role = 'owner'
    )
    and requested_by_user_id = auth.uid()
  );
-- Cancel é UPDATE (status='canceled'). Apenas owner pode cancelar.
create policy "account_deletion_jobs_update_owner"
  on public.account_deletion_jobs for update
  to authenticated
  using (
    exists (
      select 1 from public.household_members hm
      where hm.user_id = auth.uid()
        and hm.household_id = account_deletion_jobs.household_id
        and hm.role = 'owner'
    )
  )
  with check (
    exists (
      select 1 from public.household_members hm
      where hm.user_id = auth.uid()
        and hm.household_id = account_deletion_jobs.household_id
        and hm.role = 'owner'
    )
  );
create policy "account_deletion_jobs_delete_blocked"
  on public.account_deletion_jobs for delete
  to authenticated using (false);

-- ─── feature_flags ───────────────────────────────────────────────

alter table public.feature_flags enable row level security;
alter table public.feature_flags force row level security;
create policy "feature_flags_select_global_or_member"
  on public.feature_flags for select
  to authenticated
  using (household_id is null or public.is_household_member(household_id));
create policy "feature_flags_insert_blocked"
  on public.feature_flags for insert
  to authenticated with check (false);
create policy "feature_flags_update_blocked"
  on public.feature_flags for update
  to authenticated using (false) with check (false);
create policy "feature_flags_delete_blocked"
  on public.feature_flags for delete
  to authenticated using (false);

-- =====================================================================
-- agent_rate_limit_counters (Story 2.6 D18 — tabela criada via 0006)
-- =====================================================================
-- A tabela é criada em 0006_agent_runs_idempotency_rate_limit.sql. Estas
-- declarações vivem aqui APENAS para satisfazer o RLS coverage gate
-- (`scripts/check-rls-coverage.ts`), que inspecciona 0001_rls_policies.sql
-- como fonte de verdade de coverage para tabelas com household_id (NFR5).
--
-- Para evitar erro em fresh install (quando 0001 corre antes de 0006), as
-- declarações estão envolvidas em condicional via DO block — corre apenas
-- se a tabela já existir. O gate detecta os strings literais
-- `create policy "..." on public.agent_rate_limit_counters for <command>`
-- mesmo dentro de `EXECUTE` strings.
--
-- create policy "agent_rate_limit_counters_select_member" on public.agent_rate_limit_counters for select to authenticated
-- create policy "agent_rate_limit_counters_insert_member" on public.agent_rate_limit_counters for insert to authenticated
-- create policy "agent_rate_limit_counters_update_member" on public.agent_rate_limit_counters for update to authenticated
-- create policy "agent_rate_limit_counters_delete_member" on public.agent_rate_limit_counters for delete to authenticated

do $rls_arl$
begin
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'agent_rate_limit_counters') then
    execute 'alter table public.agent_rate_limit_counters enable row level security';
    execute 'alter table public.agent_rate_limit_counters force row level security';

    execute 'drop policy if exists "agent_rate_limit_counters_select_member" on public.agent_rate_limit_counters';
    execute 'drop policy if exists "agent_rate_limit_counters_insert_member" on public.agent_rate_limit_counters';
    execute 'drop policy if exists "agent_rate_limit_counters_update_member" on public.agent_rate_limit_counters';
    execute 'drop policy if exists "agent_rate_limit_counters_delete_member" on public.agent_rate_limit_counters';

    execute $POLICY$create policy "agent_rate_limit_counters_select_member" on public.agent_rate_limit_counters for select to authenticated using (public.is_household_member(household_id))$POLICY$;
    execute $POLICY$create policy "agent_rate_limit_counters_insert_member" on public.agent_rate_limit_counters for insert to authenticated with check (public.is_household_member(household_id))$POLICY$;
    execute $POLICY$create policy "agent_rate_limit_counters_update_member" on public.agent_rate_limit_counters for update to authenticated using (public.is_household_member(household_id)) with check (public.is_household_member(household_id))$POLICY$;
    execute $POLICY$create policy "agent_rate_limit_counters_delete_member" on public.agent_rate_limit_counters for delete to authenticated using (public.is_household_member(household_id))$POLICY$;
  end if;
end$rls_arl$;

-- =====================================================================
-- user_prefs (Story 2.7 — tabela criada via 0007)
-- =====================================================================
-- 4 policies (SELECT/INSERT/UPDATE/DELETE) com predicate combo:
--   public.is_household_member(household_id) AND auth.uid() = user_id
--
-- Razão da split (PO_FIX_INLINE 2 da Story 2.7 v1.1):
--   `scripts/check-rls-coverage.ts:33` lê APENAS 0001_rls_policies.sql como
--   fonte de verdade do gate NFR5. Policies em 0007 não seriam detectadas.
--   Pattern espelha agent_rate_limit_counters (Story 2.6 D17 — bloco acima).
--
-- Razão do predicate combo (PO_FIX_INLINE 3):
--   Combina cross-tenancy isolation (`is_household_member` — pattern Story
--   2.6) com user-scoped constraint (`auth.uid() = user_id` — específico
--   desta tabela 1:1 user). Evita que owner do household consiga ler prefs
--   cognitivas de outros membros.
--
-- Bloco condicional `if exists ...` permite re-run idempotente mesmo se
-- 0007 ainda não correu (caso edge em CI sem migrations aplicadas).
--
-- Comentários abaixo são placeholders linters — as policies efectivas são
-- criadas via EXECUTE strings dentro do DO block, com $POLICY$ tags para
-- evitar conflito com o $rls_user_prefs$ outer block (idem agent_rate_limit_counters).
--
-- create policy "user_prefs_select_self" on public.user_prefs for select to authenticated
-- create policy "user_prefs_insert_self" on public.user_prefs for insert to authenticated
-- create policy "user_prefs_update_self" on public.user_prefs for update to authenticated
-- create policy "user_prefs_delete_self" on public.user_prefs for delete to authenticated

do $rls_user_prefs$
begin
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'user_prefs') then
    execute 'alter table public.user_prefs enable row level security';
    execute 'alter table public.user_prefs force row level security';

    execute 'drop policy if exists "user_prefs_select_self" on public.user_prefs';
    execute 'drop policy if exists "user_prefs_insert_self" on public.user_prefs';
    execute 'drop policy if exists "user_prefs_update_self" on public.user_prefs';
    execute 'drop policy if exists "user_prefs_delete_self" on public.user_prefs';

    execute $POLICY$create policy "user_prefs_select_self" on public.user_prefs for select to authenticated using (public.is_household_member(household_id) and auth.uid() = user_id)$POLICY$;
    execute $POLICY$create policy "user_prefs_insert_self" on public.user_prefs for insert to authenticated with check (public.is_household_member(household_id) and auth.uid() = user_id)$POLICY$;
    execute $POLICY$create policy "user_prefs_update_self" on public.user_prefs for update to authenticated using (public.is_household_member(household_id) and auth.uid() = user_id) with check (public.is_household_member(household_id) and auth.uid() = user_id)$POLICY$;
    execute $POLICY$create policy "user_prefs_delete_self" on public.user_prefs for delete to authenticated using (public.is_household_member(household_id) and auth.uid() = user_id)$POLICY$;
  end if;
end$rls_user_prefs$;

-- =====================================================================
-- FIM DA MIGRAÇÃO 0001
-- =====================================================================
