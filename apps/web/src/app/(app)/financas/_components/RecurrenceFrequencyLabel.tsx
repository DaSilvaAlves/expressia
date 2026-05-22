import type { FinanceRecurrenceFrequency } from '@/lib/finance/finance-recurrence-helpers';

/**
 * `<RecurrenceFrequencyLabel>` — mapeia o enum `recurrence_freq_finance` para
 * um label PT-PT (Story 4.7 AC4, D-4.7.6).
 *
 * Co-localizado em `financas/_components/` (D-4.6.1 — sem `packages/ui`).
 *
 * Trace: Story 4.7 AC4, D-4.7.6; finance.ts `recurrenceFreqFinanceEnum`.
 */
const FREQUENCY_LABELS: Record<FinanceRecurrenceFrequency, string> = {
  daily: 'Diária',
  weekly: 'Semanal',
  biweekly: 'Quinzenal',
  monthly: 'Mensal',
  quarterly: 'Trimestral',
  yearly: 'Anual',
  custom: 'Personalizada',
};

/** Devolve o label PT-PT de uma frequência de recorrência. */
export function frequencyLabel(frequency: FinanceRecurrenceFrequency): string {
  return FREQUENCY_LABELS[frequency];
}

export interface RecurrenceFrequencyLabelProps {
  readonly frequency: FinanceRecurrenceFrequency;
}

export function RecurrenceFrequencyLabel({
  frequency,
}: RecurrenceFrequencyLabelProps): React.ReactElement {
  return <span>{frequencyLabel(frequency)}</span>;
}
