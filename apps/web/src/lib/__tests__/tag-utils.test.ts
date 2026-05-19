// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { hexToRgb, isColorDark } from '@/lib/tag-utils';

describe('hexToRgb', () => {
  it('decompõe #RRGGBB válido', () => {
    expect(hexToRgb('#FFFFFF')).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb('#000000')).toEqual({ r: 0, g: 0, b: 0 });
    expect(hexToRgb('#6B7280')).toEqual({ r: 107, g: 114, b: 128 });
  });

  it('aceita hex em minúsculas', () => {
    expect(hexToRgb('#3b82f6')).toEqual({ r: 59, g: 130, b: 246 });
  });

  it('retorna null para formato inválido', () => {
    expect(hexToRgb('red')).toBeNull();
    expect(hexToRgb('#FFF')).toBeNull(); // 3-char short hex não aceite
    expect(hexToRgb('FFFFFF')).toBeNull(); // sem #
    expect(hexToRgb('#GGGGGG')).toBeNull(); // não-hex chars
  });
});

describe('isColorDark', () => {
  it('preto → dark', () => {
    expect(isColorDark('#000000')).toBe(true);
  });

  it('branco → não dark', () => {
    expect(isColorDark('#FFFFFF')).toBe(false);
  });

  it('cinzento médio #6B7280 → dark (luminância ≈ 113 < 128)', () => {
    expect(isColorDark('#6B7280')).toBe(true);
  });

  it('amarelo #EAB308 → não dark (alta luminância)', () => {
    expect(isColorDark('#EAB308')).toBe(false);
  });

  it('hex inválido → defaulta a dark (texto branco — defensivo)', () => {
    expect(isColorDark('not-a-color')).toBe(true);
  });
});
