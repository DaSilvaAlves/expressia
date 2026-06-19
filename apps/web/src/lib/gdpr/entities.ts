/**
 * Definição das entidades incluídas no export GDPR (Story 6.8 AC3/AC4).
 *
 * Cada entidade declara:
 *   - `file`: nome base dos ficheiros (`tasks` → `tasks.json` + `tasks.csv`).
 *   - `label`: nome PT-PT para o README.txt.
 *   - `sql`: SELECT household-scoped (executado via `withHousehold`/`getDb()` —
 *     RLS-enforced + filtro `household_id` app-enforced, 1.ª rede SEC-1).
 *   - `headers`: pares `{ key, label }` (chave técnica snake_case → header PT-PT).
 *   - `moneyColumns`: colunas `*_cents` que ganham coluna companheira `*_eur`
 *     (decimal PT-PT) nos CSVs financeiros (PO-D3).
 *
 * As queries usam `$hid` (household) e `$uid` (utilizador) substituídos no
 * `generate-export.ts` via template `sql` parametrizado.
 *
 * Não incluídas (billing CONGELADO): subscriptions, invoices, payment_methods,
 * feature_flags. Não incluídas (externas): auth.users (além de email/created_at),
 * logs Sentry/Grafana.
 *
 * Trace: Story 6.8 AC3; `packages/db/src/schema/*.ts`; CON3; CON9; PO-D2; PO-D3.
 */

export interface ExportColumn {
  /** Chave técnica snake_case (igual à coluna SQL e ao campo JSON). */
  readonly key: string;
  /** Cabeçalho PT-PT apresentado no CSV (PO-D2). */
  readonly label: string;
}

export interface ExportEntity {
  /** Nome base dos ficheiros (`tasks` → tasks.json / tasks.csv). */
  readonly file: string;
  /** Nome PT-PT para o README.txt. */
  readonly label: string;
  /**
   * Fragmento SELECT (sem `where`/`order` — adicionados no gerador). Colunas
   * explícitas em snake_case. `from public.<tabela>`.
   */
  readonly from: string;
  /**
   * Modo de scoping do WHERE — determina a coluna usada no filtro app-enforced
   * (1.ª rede SEC-1) que o gerador constrói:
   *   - `household`    → `where household_id = $hid` (maioria das tabelas de domínio).
   *   - `self_by_id`   → `where id = $hid` (tabela `households`: a PK é `id`, NÃO
   *                       tem coluna `household_id`; a RLS usa `is_household_member(id)`).
   *   - `user`         → `where user_id = $uid` (só a row do utilizador autenticado).
   *
   * REL-001 (QA fix 6.8): `households` exige `self_by_id` — gerar `household_id`
   * rebentava com Postgres 42703 (column does not exist) e partia o export inteiro.
   */
  readonly where: 'household' | 'self_by_id' | 'user';
  /** Colunas a exportar (ordem das colunas CSV/JSON). */
  readonly columns: readonly ExportColumn[];
  /**
   * Colunas `*_cents` que ganham coluna companheira `*_eur` no CSV (PO-D3).
   * Conjunto vazio para entidades não-financeiras.
   */
  readonly moneyColumns: readonly string[];
}

/**
 * Lista canónica de entidades exportadas (AC3). A ordem define a ordem de
 * geração e a listagem no README.
 */
