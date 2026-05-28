// @vitest-environment node
/**
 * Tests — helpers de formatação dos widgets (`priorityDotClass`, `formatDueTime`)
 * (Story 5.6 AC4.c, AC9).
 */
import { describe, expect, it } from 'vitest';

import { formatDueTime, priorityDotClass } from '@/app/(app)/visao/_lib/format';

describe('priorityDotClass', () => {
  it('mapeia high/medium/low para as cores correctas', () => {
    expect(priorityDotClass('high')).toBe('bg-red-500');
    expect(priorityDotClass('medium')).toBe('bg-amber-500');
    expect(priorityDotClass('low')).toBe('bg-neutral-400');
  });
});

describe('formatDueTime', () => {
  it('normaliza HH:MM:SS → HH:MM', () => {
    expect(formatDueTime('14:32:00')).toBe('14:32');
  });

  it('aceita HH:MM directamente', () => {
    expect(formatDueTime('09:05')).toBe('09:05');
  });

  it('devolve null para null e para strings malformadas', () => {
    expect(formatDueTime(null)).toBeNull();
    expect(formatDueTime('sem-hora')).toBeNull();
    expect(formatDueTime('')).toBeNull();
  });
});
