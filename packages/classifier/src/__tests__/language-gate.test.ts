/**
 * Testes do language gate PT-PT.
 *
 * Trace: Story 2.4 AC6 + AC11 (language-gate.test.ts mínimo 16 casos).
 *
 * Estratégia:
 *   - 10+ frases PT-PT legítimas DEVEM passar (`isPortugueseEuropean: true`).
 *   - 5+ frases NON-PT-PT (PT-BR, EN, ES) DEVEM falhar
 *     (`isPortugueseEuropean: false`).
 *   - Edge cases: empty, whitespace.
 */
import { describe, expect, it } from 'vitest';

import { detectNonPtPt } from '@/language-gate';

describe('detectNonPtPt — frases PT-PT legítimas (zero falsos positivos)', () => {
  it.each([
    'comprar pão amanhã',
    'paguei €78,70 no supermercado',
    'amanhã reunião às 15h',
    'lembra-me de ligar à minha mãe',
    'renda de 600 euros todo o dia 1',
    'cartão Millennium fim do mês',
    'computador 1200 euros em 12 prestações',
    'quanto gastei este mês?',
    'que tarefas tenho amanhã?',
    'anula a última',
    'preciso de ir ao Pingo Doce',
    'o senhor doutor mandou tomar o medicamento',
  ])('aceita: %s', (text) => {
    const result = detectNonPtPt(text);
    expect(result.isPortugueseEuropean).toBe(true);
    expect(result.detectedPatterns).toEqual([]);
  });
});

describe('detectNonPtPt — frases NÃO-PT-PT (rejeição correcta)', () => {
  it.each([
    ['você precisa fazer isso', 'pt-br:voce'],
    ['vou deletar este ficheiro', 'pt-br:deletar'],
    ['preciso checar a conta', 'pt-br:checar'],
    ['the cat is on the table', 'en:the'],
    ['what time is it now', 'en:what'],
    ['¿qué hora es?', 'es:invertedpunct'],
    ['usted tiene que pagar', 'es:usted'],
    ['ahora mismo voy', 'es:ahora'],
  ])('rejeita: %s (pattern %s)', (text, expectedPattern) => {
    const result = detectNonPtPt(text);
    expect(result.isPortugueseEuropean).toBe(false);
    expect(result.detectedPatterns).toContain(expectedPattern);
  });
});

describe('detectNonPtPt — edge cases', () => {
  it('aceita string vazia (validação separada apanha em Classifier)', () => {
    expect(detectNonPtPt('').isPortugueseEuropean).toBe(true);
  });

  it('aceita só whitespace', () => {
    expect(detectNonPtPt('   \t\n  ').isPortugueseEuropean).toBe(true);
  });

  it('detecta MÚLTIPLOS padrões em simultâneo', () => {
    const result = detectNonPtPt('you should deletar the file');
    expect(result.isPortugueseEuropean).toBe(false);
    expect(result.detectedPatterns.length).toBeGreaterThanOrEqual(2);
    expect(result.detectedPatterns).toContain('en:you');
  });

  it('case-insensitive — "VOCÊ" é detectado', () => {
    const result = detectNonPtPt('VOCÊ DEVE FAZER ISSO');
    expect(result.isPortugueseEuropean).toBe(false);
    expect(result.detectedPatterns).toContain('pt-br:voce');
  });
});
