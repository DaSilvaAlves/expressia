// @vitest-environment node
/**
 * Tests — helpers de saudação `getGreeting` / `resolveDisplayName` /
 * `formatGreetingDate` (Story 5.6 AC2, AC9.a).
 *
 * `getGreeting`: 3 ramos (manhã/tarde/noite) via `vi.setSystemTime` — usamos
 * instantes em horas-Lisboa explícitas (offset UTC+1 no Verão DST, +0 no Inverno).
 * `resolveDisplayName`: metadata.name → full_name → email local-part → fallback.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  formatGreetingDate,
  getGreeting,
  resolveDisplayName,
} from '@/app/(app)/visao/_lib/greeting';

afterEach(() => {
  vi.useRealTimers();
});

describe('getGreeting', () => {
  it('"Bom dia" antes das 12h (Lisbon)', () => {
    // 2026-03-14 09:00 UTC → 09:00 Lisbon (Inverno, UTC+0).
    expect(getGreeting(new Date('2026-03-14T09:00:00Z'))).toBe('Bom dia');
  });

  it('"Boa tarde" entre 12h e 19h59 (Lisbon)', () => {
    // 2026-03-14 15:00 UTC → 15:00 Lisbon.
    expect(getGreeting(new Date('2026-03-14T15:00:00Z'))).toBe('Boa tarde');
  });

  it('"Boa noite" às 20h ou mais (Lisbon)', () => {
    // 2026-03-14 21:00 UTC → 21:00 Lisbon.
    expect(getGreeting(new Date('2026-03-14T21:00:00Z'))).toBe('Boa noite');
  });

  it('boundary 11h59 ainda é "Bom dia"; 12h00 já é "Boa tarde"', () => {
    expect(getGreeting(new Date('2026-01-10T11:59:00Z'))).toBe('Bom dia');
    expect(getGreeting(new Date('2026-01-10T12:00:00Z'))).toBe('Boa tarde');
  });

  it('boundary 19h59 ainda é "Boa tarde"; 20h00 já é "Boa noite"', () => {
    expect(getGreeting(new Date('2026-01-10T19:59:00Z'))).toBe('Boa tarde');
    expect(getGreeting(new Date('2026-01-10T20:00:00Z'))).toBe('Boa noite');
  });
});

describe('resolveDisplayName', () => {
  it('usa user_metadata.name quando presente', () => {
    expect(resolveDisplayName({ email: 'a@b.pt', user_metadata: { name: 'João' } })).toBe('João');
  });

  it('usa user_metadata.full_name quando name ausente', () => {
    expect(
      resolveDisplayName({ email: 'a@b.pt', user_metadata: { full_name: 'João Silva' } }),
    ).toBe('João Silva');
  });

  it('fallback para parte local do email capitalizada', () => {
    expect(resolveDisplayName({ email: 'eurico@expressia.pt' })).toBe('Eurico');
  });

  it('ignora name/full_name vazios (só whitespace) e cai no email', () => {
    expect(
      resolveDisplayName({ email: 'maria@x.pt', user_metadata: { name: '   ', full_name: '' } }),
    ).toBe('Maria');
  });

  it('fallback final "amigo" quando nem email existe', () => {
    expect(resolveDisplayName({})).toBe('amigo');
    expect(resolveDisplayName(null)).toBe('amigo');
  });
});

describe('formatGreetingDate', () => {
  it('formata "{dia-da-semana}, DD/MM/YYYY" em PT-PT', () => {
    // 2026-03-14 é um sábado.
    const result = formatGreetingDate(new Date('2026-03-14T10:00:00Z'));
    expect(result).toContain('14/03/2026');
    expect(result.toLowerCase()).toContain('sábado');
  });
});
