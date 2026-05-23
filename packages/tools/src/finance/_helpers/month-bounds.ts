/**
 * `computeMonthBounds` — computa o primeiro e último dia do mês de uma
 * data âncora ISO YYYY-MM-DD.
 *
 * Output esperado por `getMonthSummary({ db, monthStart, monthEnd })`
 * (Story 4.6 — `apps/web/src/lib/finance/month-summary.ts:79-83`).
 *
 * Exemplos:
 *   - "2026-05-23" → { monthStart: "2026-05-01", monthEnd: "2026-05-31" }
 *   - "2024-02-15" → { monthStart: "2024-02-01", monthEnd: "2024-02-29" }  (bissexto)
 *   - "2026-02-15" → { monthStart: "2026-02-01", monthEnd: "2026-02-28" }
 *   - "2026-12-01" → { monthStart: "2026-12-01", monthEnd: "2026-12-31" }
 *
 * Função pura.
 *
 * Trace: Story 4.10 PO_FIX_INLINE F5 + AC5 + Task T2.5.
 */

export interface MonthBounds {
  readonly monthStart: string;
  readonly monthEnd: string;
}

export function computeMonthBounds(anchor: string): MonthBounds {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(anchor);
  if (!match) {
    throw new Error(
      `computeMonthBounds: anchor deve estar no formato YYYY-MM-DD (recebido "${anchor}")`,
    );
  }
  const yearStr = match[1] as string;
  const monthStr = match[2] as string;

  const year = Number(yearStr);
  const month = Number(monthStr);

  if (month < 1 || month > 12) {
    throw new Error(
      `computeMonthBounds: mês inválido ${String(month)} em "${anchor}"`,
    );
  }

  const lastDay = lastDayOfMonth(year, month);

  return {
    monthStart: `${yearStr}-${monthStr}-01`,
    monthEnd: `${yearStr}-${monthStr}-${pad2(lastDay)}`,
  };
}

function lastDayOfMonth(year: number, month: number): number {
  switch (month) {
    case 1:
    case 3:
    case 5:
    case 7:
    case 8:
    case 10:
    case 12:
      return 31;
    case 4:
    case 6:
    case 9:
    case 11:
      return 30;
    case 2:
      return isLeapYear(year) ? 29 : 28;
    default:
      throw new Error(`computeMonthBounds: mês inválido ${String(month)}`);
  }
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function pad2(n: number): string {
  return n < 10 ? `0${String(n)}` : String(n);
}
