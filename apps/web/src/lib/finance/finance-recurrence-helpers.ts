/**
 * Helpers de recorrências de Finanças — aritmética de calendário pura.
 *
 * Story 4.5 AC2 — funções puras `calcNextRunDate` e `isRecurrenceDue` que
 * calculam a próxima execução de uma `recurrences` (FR14). Não dependem de
 * Inngest nem de Drizzle — testáveis em isolamento total (zero mocks, zero
 * rede).
 *
 * Diferença vs Tarefas (D-4.5.2): as `recurrences` de Finanças têm frequências
 * simples (`recurrenceFreqFinanceEnum`: daily/weekly/biweekly/monthly/
 * quarterly/yearly/custom) — SEM `weekdays`/`weekends`. Logo, NÃO se reutiliza
 * o `rrule-helpers.ts` de Tarefas: aritmética `date-fns` directa é suficiente
 * e mais legível (KISS). O scope do cron é apenas o dia corrente (DP4=A) —
 * não há expansão de horizonte multi-dia.
 *
 * Sem ajuste de timezone (D-4.5.5): `transaction_date`/`next_run_on` são tipo
 * `date` em Postgres (sem timezone) — armazenam apenas YYYY-MM-DD. A data
 * financeira é o dia percepcionado, não um instante. Logo, `date-fns` puro
 * (sem `date-fns-tz`) é correcto aqui.
 *
 * Trace: Story 4.5 AC2, D-4.5.2, D-4.5.4, D-4.5.5, finance.ts:68-76 (enum).
 */
import { addDays, addMonths, addQuarters, addWeeks, addYears, formatISO, parseISO } from 'date-fns';

/** Frequências suportadas pela `recurrences` de Finanças (espelho de `recurrenceFreqFinanceEnum`). */
export type FinanceRecurrenceFrequency =
  | 'daily'
  | 'weekly'
  | 'biweekly'
  | 'monthly'
  | 'quarterly'
  | 'yearly'
  | 'custom';

/** Function ID do cron Inngest de Finanças — partilhado entre handler e route. */
export const FINANCE_CRON_ID = 'generate-finance-recurrences' as const;

/** Definição minimal de recorrência necessária para calcular a próxima data. */
export interface FinanceRecurrenceForCalc {
  readonly frequency: FinanceRecurrenceFrequency;
  readonly interval: number;
  readonly customRrule: string | null;
  /** YYYY-MM-DD ou `null` (recorrência sem data de fim — nunca esgota). */
  readonly endsOn: string | null;
}

/**
 * Formata um `Date` como string de calendário YYYY-MM-DD (sem componente de
 * hora nem timezone) — formato canónico de uma coluna Postgres `date`.
 */
function toDateString(date: Date): string {
  return formatISO(date, { representation: 'date' });
}

/**
 * Calcula a próxima data de execução de uma recorrência financeira, dado o
 * `currentRunDate` (a data que acabou de ser materializada).
 *
 * Retorna a próxima data como string YYYY-MM-DD, ou `null` se a recorrência
 * está esgotada (`endsOn` definido e a próxima data ultrapassa-o).
 *
 * Mapeamento `frequency` → `date-fns`:
 *   - `daily`     → addDays(date, interval)
 *   - `weekly`    → addWeeks(date, interval)
 *   - `biweekly`  → addWeeks(date, 2) — quinzenal fixo, ignora `interval`
 *   - `monthly`   → addMonths(date, interval)
 *   - `quarterly` → addQuarters(date, interval)
 *   - `yearly`    → addYears(date, interval)
 *   - `custom`    → addMonths(date, interval) — fallback MVP (D-4.5.4)
 *
 * Nota `custom` (D-4.5.4): o campo `customRrule` é aceite na criação da
 * recorrência (API) mas NÃO é interpretado pelo cron no MVP — `custom` é
 * tratado como `monthly`. Limitação documentada no runbook AC8.
 *
 * Nota fim de mês (R-4.5.2): `addMonths`/`addQuarters`/`addYears` de `date-fns`
 * fazem clamp automático ao último dia do mês (ex: 31 Jan + 1 mês → 28 Fev).
 */
export function calcNextRunDate(
  recurrence: FinanceRecurrenceForCalc,
  currentRunDate: string,
): string | null {
  const current = parseISO(currentRunDate);
  const interval = recurrence.interval >= 1 ? recurrence.interval : 1;

  let next: Date;
  switch (recurrence.frequency) {
    case 'daily':
      next = addDays(current, interval);
      break;
    case 'weekly':
      next = addWeeks(current, interval);
      break;
    case 'biweekly':
      // Quinzenal fixo — duas semanas, independente de `interval`.
      next = addWeeks(current, 2);
      break;
    case 'monthly':
      next = addMonths(current, interval);
      break;
    case 'quarterly':
      next = addQuarters(current, interval);
      break;
    case 'yearly':
      next = addYears(current, interval);
      break;
    case 'custom':
      // Fallback MVP (D-4.5.4) — `customRrule` ignorado pelo cron.
      next = addMonths(current, interval);
      break;
    default: {
      // Exaustividade — `frequency` é uma union fechada.
      const _exhaustive: never = recurrence.frequency;
      throw new Error(`Frequência de recorrência desconhecida: ${String(_exhaustive)}`);
    }
  }

  const nextDate = toDateString(next);

  // Esgotamento — `endsOn` é boundary inclusivo (`endsOn` exacto NÃO esgota).
  if (recurrence.endsOn !== null && nextDate > recurrence.endsOn) {
    return null;
  }

  return nextDate;
}

/**
 * Verifica se uma recorrência está devida hoje ou no passado (DP4=A):
 *   `nextRunOn <= today`.
 *
 * `nextRunOn === null` retorna `false` — o caso "nunca processada com
 * `starts_on` no futuro" é coberto pelo SELECT do cron, não por esta função.
 */
export function isRecurrenceDue(nextRunOn: string | null, today: string): boolean {
  if (nextRunOn === null) return false;
  return nextRunOn <= today;
}
