/**
 * Tests — `<RecurrenceFrequencyLabel>` + `frequencyLabel` (Story 4.7 AC6, D-4.7.6).
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import {
  RecurrenceFrequencyLabel,
  frequencyLabel,
} from '@/app/(app)/financas/_components/RecurrenceFrequencyLabel';

describe('frequencyLabel', () => {
  it('mapeia as 7 frequências para PT-PT', () => {
    expect(frequencyLabel('daily')).toBe('Diária');
    expect(frequencyLabel('weekly')).toBe('Semanal');
    expect(frequencyLabel('biweekly')).toBe('Quinzenal');
    expect(frequencyLabel('monthly')).toBe('Mensal');
    expect(frequencyLabel('quarterly')).toBe('Trimestral');
    expect(frequencyLabel('yearly')).toBe('Anual');
    expect(frequencyLabel('custom')).toBe('Personalizada');
  });
});

describe('<RecurrenceFrequencyLabel>', () => {
  it('renderiza "Mensal" para monthly', () => {
    render(<RecurrenceFrequencyLabel frequency="monthly" />);
    expect(screen.getByText('Mensal')).toBeInTheDocument();
  });

  it('renderiza "Quinzenal" para biweekly', () => {
    render(<RecurrenceFrequencyLabel frequency="biweekly" />);
    expect(screen.getByText('Quinzenal')).toBeInTheDocument();
  });

  it('renderiza "Personalizada" para custom', () => {
    render(<RecurrenceFrequencyLabel frequency="custom" />);
    expect(screen.getByText('Personalizada')).toBeInTheDocument();
  });
});
