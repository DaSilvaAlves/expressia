/**
 * `addMonthsSafe` — adição de meses a uma data ISO YYYY-MM-DD,
 * gerindo correctamente fronteiras de mês.
 *
 * Comportamento canónico (espelha a regra Postgres `date + interval '1 month'`):
 *   - `2026-01-31 + 1 mês` → `2026-02-28` (último dia de Fev em ano não-bissexto)
 *   - `2024-01-31 + 1 mês` → `2024-02-29` (ano bissexto)
 *   - `2026-01-30 + 1 mês` → `2026-02-28`
 *   - `2026-03-31 + 1 mês` → `2026-04-30`
 *   - `2026-08-31 + 6 meses` → `2027-02-28`
 *
 * Função pura: parsing manual (sem `new Date()` que sofre de timezone drift)
 * + cálculo de last-day-of-month determinístico.
 *
 * Trace: Story 4.10 PO_FIX_INLINE F4 (cálculo correcto da `transaction_date`
 * de parcela `i`) + Task T2.3.
 */

export function addMonthsSafe(date: string, delta: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) {
    throw new Error(
      `addMonthsSafe: data deve estar no formato YYYY-MM-DD (recebido "${date}")`,
    );
  }
  const yearStr = match[1] as string;
  const monthStr = match[2] as string;
  const dayStr = match[3] as string;

  const year = Number(yearStr);
  const month = Number(monthStr); // 1..12
  const day = Number(dayStr); // 1..31

  if (!Number.isInteger(delta)) {
    throw new Error(`addMonthsSafe: delta deve ser inteiro (recebido ${String(delta)})`);
  }

  // Mês 0-indexed para cálculo: month-1 + delta → normaliza dentro de [0..11]
  // com carry para year.
  const totalMonthsFromEpoch = (year - 1) * 12 + (month - 1) + delta;
  const newMonthIndex = ((totalMonthsFromEpoch % 12) + 12) % 12; // 0..11
  const newYear = Math.floor(totalMonthsFromEpoch / 12) + 1;
  const newMonth = newMonthIndex + 1; // 1..12

  const lastDay = lastDayOfMonth(newYear, newMonth);
  const newDay = Math.min(day, lastDay);

  return `${pad4(newYear)}-${pad2(newMonth)}-${pad2(newDay)}`;
}

function lastDayOfMonth(year: number, month: number): number {
  // [Jan, Feb, ..., Dec] — Feb depende de leap year.
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
      throw new Error(`addMonthsSafe: mês inválido ${String(month)}`);
  }
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function pad2(n: number): string {
  return n < 10 ? `0${String(n)}` : String(n);
}

function pad4(n: number): string {
  if (n < 10) return `000${String(n)}`;
  if (n < 100) return `00${String(n)}`;
  if (n < 1000) return `0${String(n)}`;
  return String(n);
}