export const EXPORT_ENTITIES: readonly ExportEntity[] = [
  // ─── Household e membros ───────────────────────────────────────────────────
  {
    file: 'households',
    label: 'Família (household)',
    from: 'select id, name, owner_user_id, plan, locale, timezone, currency, created_at, updated_at from public.households',
    // A tabela `households` NÃO tem coluna `household_id` — a PK é `id`. Scoping
    // pela própria PK do household (REL-001 / QA fix 6.8).
    where: 'self_by_id',
    columns: [
      { key: 'id', label: 'ID' },
      { key: 'name', label: 'Nome' },
      { key: 'owner_user_id', label: 'ID do dono' },
      { key: 'plan', label: 'Plano' },
      { key: 'locale', label: 'Idioma' },
      { key: 'timezone', label: 'Fuso horário' },
      { key: 'currency', label: 'Moeda' },
      { key: 'created_at', label: 'Criado em' },
      { key: 'updated_at', label: 'Atualizado em' },
    ],
    moneyColumns: [],
  },
  {
    file: 'household_members',
    label: 'Membros da família',
    from: 'select household_id, user_id, role, display_name, joined_at from public.household_members',
    where: 'household',
    columns: [
      { key: 'household_id', label: 'ID da família' },
      { key: 'user_id', label: 'ID do utilizador' },
      { key: 'role', label: 'Papel' },
      { key: 'display_name', label: 'Nome a apresentar' },
      { key: 'joined_at', label: 'Entrou em' },
    ],
    moneyColumns: [],
  },
  {
    file: 'household_invites',
    label: 'Convites da família',
    from: 'select id, household_id, invited_by_user_id, email, role, expires_at, accepted_at, accepted_by_user_id, created_at from public.household_invites',
    where: 'household',
    columns: [
      { key: 'id', label: 'ID' },
      { key: 'household_id', label: 'ID da família' },
      { key: 'invited_by_user_id', label: 'Convidado por' },
      { key: 'email', label: 'Email' },
      { key: 'role', label: 'Papel' },
      { key: 'expires_at', label: 'Expira em' },
      { key: 'accepted_at', label: 'Aceite em' },
      { key: 'accepted_by_user_id', label: 'Aceite por' },
      { key: 'created_at', label: 'Criado em' },
    ],
    moneyColumns: [],
  },
  {
    file: 'kanban_columns',
    label: 'Colunas Kanban',
    from: 'select id, household_id, name, sort_order, color, is_done_column, created_at, updated_at from public.kanban_columns',
    where: 'household',
    columns: [
      { key: 'id', label: 'ID' },
      { key: 'household_id', label: 'ID da família' },
      { key: 'name', label: 'Nome' },
      { key: 'sort_order', label: 'Ordem' },
      { key: 'color', label: 'Cor' },
      { key: 'is_done_column', label: 'É coluna concluída' },
      { key: 'created_at', label: 'Criado em' },
      { key: 'updated_at', label: 'Atualizado em' },
    ],
    moneyColumns: [],
  },
  // ─── Tarefas ────────────────────────────────────────────────────────────────
  {
    file: 'tasks',
    label: 'Tarefas',
    from: 'select id, household_id, created_by_user_id, assigned_to_user_id, title, description, due_date, due_time, priority, status, kanban_column_id, kanban_position, project, recurrence_id, is_recurrence_template, completed_at, created_at, updated_at from public.tasks',
    where: 'household',
    columns: [
      { key: 'id', label: 'ID' },
      { key: 'household_id', label: 'ID da família' },
      { key: 'created_by_user_id', label: 'Criado por' },
      { key: 'assigned_to_user_id', label: 'Atribuído a' },
      { key: 'title', label: 'Título' },
      { key: 'description', label: 'Descrição' },
      { key: 'due_date', label: 'Data prevista' },
      { key: 'due_time', label: 'Hora prevista' },
      { key: 'priority', label: 'Prioridade' },
      { key: 'status', label: 'Estado' },
      { key: 'kanban_column_id', label: 'ID da coluna Kanban' },
      { key: 'kanban_position', label: 'Posição Kanban' },
      { key: 'project', label: 'Projeto' },
      { key: 'recurrence_id', label: 'ID da recorrência' },
      { key: 'is_recurrence_template', label: 'É modelo de recorrência' },
      { key: 'completed_at', label: 'Concluída em' },
      { key: 'created_at', label: 'Criada em' },
      { key: 'updated_at', label: 'Atualizada em' },
    ],
    moneyColumns: [],
  },
  {
    file: 'task_recurrences',
    label: 'Recorrências de tarefas',
    from: 'select id, household_id, template_task_id, frequency, "interval", custom_rrule, starts_on, ends_on, next_run_on, active, created_at, updated_at from public.task_recurrences',
    where: 'household',
    columns: [
      { key: 'id', label: 'ID' },
      { key: 'household_id', label: 'ID da família' },
      { key: 'template_task_id', label: 'ID da tarefa modelo' },
      { key: 'frequency', label: 'Frequência' },
      { key: 'interval', label: 'Intervalo' },
      { key: 'custom_rrule', label: 'Regra personalizada' },
      { key: 'starts_on', label: 'Começa em' },
      { key: 'ends_on', label: 'Termina em' },
      { key: 'next_run_on', label: 'Próxima execução' },
      { key: 'active', label: 'Ativa' },
      { key: 'created_at', label: 'Criada em' },
      { key: 'updated_at', label: 'Atualizada em' },
    ],
    moneyColumns: [],
  },
  {
    file: 'tags',
    label: 'Etiquetas',
    from: 'select id, household_id, name, color, created_at, updated_at from public.tags',
    where: 'household',
    columns: [
      { key: 'id', label: 'ID' },
      { key: 'household_id', label: 'ID da família' },
      { key: 'name', label: 'Nome' },
      { key: 'color', label: 'Cor' },
      { key: 'created_at', label: 'Criada em' },
      { key: 'updated_at', label: 'Atualizada em' },
    ],
    moneyColumns: [],
  },
  {
    file: 'task_tags',
    label: 'Etiquetas de tarefas (associações)',
    from: 'select task_id, tag_id, household_id, created_at from public.task_tags',
    where: 'household',
    columns: [
      { key: 'task_id', label: 'ID da tarefa' },
      { key: 'tag_id', label: 'ID da etiqueta' },
      { key: 'household_id', label: 'ID da família' },
      { key: 'created_at', label: 'Associada em' },
    ],
    moneyColumns: [],
  },
  // ─── Finanças ────────────────────────────────────────────────────────────────
  {
    file: 'accounts',
    label: 'Contas',
    from: 'select id, household_id, name, bank_name, account_type, iban_last4, balance_cents, initial_balance_cents, currency, archived_at, created_at, updated_at from public.accounts',
    where: 'household',
    columns: [
      { key: 'id', label: 'ID' },
      { key: 'household_id', label: 'ID da família' },
      { key: 'name', label: 'Nome' },
      { key: 'bank_name', label: 'Banco' },
      { key: 'account_type', label: 'Tipo de conta' },
      { key: 'iban_last4', label: 'IBAN (últimos 4)' },
      { key: 'balance_cents', label: 'Saldo (cêntimos)' },
      { key: 'initial_balance_cents', label: 'Saldo inicial (cêntimos)' },
      { key: 'currency', label: 'Moeda' },
      { key: 'archived_at', label: 'Arquivada em' },
      { key: 'created_at', label: 'Criada em' },
      { key: 'updated_at', label: 'Atualizada em' },
    ],
    moneyColumns: ['balance_cents', 'initial_balance_cents'],
  },
  {
    file: 'cards',
    label: 'Cartões',
    from: 'select id, household_id, account_id, name, last4, card_type, closing_day, due_day, credit_limit_cents, archived_at, created_at, updated_at from public.cards',
    where: 'household',
    columns: [
      { key: 'id', label: 'ID' },
      { key: 'household_id', label: 'ID da família' },
      { key: 'account_id', label: 'ID da conta' },
      { key: 'name', label: 'Nome' },
      { key: 'last4', label: 'Últimos 4 dígitos' },
      { key: 'card_type', label: 'Tipo de cartão' },
      { key: 'closing_day', label: 'Dia de fecho' },
      { key: 'due_day', label: 'Dia de vencimento' },
      { key: 'credit_limit_cents', label: 'Limite de crédito (cêntimos)' },
      { key: 'archived_at', label: 'Arquivado em' },
      { key: 'created_at', label: 'Criado em' },
      { key: 'updated_at', label: 'Atualizado em' },
    ],
    moneyColumns: ['credit_limit_cents'],
  },
  {
    file: 'categories',
    label: 'Categorias (próprias da família)',
    from: 'select id, household_id, name, icon, color, parent_id, is_default, kind, sort_order, archived_at, created_at, updated_at from public.categories',
    // Só per-household (AC3: categorias globais is_default=true NÃO exportadas).
    where: 'household',
    columns: [
      { key: 'id', label: 'ID' },
      { key: 'household_id', label: 'ID da família' },
      { key: 'name', label: 'Nome' },
      { key: 'icon', label: 'Ícone' },
      { key: 'color', label: 'Cor' },
      { key: 'parent_id', label: 'ID da categoria-mãe' },
      { key: 'is_default', label: 'É predefinida' },
      { key: 'kind', label: 'Tipo' },
      { key: 'sort_order', label: 'Ordem' },
      { key: 'archived_at', label: 'Arquivada em' },
      { key: 'created_at', label: 'Criada em' },
      { key: 'updated_at', label: 'Atualizada em' },
    ],
    moneyColumns: [],
  },
  {
    file: 'transactions',
    label: 'Transações',
    from: 'select id, household_id, created_by_user_id, account_id, card_id, category_id, amount_cents, currency, kind, description, transaction_date, payment_method, recurrence_id, installment_id, installment_index, agent_run_id, notes, is_projected, created_at, updated_at from public.transactions',
    where: 'household',
    columns: [
      { key: 'id', label: 'ID' },
      { key: 'household_id', label: 'ID da família' },
      { key: 'created_by_user_id', label: 'Criada por' },
      { key: 'account_id', label: 'ID da conta' },
      { key: 'card_id', label: 'ID do cartão' },
      { key: 'category_id', label: 'ID da categoria' },
      { key: 'amount_cents', label: 'Valor (cêntimos)' },
      { key: 'currency', label: 'Moeda' },
      { key: 'kind', label: 'Tipo' },
      { key: 'description', label: 'Descrição' },
      { key: 'transaction_date', label: 'Data da transação' },
      { key: 'payment_method', label: 'Método de pagamento' },
      { key: 'recurrence_id', label: 'ID da recorrência' },
      { key: 'installment_id', label: 'ID da prestação' },
      { key: 'installment_index', label: 'Número da prestação' },
      { key: 'agent_run_id', label: 'ID da execução do agente' },
      { key: 'notes', label: 'Notas' },
      { key: 'is_projected', label: 'É projetada' },
      { key: 'created_at', label: 'Criada em' },
      { key: 'updated_at', label: 'Atualizada em' },
    ],
    moneyColumns: ['amount_cents'],
  },
  {
    file: 'recurrences',
    label: 'Recorrências financeiras',
    from: 'select id, household_id, created_by_user_id, description, kind, amount_cents, currency, account_id, card_id, category_id, payment_method, frequency, "interval", custom_rrule, starts_on, ends_on, next_run_on, active, created_at, updated_at from public.recurrences',
    where: 'household',
    columns: [
      { key: 'id', label: 'ID' },
      { key: 'household_id', label: 'ID da família' },
      { key: 'created_by_user_id', label: 'Criada por' },
      { key: 'description', label: 'Descrição' },
      { key: 'kind', label: 'Tipo' },
      { key: 'amount_cents', label: 'Valor (cêntimos)' },
      { key: 'currency', label: 'Moeda' },
      { key: 'account_id', label: 'ID da conta' },
      { key: 'card_id', label: 'ID do cartão' },
      { key: 'category_id', label: 'ID da categoria' },
      { key: 'payment_method', label: 'Método de pagamento' },
      { key: 'frequency', label: 'Frequência' },
      { key: 'interval', label: 'Intervalo' },
      { key: 'custom_rrule', label: 'Regra personalizada' },
      { key: 'starts_on', label: 'Começa em' },
      { key: 'ends_on', label: 'Termina em' },
      { key: 'next_run_on', label: 'Próxima execução' },
      { key: 'active', label: 'Ativa' },
      { key: 'created_at', label: 'Criada em' },
      { key: 'updated_at', label: 'Atualizada em' },
    ],
    moneyColumns: ['amount_cents'],
  },
  {
    file: 'installments',
    label: 'Prestações',
    from: 'select id, household_id, created_by_user_id, card_id, description, total_amount_cents, num_installments, per_installment_cents, category_id, purchased_on, first_installment_on, currency, created_at, updated_at from public.installments',
    where: 'household',
    columns: [
      { key: 'id', label: 'ID' },
      { key: 'household_id', label: 'ID da família' },
      { key: 'created_by_user_id', label: 'Criada por' },
      { key: 'card_id', label: 'ID do cartão' },
      { key: 'description', label: 'Descrição' },
      { key: 'total_amount_cents', label: 'Valor total (cêntimos)' },
      { key: 'num_installments', label: 'Número de prestações' },
      { key: 'per_installment_cents', label: 'Valor por prestação (cêntimos)' },
      { key: 'category_id', label: 'ID da categoria' },
      { key: 'purchased_on', label: 'Comprada em' },
      { key: 'first_installment_on', label: 'Primeira prestação em' },
      { key: 'currency', label: 'Moeda' },
      { key: 'created_at', label: 'Criada em' },
      { key: 'updated_at', label: 'Atualizada em' },
    ],
    moneyColumns: ['total_amount_cents', 'per_installment_cents'],
  },
  // ─── Preferências ────────────────────────────────────────────────────────────
  {
    file: 'user_prefs',
    label: 'Preferências do utilizador',
    from: 'select user_id, household_id, always_preview, theme, widgets_enabled, onboarding_completed_at, created_at, updated_at from public.user_prefs',
    // Só a row do utilizador autenticado (AC3: WHERE user_id = auth.uid()).
    where: 'user',
    columns: [
      { key: 'user_id', label: 'ID do utilizador' },
      { key: 'household_id', label: 'ID da família' },
      { key: 'always_preview', label: 'Pré-visualizar sempre' },
      { key: 'theme', label: 'Tema' },
      { key: 'widgets_enabled', label: 'Widgets ativos' },
      { key: 'onboarding_completed_at', label: 'Onboarding concluído em' },
      { key: 'created_at', label: 'Criadas em' },
      { key: 'updated_at', label: 'Atualizadas em' },
    ],
    moneyColumns: [],
  },
  // ─── Registo de auditoria ────────────────────────────────────────────────────
  {
    // AC3: omitir ip/user_agent por privacidade.
    file: 'audit_log',
    label: 'Registo de auditoria',
    from: 'select id, household_id, user_id, action, entity_table, entity_id, before_state, after_state, trace_id, created_at from public.audit_log',
    where: 'household',
    columns: [
      { key: 'id', label: 'ID' },
      { key: 'household_id', label: 'ID da família' },
      { key: 'user_id', label: 'ID do utilizador' },
      { key: 'action', label: 'Ação' },
      { key: 'entity_table', label: 'Tabela' },
      { key: 'entity_id', label: 'ID da entidade' },
      { key: 'before_state', label: 'Estado anterior' },
      { key: 'after_state', label: 'Estado novo' },
      { key: 'trace_id', label: 'ID de rastreio' },
      { key: 'created_at', label: 'Registado em' },
    ],
    moneyColumns: [],
  },
];
