// @vitest-environment node
/**
 * Testes da validação pura do formulário de nova palavra-passe (Soft-launch A2).
 * Espelha as regras do registo: mínimo 8 caracteres + confirmação coincidente.
 */
import { describe, expect, it } from 'vitest';

import { validateNewPassword } from '@/app/(auth)/recuperar/nova-palavra-passe/_lib/validate';

describe('validateNewPassword (A2)', () => {
  it('aceita palavra-passe válida e confirmação coincidente', () => {
    expect(validateNewPassword('segredo123', 'segredo123')).toBeNull();
  });

  it('rejeita palavra-passe com menos de 8 caracteres', () => {
    expect(validateNewPassword('curta', 'curta')).toMatch(/pelo menos 8/i);
  });

  it('rejeita quando a confirmação não coincide', () => {
    expect(validateNewPassword('segredo123', 'diferente1')).toMatch(/não coincidem/i);
  });

  it('a regra de comprimento tem precedência sobre a de coincidência', () => {
    // Ambas falham; deve devolver a mensagem de comprimento primeiro.
    expect(validateNewPassword('abc', 'xyz')).toMatch(/pelo menos 8/i);
  });

  it('aceita exactamente 8 caracteres (fronteira)', () => {
    expect(validateNewPassword('12345678', '12345678')).toBeNull();
  });
});
