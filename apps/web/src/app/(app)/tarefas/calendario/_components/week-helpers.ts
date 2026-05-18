/**
 * Helpers semana — date-fns + locale `pt`, week start Monday (R5 mitigation).
 *
 * G1.3 Aria: DST handling concentrado AQUI. `DayColumn` recebe `dayIso` string passed-in.
 * NUNCA usar `getDay()` Date API com aritmética manual — depende do locale do servidor
 * e sofre off-by-1 nas 2 transições DST anuais Portugal (último domingo Março forward +
 * último domingo Outubro backward).
 */
import {
  addDays,
  addWeeks,
  format,
  parseISO,
  startOfWeek,
  isSameDay,
} from 'date-fns';
import { pt } from 'date-fns/locale/pt';

/** Formato ISO date YYYY-MM-DD (PG `date` type calendar-only). */
export type DayIso = string;

/** Formato ISO week `2026-W21`. */
export type WeekIso = string;

/**
 * Resolve a data de referência a partir de `searchParams.week`:
 *   - "2026-W21" → segunda dessa semana
 *   - "2026-05-18" → segunda da semana que contém esse dia
 *   - undefined/null/inválido → hoje
 *
 * Output: Date object (local timezone) que representa a semana visualizada.
 */
export function resolveWeekStart(weekParam: string | null | undefined): Date {
  if (!weekParam) {
    return startOfWeek(new Date(), { locale: pt, weekStartsOn: 1 });
  }

  // ISO week format: 2026-W21
  const isoWeekMatch = /^(\d{4})-W(\d{2})$/.exec(weekParam);
  if (isoWeekMatch && isoWeekMatch[1] && isoWeekMatch[2]) {
    const year = Number.parseInt(isoWeekMatch[1], 10);
    const week = Number.parseInt(isoWeekMatch[2], 10);
    if (
      Number.isFinite(year) &&
      Number.isFinite(week) &&
      year >= 1970 &&
      year <= 9999 &&
      week >= 1 &&
      week <= 53
    ) {
      // Estimate via Jan 4 (always week 1 per ISO 8601) + offset
      const jan4 = new Date(year, 0, 4);
      const firstMonday = startOfWeek(jan4, { locale: pt, weekStartsOn: 1 });
      return addWeeks(firstMonday, week - 1);
    }
  }

  // ISO date format: 2026-05-18 → week containing that day
  const isoDateMatch = /^\d{4}-\d{2}-\d{2}$/.exec(weekParam);
  if (isoDateMatch) {
    try {
      const parsed = parseISO(weekParam);
      if (!Number.isNaN(parsed.getTime())) {
        return startOfWeek(parsed, { locale: pt, weekStartsOn: 1 });
      }
    } catch {
      // fall through
    }
  }

  return startOfWeek(new Date(), { locale: pt, weekStartsOn: 1 });
}

/** Lista os 7 dias da semana a partir de `weekStart` (Monday). */
export function buildWeekDays(weekStart: Date): readonly Date[] {
  return [0, 1, 2, 3, 4, 5, 6].map((offset) => addDays(weekStart, offset));
}

/**
 * Converte `Date` → ISO date string `YYYY-MM-DD` (sem hora nem fuso).
 *
 * Usa componentes locais (ano/mês/dia) para evitar UTC shift em datas próximas
 * de midnight — semelhante a `format(date, 'yyyy-MM-dd')` mas mais barato.
 */
export function toDayIso(date: Date): DayIso {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** ISO date string → Date local. */
export function fromDayIso(dayIso: DayIso): Date {
  return parseISO(dayIso);
}

/** Format dia da semana abreviado PT-PT: "Seg", "Ter"... */
export function formatDayShort(date: Date): string {
  // 'EEE' produz "seg", "ter" — capitalizar primeira letra.
  const raw = format(date, 'EEE', { locale: pt });
  return raw.charAt(0).toUpperCase() + raw.slice(1, 3);
}

/** Format dia + mês abreviado PT-PT: "14 Mai". */
export function formatDayMonth(date: Date): string {
  // 'd MMM' → "14 mai" → capitalizar mês.
  const raw = format(date, 'd MMM', { locale: pt });
  return raw.replace(/\s([a-zà-ú])/i, (_, c) => ' ' + c.toUpperCase());
}

/**
 * Format título range "12 a 18 Maio 2026" / cross-month / cross-year.
 *
 * Cross-month: "30 Abr a 6 Mai 2026"
 * Cross-year: "29 Dez 2025 a 4 Jan 2026"
 */
export function formatWeekRange(weekStart: Date): string {
  const weekEnd = addDays(weekStart, 6);

  const sameYear = weekStart.getFullYear() === weekEnd.getFullYear();
  const sameMonth = sameYear && weekStart.getMonth() === weekEnd.getMonth();

  if (sameMonth) {
    const dayStart = format(weekStart, 'd', { locale: pt });
    const dayEnd = format(weekEnd, 'd', { locale: pt });
    const monthYear = format(weekEnd, 'MMMM yyyy', { locale: pt });
    const monthYearCap = monthYear.charAt(0).toUpperCase() + monthYear.slice(1);
    return `${dayStart} a ${dayEnd} ${monthYearCap}`;
  }

  if (sameYear) {
    const startStr = format(weekStart, 'd MMM', { locale: pt });
    const startCap = startStr.replace(/\s([a-zà-ú])/i, (_, c) => ' ' + c.toUpperCase());
    const endMonth = format(weekEnd, 'MMM', { locale: pt });
    const endMonthCap = endMonth.charAt(0).toUpperCase() + endMonth.slice(1);
    const endDay = format(weekEnd, 'd', { locale: pt });
    const endYear = format(weekEnd, 'yyyy', { locale: pt });
    return `${startCap} a ${endDay} ${endMonthCap} ${endYear}`;
  }

  // Cross-year
  const startMonth = format(weekStart, 'MMM', { locale: pt });
  const startMonthCap = startMonth.charAt(0).toUpperCase() + startMonth.slice(1);
  const startDay = format(weekStart, 'd', { locale: pt });
  const startYear = format(weekStart, 'yyyy', { locale: pt });
  const endMonth = format(weekEnd, 'MMM', { locale: pt });
  const endMonthCap = endMonth.charAt(0).toUpperCase() + endMonth.slice(1);
  const endDay = format(weekEnd, 'd', { locale: pt });
  const endYear = format(weekEnd, 'yyyy', { locale: pt });
  return `${startDay} ${startMonthCap} ${startYear} a ${endDay} ${endMonthCap} ${endYear}`;
}

/** Format ISO week string `2026-W21` para URL state. */
export function formatWeekIso(weekStart: Date): WeekIso {
  return format(weekStart, "yyyy-'W'II", { locale: pt });
}

/** Verifica se `date` é hoje (timezone local). */
export function isToday(date: Date): boolean {
  return isSameDay(date, new Date());
}

/** Date next/previous helpers (1 week). */
export function addWeeksLocal(date: Date, n: number): Date {
  return addWeeks(date, n);
}
