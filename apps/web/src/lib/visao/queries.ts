/**
 * Funções de query partilhadas — agregados do dashboard "Visão" (Story 5.6 DP-5.6.A=B).
 *
 * O SQL dos 7 endpoints `/api/visao/*` (Story 5.5) foi extraído para aqui de forma
 * a que:
 *   1. Os route handlers `/api/visao/*` fiquem wrappers finos — chamam a função +
 *      fazem o mesmo `Zod.parse()` antes de devolver (contrato HTTP preservado 1:1).
 *   2. Os widget Server Components da Visão consumam as funções directamente em RSC,
 *      sem HTTP round-trip self-call (NFR2/NFR4 — precedente Finanças RSC-direct,
 *      `financas/este-mes/page.tsx`).
 *
 * Convenções (idênticas aos handlers 5.5 — match byte-a-byte):
 *   - Timezone Europe/Lisbon a nível SQL (`(now() at time zone 'Europe/Lisbon')::date`).
 *   - RLS via `getDb()` (role `authenticated`) — NUNCA `getServiceDb()` (NFR5). O `db`
 *     é injectado pelo chamador (handler ou RSC), nunca instanciado aqui.
 *   - Valores monetários em cêntimos; `currency` literal `'EUR'`.
 *   - Cada função devolve o body já no shape do `*ResponseSchema` correspondente — o
 *     `parse` defensivo fica no chamador (handlers fazem-no; RSC valida onde aplicável).
 *
 * Trace: Story 5.6 DP-5.6.A=B; Story 5.5 AC1-AC7; CO-5.5.A.
 */
import { sql } from 'drizzle-orm';

import type { DbShim } from '@/lib/agent/db-shim';
import { getAccountBalanceMap } from '@/lib/finance/account-balances';
import type {
  AccountsBalanceResponse,
  BriefingResponse,
  CalendarWeekDay,
  CalendarWeekResponse,
  FinancesMonthResponse,
  RecurrencesNextResponse,
  TasksOverdueResponse,
  TasksTodayResponse,
} from '@/lib/api-schemas/visao';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers internos (idênticos aos handlers 5.5)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Converte `numeric`/`bigint` (Postgres) ou `string|null` (Drizzle) para inteiro
 * defensivo. Retorna 0 quando o valor não é finito. Critério `Number.isFinite`
 * após `parseInt` (OBS-4 / D-5.5.3) — partilhado por `financas-mes` e `saldo-contas`.
 */
function parseFinanceTotal(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const parsed = typeof value === 'number' ? value : parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Devolve 'YYYY-MM-DD' em Europe/Lisbon — usado para gerar buckets de dias do
 * calendário. `en-CA` produz exactamente o formato ISO `YYYY-MM-DD`.
 */
function toLisbonDateString(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Lisbon',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/**
 * Gera 7 strings 'YYYY-MM-DD' começando em "hoje (Lisbon)" e incrementando por 1
 * dia. Avança 24h em UTC e re-formata em Lisbon — pula DST naturalmente.
 */
function buildWeekDays(now: Date): string[] {
  const days: string[] = [];
  // Âncora: meio-dia UTC para evitar precision issues perto da meia-noite.
  const anchor = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12, 0, 0),
  );
  for (let i = 0; i < 7; i++) {
    const d = new Date(anchor.getTime() + i * 24 * 60 * 60 * 1000);
    days.push(toLisbonDateString(d));
  }
  return days;
}

// ─────────────────────────────────────────────────────────────────────────────
// Row types (mapeamento SQL → TS)
// ─────────────────────────────────────────────────────────────────────────────

interface TaskTodayRow {
  id: string;
  title: string;
  status: 'todo' | 'doing' | 'done' | 'archived';
  priority: 'low' | 'medium' | 'high';
  due_time: string | null;
}

interface TaskOverdueRow extends TaskTodayRow {
  due_date: string;
}

interface OverdueCountRow {
  total: number;
}

interface FinanceAggRow {
  kind: 'expense' | 'income' | 'transfer';
  total_cents: string | null;
  transaction_count: string | number;
}

