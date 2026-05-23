/**
 * `chunkArray` — parte um array em sub-arrays de tamanho `chunkSize`.
 *
 * Usado por `create_installment.reverse()` para dividir N transaction IDs
 * em sub-composites de até `COMPOSITE_REVERSE_OP_MAX_OPS=10` elementos
 * (D-4.10.4 — respeitar o limite per-level recursivo).
 *
 * Exemplos:
 *   - chunkArray([1,2,3,4,5], 2) → [[1,2], [3,4], [5]]
 *   - chunkArray([1..60], 10)    → 6 sub-arrays de 10
 *   - chunkArray([], 10)         → []
 *
 * Função pura.
 *
 * Trace: Story 4.10 D-4.10.4 + AC4.
 */

export function chunkArray<T>(arr: readonly T[], chunkSize: number): T[][] {
  if (!Number.isInteger(chunkSize) || chunkSize < 1) {
    throw new Error(
      `chunkArray: chunkSize deve ser inteiro >= 1 (recebido ${String(chunkSize)})`,
    );
  }
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += chunkSize) {
    result.push(arr.slice(i, i + chunkSize));
  }
  return result;
}
