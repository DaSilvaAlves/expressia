/**
 * Testes para `chunkArray` — split de N elementos em sub-arrays de tamanho fixo.
 *
 * Trace: Story 4.10 D-4.10.4 + Task T2.
 */
import { describe, expect, it } from 'vitest';

import { chunkArray } from '../chunk-array';

describe('chunkArray', () => {
  it('array vazio → []', () => {
    expect(chunkArray([], 10)).toEqual([]);
  });

  it('split 5 em chunks de 2 → [[1,2], [3,4], [5]]', () => {
    expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('split 60 em chunks de 10 → 6 sub-arrays de 10', () => {
    const arr = Array.from({ length: 60 }, (_, i) => i + 1);
    const chunks = chunkArray(arr, 10);
    expect(chunks.length).toBe(6);
    for (const c of chunks) {
      expect(c.length).toBe(10);
    }
    expect(chunks[0]?.[0]).toBe(1);
    expect(chunks[5]?.[9]).toBe(60);
  });

  it('split 12 em chunks de 10 → [10, 2]', () => {
    const arr = Array.from({ length: 12 }, (_, i) => i + 1);
    const chunks = chunkArray(arr, 10);
    expect(chunks.length).toBe(2);
    expect(chunks[0]?.length).toBe(10);
    expect(chunks[1]?.length).toBe(2);
  });

  it('chunkSize maior que length → 1 chunk com tudo', () => {
    expect(chunkArray([1, 2], 5)).toEqual([[1, 2]]);
  });

  it('rejeita chunkSize = 0', () => {
    expect(() => chunkArray([1, 2], 0)).toThrow(/>= 1/);
  });

  it('rejeita chunkSize negativo', () => {
    expect(() => chunkArray([1, 2], -1)).toThrow(/>= 1/);
  });
});
