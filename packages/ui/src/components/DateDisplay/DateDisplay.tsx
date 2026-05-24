/**
 * `<DateDisplay>` — formatação de datas PT-PT centralizada (Story 5.2 AC4).
 *
 * Ponto ÚNICO de formatação de datas no monorepo, complementar a
 * `<MoneyDisplay>` (Story 4.6 → migrado para `@meu-jarvis/ui` em 5.2 AC3).
 *
 * Usa `Intl.DateTimeFormat('pt-PT')` com instâncias module-level (zero
 * allocation por render). 4 presets:
 *   - `short`     → `"14/03/2026"`            (default)
 *   - `long`      → `"14 de março de 2026"`
 *   - `time`      → `"14:32"`                 (HH:mm, 24h)
 *   - `datetime`  → `"14/03/2026 14:32"`      (composição short + time)
 *
 * **PO_FIX_INLINE F4 v1.1 — Cuidado timezone:** este componente normaliza
 * `value` para `Date` via `new Date(...)`. Em PT-PT (Europe/Lisbon, UTC+0/+1)
 * inputs ISO 8601 com sufixo `Z` (UTC) ou offset explícito podem renderizar
 * o dia anterior se o instante UTC for próximo da meia-noite. Para datas
 * "civis" sem componente temporal (`'2026-03-14'`), o construtor `Date` em
 * JS parse como UTC midnight — em timezone PT pode render correctamente o
 * dia 14, mas em CET DST edges pode haver casos limite.
 *
 * Recomendação: para datas civis (sem hora), preferir `<DateDisplay
 * value={parseISO(iso)} preset="short">` (date-fns parseISO preserva o dia
 * civil) ou manter `date-fns` localmente onde precisão for crítica
 * (ex: `CardStatementCard.tsx:21` — decisão @dev T4.7 DISCRICIONÁRIA).
 *
 * Trace: Story 5.2 AC4; Epic 5 §8 DP6; language-standards.md (PT-PT format
 * `DD/MM/YYYY` mandatório vs `MM/DD/YYYY` americano proibido).
 */
import type * as React from 'react';

// ─── Formatters module-level (zero alloc por render) ─────────────────────

const shortFormatter = new Intl.DateTimeFormat('pt-PT', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const longFormatter = new Intl.DateTimeFormat('pt-PT', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
});

const timeFormatter = new Intl.DateTimeFormat('pt-PT', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

// ─── Public API ──────────────────────────────────────────────────────────

export type DatePreset = 'short' | 'long' | 'time' | 'datetime';

export interface DateDisplayProps {
  /** Data a apresentar — aceita Date, ISO string, ou timestamp ms. */
  readonly value: Date | string | number;
  /** Preset PT-PT — ver JSDoc do ficheiro. Default: `short`. */
  readonly preset?: DatePreset;
  readonly className?: string;
}

/**
 * Normaliza `value` para `Date`. Em JS, `new Date(Date)` retorna nova
 * instância (não muta); `new Date(string|number)` faz parsing standard.
 */
function toDate(value: Date | string | number): Date {
  return value instanceof Date ? value : new Date(value);
}

/**
 * Formata data PT-PT como string (helper standalone, análogo a
 * `formatEuroCents` em `<MoneyDisplay>`). Útil em strings (não-JSX).
 */
export function formatDate(value: Date | string | number, preset: DatePreset = 'short'): string {
  const date = toDate(value);
  switch (preset) {
    case 'short':
      return shortFormatter.format(date);
    case 'long':
      return longFormatter.format(date);
    case 'time':
      return timeFormatter.format(date);
    case 'datetime':
      return `${shortFormatter.format(date)} ${timeFormatter.format(date)}`;
  }
}

export function DateDisplay({
  value,
  preset = 'short',
  className = '',
}: DateDisplayProps): React.ReactElement {
  const text = formatDate(value, preset);
  return <span className={`tabular-nums ${className}`.trim()}>{text}</span>;
}
