/**
 * `groupTasksBySections` — agrupa lista de tarefas em secções temporais
 * com TZ-awareness `Europe/Lisbon` (Story 3.3 AC5 + AC6 / FR11).
 *
 * Secções em ordem fixa de display:
 *   1. Atrasadas (FR11) — SEMPRE em primeiro se non-empty (variant: 'danger')
 *   2. Hoje · {DD/MM/YYYY}
 *   3. Amanhã · {DD/MM/YYYY}
 *   4. Esta semana (today+2 .. today+6)
 *   5. Mais tarde (>= today+7)
 *   6. Sem prazo (due_date IS NULL)
 *   7. Concluídas hoje (status==='done' + completed_at >= todayLisbon)
 *      — collapsed por defeito no UI; variant: 'success'.
 *
 * Tarefas com `status='archived'` são silently excluídas (UX: filtros principais
 * não as mostram a menos que user explicite Status=Arquivado — esse fluxo cai
 * fora do agrupamento e renderiza lista plana).
 *
 * Date arithmetic é TZ-aware (`Europe/Lisbon`) via `date-fns-tz` `toZonedTime`
 * + `date-fns` `startOfDay`/`addDays`/`differenceInCalendarDays`. Casos cobertos:
 *   - Boundary midnight Lisbon (DST PT — last Sunday March + last Sunday October)
 *   - Week boundary (today+6 = "Esta semana"; today+7 = "Mais tarde")
 *   - `due_date` null → bucket `no_due_date`
 *   - `completed_at` null em done tasks → excluído de `completed_today`
 *
 * Trace: Story 3.3 T4.2, AC5, AC6.
 */
import { addDays, differenceInCalendarDays, startOfDay } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

import type { TaskRow } from '@/lib/api-helpers/list-tasks';

const TZ = 'Europe/Lisbon';

export type SectionKey =
  | 'overdue'
  | 'today'
  | 'tomorrow'
  | 'this_week'
  | 'later'
  | 'no_due_date'
  | 'completed_today';

export type SectionVariant = 'default' | 'danger' | 'success';

export interface SectionGroup {
  readonly key: SectionKey;
  readonly label: string;
  readonly count: number;
  readonly tasks: TaskRow[];
  readonly variant: SectionVariant;
}

/** Formata data em PT-PT `DD/MM/YYYY`. */
function formatPT(date: Date): string {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

/**
 * Calcula `today` Lisbon-aware (start of day 00:00 em Europe/Lisbon).
 *
 * Exportado para testes deterministicos passarem `now` fixo.
 */
export function getTodayLisbon(now: Date = new Date()): Date {
  return startOfDay(toZonedTime(now, TZ));
}

/**
 * Devolve número de dias entre `due_date` (string YYYY-MM-DD) e `todayLisbon`.
 * Negativo se atrasada, 0 se hoje, positivo se futura.
 */
function diffDaysFromToday(dueDate: string, todayLisbon: Date): number {
  // YYYY-MM-DD parse — interpretar como midnight Lisbon (evitar UTC drift)
  const [year, month, day] = dueDate.split('-').map(Number);
  if (!year || !month || !day) return 0;
  // Construir Date como midnight no fuso local da máquina, depois converter para Lisbon
  // Para datas (sem time component), o impacto de TZ é minimal — utilizar startOfDay para normalizar
  const due = startOfDay(new Date(year, month - 1, day));
  const today = startOfDay(todayLisbon);
  return differenceInCalendarDays(due, today);
}

/**
 * Agrupa tarefas em secções display-ready.
 *
 * @param tasks - Lista de tarefas (ordering preservado dentro de cada bucket).
 * @param now - Reference time (default: `new Date()`). Override em tests.
 */
export function groupTasksBySections(
  tasks: readonly TaskRow[],
  now: Date = new Date(),
): SectionGroup[] {
  const todayLisbon = getTodayLisbon(now);
  const tomorrowLisbon = addDays(todayLisbon, 1);

  const buckets: Record<SectionKey, TaskRow[]> = {
    overdue: [],
    today: [],
    tomorrow: [],
    this_week: [],
    later: [],
    no_due_date: [],
    completed_today: [],
  };

  for (const task of tasks) {
    if (task.status === 'archived') continue; // Arquivadas silently excluídas

    // Concluídas hoje
    if (task.status === 'done') {
      if (task.completed_at) {
        const completedLisbon = toZonedTime(new Date(task.completed_at), TZ);
        if (completedLisbon >= todayLisbon) {
          buckets.completed_today.push(task);
        }
      }
      continue;
    }

    if (!task.due_date) {
      buckets.no_due_date.push(task);
      continue;
    }

    const diffDays = diffDaysFromToday(task.due_date, todayLisbon);
    if (diffDays < 0) buckets.overdue.push(task);
    else if (diffDays === 0) buckets.today.push(task);
    else if (diffDays === 1) buckets.tomorrow.push(task);
    else if (diffDays <= 6) buckets.this_week.push(task);
    else buckets.later.push(task);
  }

  const sections: SectionGroup[] = [];

  // FR11: Atrasadas SEMPRE em primeiro se non-empty
  if (buckets.overdue.length > 0) {
    sections.push({
      key: 'overdue',
      label: `Atrasadas (${buckets.overdue.length})`,
      count: buckets.overdue.length,
      tasks: buckets.overdue,
      variant: 'danger',
    });
  }

  const orderedBuckets: Array<{ key: SectionKey; labelFn: () => string }> = [
    { key: 'today', labelFn: () => `Hoje · ${formatPT(todayLisbon)}` },
    { key: 'tomorrow', labelFn: () => `Amanhã · ${formatPT(tomorrowLisbon)}` },
    { key: 'this_week', labelFn: () => 'Esta semana' },
    { key: 'later', labelFn: () => 'Mais tarde' },
    { key: 'no_due_date', labelFn: () => 'Sem prazo' },
  ];

  for (const { key, labelFn } of orderedBuckets) {
    if (buckets[key].length > 0) {
      sections.push({
        key,
        label: labelFn(),
        count: buckets[key].length,
        tasks: buckets[key],
        variant: 'default',
      });
    }
  }

  if (buckets.completed_today.length > 0) {
    sections.push({
      key: 'completed_today',
      label: `Concluídas hoje (${buckets.completed_today.length})`,
      count: buckets.completed_today.length,
      tasks: buckets.completed_today,
      variant: 'success',
    });
  }

  return sections;
}

/**
 * Calcula descrição PT-PT de dias atrasados (FR11 — TaskRow visual).
 *
 * @example getDaysOverdue('2026-05-14', new Date('2026-05-16')) → 'há 2 dias'
 */
export function getDaysOverdue(dueDate: string | null, now: Date = new Date()): string | null {
  if (!dueDate) return null;
  const todayLisbon = getTodayLisbon(now);
  const diffDays = diffDaysFromToday(dueDate, todayLisbon);
  if (diffDays >= 0) return null;
  const days = Math.abs(diffDays);
  if (days === 1) return 'há 1 dia';
  if (days <= 6) return `há ${days} dias`;
  if (days <= 13) return 'há 1 semana';
  if (days <= 30) return `há ${Math.floor(days / 7)} semanas`;
  if (days <= 60) return 'há 1 mês';
  return 'há mais de 1 mês';
}
