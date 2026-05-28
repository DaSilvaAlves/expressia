/**
 * Helpers de formatação partilhados pelos widgets da Visão (Story 5.6 AC4).
 *
 * - `priorityDotClass(priority)` — classe Tailwind do dot de prioridade
 *   (espelho de `CalendarTaskCard.tsx:32`, consistência visual com Tarefas).
 * - `formatDueTime(dueTime)` — normaliza `HH:MM:SS`/`HH:MM` → `HH:MM` (24h).
 *
 * Funções puras testáveis. NÃO formatam moeda nem datas civis — isso é do
 * `<MoneyDisplay>`/`<DateDisplay>` de `@meu-jarvis/ui` (CON9 / Story 5.2).
 *
 * Trace: Story 5.6 AC4(c); precedente `CalendarTaskCard.tsx`.
 */

/** Classe do dot de prioridade — match byte-a-byte com `CalendarTaskCard`. */
export function priorityDotClass(priority: 'low' | 'medium' | 'high'): string {
  switch (priority) {
    case 'high':
      return 'bg-red-500';
    case 'medium':
      return 'bg-amber-500';
    case 'low':
    default:
      return 'bg-neutral-400';
  }
}

/**
 * Normaliza um `dueTime` da API (`'HH:MM:SS'` ou `'HH:MM'`) para `'HH:MM'`.
 * Devolve `null` quando o input é `null` ou malformado — o widget decide se
 * mostra (não formatamos `€`/datas à mão; isto é só hora-do-dia, sem timezone).
 */
export function formatDueTime(dueTime: string | null): string | null {
  if (!dueTime) return null;
  const match = /^(\d{2}):(\d{2})/.exec(dueTime);
  if (!match) return null;
  return `${match[1]}:${match[2]}`;
}
