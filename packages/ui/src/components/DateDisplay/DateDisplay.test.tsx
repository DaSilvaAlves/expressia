/**
 * Tests — `<DateDisplay>` + `formatDate` (Story 5.2 AC7).
 *
 * 4 presets cobertos com input fixo `new Date(2026, 2, 14, 14, 32, 0)` (Date
 * local — mês index 0-based: `2` = março). Evita-se ISO strings com sufixo
 * `Z` para não introduzir variação de timezone entre máquinas/CI (precedente
 * do `MoneyDisplay.test.tsx` que evita ambiguidade ICU).
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DateDisplay, formatDate } from './DateDisplay';

// Input fixo: 14 de março de 2026, 14:32 (Date local — sem timezone string).
const REF_DATE = new Date(2026, 2, 14, 14, 32, 0);

describe('formatDate', () => {
  it('preset short → DD/MM/YYYY (default)', () => {
    expect(formatDate(REF_DATE, 'short')).toBe('14/03/2026');
  });

  it('preset short é o default quando preset omitido', () => {
    expect(formatDate(REF_DATE)).toBe('14/03/2026');
  });

  it('preset long → "DD de Mês de YYYY"', () => {
    expect(formatDate(REF_DATE, 'long')).toBe('14 de março de 2026');
  });

  it('preset time → HH:mm (24h)', () => {
    expect(formatDate(REF_DATE, 'time')).toBe('14:32');
  });

  it('preset datetime → "DD/MM/YYYY HH:mm"', () => {
    expect(formatDate(REF_DATE, 'datetime')).toBe('14/03/2026 14:32');
  });

  it('aceita timestamp number como input', () => {
    expect(formatDate(REF_DATE.getTime(), 'short')).toBe('14/03/2026');
  });
});

describe('<DateDisplay>', () => {
  it('renderiza span com tabular-nums', () => {
    const { container } = render(<DateDisplay value={REF_DATE} />);
    const span = container.querySelector('span');
    expect(span).not.toBeNull();
    expect(span?.className).toContain('tabular-nums');
    expect(span?.textContent).toBe('14/03/2026');
  });

  it('preset datetime renderiza composição correcta', () => {
    const { container } = render(<DateDisplay value={REF_DATE} preset="datetime" />);
    expect(container.querySelector('span')?.textContent).toBe('14/03/2026 14:32');
  });
});
