// @vitest-environment node
/**
 * Testes — `parseEuroInputToCents` (A1 make-it-work).
 *
 * Convenção PT-PT (CON9): vírgula decimal, ponto de milhares. Excepção
 * pragmática para ponto decimal US ("13.50") quando não há vírgula.
 */
import { describe, expect, it } from 'vitest';

import { parseEuroInputToCents } from '@/lib/finance/money';

describe('parseEuroInputToCents', () => {
  it('aceita formato PT-PT com vírgula decimal', () => {
    expect(parseEuroInputToCents('13,50')).toBe(1350);
    expect(parseEuroInputToCents('13,5')).toBe(1350);
    expect(parseEuroInputToCents('0,50')).toBe(50);
    expect(parseEuroInputToCents('0,05')).toBe(5);
  });

  it('aceita inteiros sem separador decimal', () => {
    expect(parseEuroInputToCents('13')).toBe(1300);
    expect(parseEuroInputToCents('1')).toBe(100);
  });

  it('aceita milhares com ponto (1.234,56 PT-PT)', () => {
    expect(parseEuroInputToCents('1.234,56')).toBe(123456);
    expect(parseEuroInputToCents('1.234')).toBe(123400);
    expect(parseEuroInputToCents('12.345.678,90')).toBe(1234567890);
  });

  it('aceita símbolo € e espaços', () => {
    expect(parseEuroInputToCents('€ 13,50')).toBe(1350);
    expect(parseEuroInputToCents(' 13,50 € ')).toBe(1350);
    expect(parseEuroInputToCents('1 234,56')).toBe(123456);
  });

  it('aceita ponto decimal US quando não há vírgula (13.50)', () => {
    expect(parseEuroInputToCents('13.50')).toBe(1350);
    expect(parseEuroInputToCents('13.5')).toBe(1350);
  });

  it('rejeita vazio, zero e valores não-positivos', () => {
    expect(parseEuroInputToCents('')).toBeNull();
    expect(parseEuroInputToCents('   ')).toBeNull();
    expect(parseEuroInputToCents('0')).toBeNull();
    expect(parseEuroInputToCents('0,00')).toBeNull();
    expect(parseEuroInputToCents('-13,50')).toBeNull();
  });

  it('rejeita inputs malformados', () => {
    expect(parseEuroInputToCents('abc')).toBeNull();
    expect(parseEuroInputToCents('13,505')).toBeNull(); // 3 casas decimais
    expect(parseEuroInputToCents('1,2,3')).toBeNull(); // 2 vírgulas
    expect(parseEuroInputToCents('13,')).toBeNull(); // vírgula sem decimais
    expect(parseEuroInputToCents('12.34.56')).toBeNull(); // pontos inválidos sem vírgula
  });
});