interface RecurrenceRow {
  id: string;
  description: string;
  kind: 'expense' | 'income' | 'transfer';
  amount_cents: number;
  frequency: 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly' | 'custom';
  next_run_on: string;
}

interface CalendarTaskRow {
  id: string;
  title: string;
  priority: 'low' | 'medium' | 'high';
  due_date: string;
  due_time: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// AC1 — Tarefas de hoje (`tasks_today`)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tarefas cujo `due_date` é hoje (Europe/Lisbon) e status NOT IN ('done','archived').
 * `LIMIT 20` defensivo — o `count` satura em 20 (trade-off aceite: widget mostra teaser).
 */
export async function getTasksToday(
  db: DbShim,
  householdId: string,
): Promise<TasksTodayResponse> {
  const rows = await db.execute<TaskTodayRow>(sql`
    select id, title, status, priority, due_time
    from public.tasks
    where household_id = ${householdId}::uuid
      and due_date = (now() at time zone 'Europe/Lisbon')::date
      and status not in ('done', 'archived')
    order by due_time asc nulls last, priority desc, created_at asc
    limit 20
  `);

  return {
    count: rows.length,
    tasks: rows.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      priority: r.priority,
      dueTime: r.due_time,
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// AC2 — Tarefas atrasadas (`tasks_overdue`)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tarefas em atraso: `due_date < hoje` (Europe/Lisbon), status NOT IN ('done','archived').
 * `count` total via `COUNT(*)` separado (2-query pattern — D-5.5.2/OBS-1); lista `LIMIT 20`.
 */
export async function getTasksOverdue(
  db: DbShim,
  householdId: string,
): Promise<TasksOverdueResponse> {
  const countRows = await db.execute<OverdueCountRow>(sql`
    select count(*)::int as total
    from public.tasks
    where household_id = ${householdId}::uuid
      and due_date < (now() at time zone 'Europe/Lisbon')::date
      and status not in ('done', 'archived')
  `);
  const total = countRows[0]?.total ?? 0;

  const rows = await db.execute<TaskOverdueRow>(sql`
    select id, title, status, priority, due_date, due_time
    from public.tasks
    where household_id = ${householdId}::uuid
      and due_date < (now() at time zone 'Europe/Lisbon')::date
      and status not in ('done', 'archived')
    order by due_date asc, priority desc
    limit 20
  `);

  return {
    count: total,
    tasks: rows.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      priority: r.priority,
      dueDate: r.due_date,
      dueTime: r.due_time,
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// AC3 — Finanças do mês (`finance_month`)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Agrega transacções reais (não projecções) do mês corrente, agrupadas por `kind`.
 * Janela inclusiva [primeiro_dia_mês, hoje] em Europe/Lisbon. `is_projected = false`.
 */
export async function getFinancesMonth(
  db: DbShim,
  householdId: string,
): Promise<FinancesMonthResponse> {
  const rows = await db.execute<FinanceAggRow>(sql`
    select
      kind,
      sum(amount_cents)::text as total_cents,
      count(*)::int as transaction_count
    from public.transactions
    where household_id = ${householdId}::uuid
      and transaction_date >= date_trunc('month', (now() at time zone 'Europe/Lisbon')::date)
      and transaction_date <= (now() at time zone 'Europe/Lisbon')::date
      and is_projected = false
    group by kind
  `);

  let incomeTotal = 0;
  let expenseTotal = 0;
  let transactionCount = 0;
  for (const r of rows) {
    const total = parseFinanceTotal(r.total_cents);
    const cnt = parseFinanceTotal(r.transaction_count);
    transactionCount += cnt;
    if (r.kind === 'income') incomeTotal += total;
    else if (r.kind === 'expense') expenseTotal += total;
    // 'transfer' não conta como receita nem despesa — apenas no count.
  }

  return {
    incomeTotal,
    expenseTotal,
    balance: incomeTotal - expenseTotal,
    transactionCount,
    currency: 'EUR',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// AC4 — Próximas recorrências (`recurrences_next`)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Recorrências activas com `next_run_on` na janela (hoje, hoje+30 dias]. `LIMIT 10`.
 * Índice explorado: `recurrences_next_run_idx`.
 */
export async function getRecurrencesNext(
  db: DbShim,
  householdId: string,
): Promise<RecurrencesNextResponse> {
  const rows = await db.execute<RecurrenceRow>(sql`
    select id, description, kind, amount_cents, frequency, next_run_on
    from public.recurrences
    where household_id = ${householdId}::uuid
      and active = true
      and next_run_on > (now() at time zone 'Europe/Lisbon')::date
      and next_run_on <= ((now() at time zone 'Europe/Lisbon')::date + interval '30 days')
    order by next_run_on asc
    limit 10
  `);

  return {
    count: rows.length,
    recurrences: rows.map((r) => ({
      id: r.id,
      description: r.description,
      kind: r.kind,
      amountCents: r.amount_cents,
      frequency: r.frequency,
      nextRunOn: r.next_run_on,
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// AC5 — Saldo de contas (`accounts_balance`)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Saldo total das contas activas (`archived_at IS NULL`) do household autenticado.
 *
 * O saldo é computado on-read pela fórmula canónica do património
 * (`initial_balance_cents + SUM(income) − SUM(expense)`), NÃO pela coluna stored
 * `accounts.balance_cents` — que é morta (nunca actualizada por trigger; fica no
 * valor inicial, tipicamente €0). Reutiliza `getAccountBalanceMap` (single source
 * of truth do recompute, partilhada com a vista Património e `GET /api/financas/contas`),
 * sem reimplementar a fórmula. `includeArchived` fica no default `false`, pelo que
 * o Map só contém contas activas — `accountCount = map.size` e `totalBalanceCents`
 * = soma dos saldos. Contrato da resposta inalterado.
 *
 * Household scoping (SEC-4): o filtro `household_id` explícito vive dentro do
 * helper (1.ª rede app-enforced); a execução corre em `withHousehold` no handler
 * (2.ª rede RLS viva).
 */
export async function getAccountsBalance(
  db: DbShim,
  householdId: string,
): Promise<AccountsBalanceResponse> {
  const balanceById = await getAccountBalanceMap({ db, householdId });

  let totalBalanceCents = 0;
  for (const cents of balanceById.values()) totalBalanceCents += cents;

  return {
    totalBalanceCents,
    accountCount: balanceById.size,
    currency: 'EUR',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// AC6 — Calendário da semana (`calendar_week`)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tarefas com `due_date` na janela [hoje, hoje+6] (Europe/Lisbon), status NOT IN
 * ('done','archived'). Agrupamento por dia em TS — sempre devolve 7 entradas.
 */
export async function getCalendarWeek(
  db: DbShim,
  householdId: string,
): Promise<CalendarWeekResponse> {
  const rows = await db.execute<CalendarTaskRow>(sql`
    select id, title, priority, due_date, due_time
    from public.tasks
    where household_id = ${householdId}::uuid
      and due_date >= (now() at time zone 'Europe/Lisbon')::date
      and due_date <= ((now() at time zone 'Europe/Lisbon')::date + interval '6 days')
      and status not in ('done', 'archived')
    order by due_date asc, due_time asc nulls last, priority desc
    limit 50
  `);

  const weekDays = buildWeekDays(new Date());
  const days: CalendarWeekDay[] = weekDays.map((date) => {
    const dayTasks = rows
      .filter((r) => r.due_date === date)
      .map((r) => ({
        id: r.id,
        title: r.title,
        priority: r.priority,
        dueTime: r.due_time,
      }));
    return {
      date,
      taskCount: dayTasks.length,
      tasks: dayTasks,
    };
  });

  return { days };
}

// ─────────────────────────────────────────────────────────────────────────────
// AC7 — Briefing (`briefing`) — stub forward-compatible
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stub do briefing diário. A geração real (LLM via Inngest job nocturno) vem numa
 * story futura. `version: 1` reservado para forward compatibility (OBS-5).
 *
 * Não depende de `db` — assinatura uniforme com as restantes funções por simetria,
 * mas o parâmetro é ignorado (briefing é estático no MVP).
 */
export function getBriefing(): BriefingResponse {
  return {
    version: 1,
    available: false,
    message: 'Briefing diário disponível em breve.',
    generatedAt: null,
  };
}
