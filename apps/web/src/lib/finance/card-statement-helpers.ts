/**
 * Helpers do ciclo de facturação de cartão — vista "Cartões"
 * (Story 4.8 AC2, D-4.8.1, D-4.8.5).
 *
 * `calcStatementCycle` é uma função PURA — aritmética de calendário `date-fns`
 * sobre strings YYYY-MM-DD, sem Drizzle, sem rede, sem timezone (D-4.8.5,
 * coerente com D-4.5.5 — datas financeiras são datas de calendário).
 *
 * Convenção de fronteira (D-4.8.1, mitiga R-4.6): a janela de uma fatura é
 * `[cycleStart, cycleEnd]` com ambos os extremos INCLUSIVOS — uma transacção
 * no dia `closing_day` pertence à fatura que fecha nesse dia.
 *
 * `closing_day`/`due_day` ∈ [1,28] (CHECK do schema) — `setDate` nunca
 * transborda, zero clamp de fim de mês.
 *
 * Trace: Story 4.8 AC2, D-4.8.1, D-4.8.5; epic R-4.6, DP7=A.
 */
import { addDays, addMonths, formatISO, parseISO, setDate, subMonths } from 'date-fns';

export interface StatementCycle {
  /** Fatura corrente (a acumular) — janela inclusiva [start, end]. */
  readonly currentCycleStart: string;
  readonly currentCycleEnd: string;
  /** Vencimento da fatura corrente. */
  readonly currentDueDate: string;
  /** Próxima fatura — janela inclusiva [start, end]. */
  readonly nextCycleStart: string;
  readonly nextCycleEnd: string;
  readonly nextDueDate: string;
}

/** Formata um `Date` como string de calendário YYYY-MM-DD. */
function toDateString(date: Date): string {
  return formatISO(date, { representation: 'date' });
}

/**
 * Calcula a data de vencimento de uma fatura que fecha em `cycleEnd`.
 * Regra (AC2): se `dueDay > closingDay` → vence no mesmo mês do fecho;
 * caso contrário → no mês seguinte.
 */
function calcDueDate(cycleEnd: Date, closingDay: number, dueDay: number): Date {
  if (dueDay > closingDay) {
    return setDate(cycleEnd, dueDay);
  }
  return setDate(addMonths(cycleEnd, 1), dueDay);
}

/**
 * Calcula o ciclo de facturação de um cartão de crédito.
 *
 * @param closingDay Dia de fecho da fatura — [1,28].
 * @param dueDay     Dia de vencimento — [1,28].
 * @param today      Data corrente — YYYY-MM-DD.
 */
export function calcStatementCycle(
  closingDay: number,
  dueDay: number,
  today: string,
): StatementCycle {
  const todayDate = parseISO(today);
  const todayDay = todayDate.getDate();

  // Fatura corrente — fecha na próxima ocorrência de `closingDay` a partir de
  // hoje (inclusive): se hoje for o dia de fecho ou antes, fecha este mês;
  // senão fecha no mês seguinte.
  const currentCycleEnd =
    todayDay <= closingDay
      ? setDate(todayDate, closingDay)
      : setDate(addMonths(todayDate, 1), closingDay);

  // Início do ciclo corrente — dia seguinte ao fecho anterior (D-4.8.1).
  const prevClose = setDate(subMonths(currentCycleEnd, 1), closingDay);
  const currentCycleStart = addDays(prevClose, 1);

  // Próxima fatura — contígua à corrente.
  const nextCycleStart = addDays(currentCycleEnd, 1);
  const nextCycleEnd = setDate(addMonths(currentCycleEnd, 1), closingDay);

  return {
    currentCycleStart: toDateString(currentCycleStart),
    currentCycleEnd: toDateString(currentCycleEnd),
    currentDueDate: toDateString(calcDueDate(currentCycleEnd, closingDay, dueDay)),
    nextCycleStart: toDateString(nextCycleStart),
    nextCycleEnd: toDateString(nextCycleEnd),
    nextDueDate: toDateString(calcDueDate(nextCycleEnd, closingDay, dueDay)),
  };
}
