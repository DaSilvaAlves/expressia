/**
 * `computeInstallmentSplit` — núcleo de risco R-4.1 / R-4.10.1.
 *
 * Calcula a distribuição de cêntimos por parcela numa compra parcelada,
 * garantindo que a soma das parcelas é IGUAL ao total (sem perda de cêntimos).
 *
 * Fórmula (replicada de `apps/web/src/lib/api-schemas/installments.ts` —
 * Story 4.4, regra de domínio):
 *
 *   perInstallmentCents  = floor(totalAmountCents / numInstallments)
 *   lastInstallmentCents = totalAmountCents - (numInstallments - 1) * perInstallmentCents
 *
 * Invariante (verificado em todos os testes):
 *
 *   (numInstallments - 1) * perInstallmentCents + lastInstallmentCents === totalAmountCents
 *
 * Exemplos canónicos:
 *   - €1.000 / 3 →  333 + 333 + 334   (resto na última)
 *   - €100   / 7 →   14 ×6  + 16      (resto na última)
 *   - €1.200 / 12 → 100 × 12          (sem resto)
 *   - €1     / 1 →  1                 (caso trivial)
 *
 * Função pura — sem DB, sem I/O, determinística.
 *
 * Trace: Story 4.10 D-4.10.7 + AC4 + AC8 + R-4.10.1.
 */

export interface InstallmentSplit {
  readonly perInstallmentCents: number;
  readonly lastInstallmentCents: number;
  /** Array de N valores: [per, per, ..., per, last]. */
  readonly transactionAmounts: readonly number[];
}

export function computeInstallmentSplit(
  totalAmountCents: number,
  numInstallments: number,
): InstallmentSplit {
  if (!Number.isInteger(totalAmountCents) || totalAmountCents <= 0) {
    throw new Error(
      `computeInstallmentSplit: totalAmountCents deve ser inteiro positivo (recebido ${String(totalAmountCents)})`,
    );
  }
  if (
    !Number.isInteger(numInstallments) ||
    numInstallments < 1 ||
    numInstallments > 60
  ) {
    throw new Error(
      `computeInstallmentSplit: numInstallments deve ser inteiro entre 1 e 60 (recebido ${String(numInstallments)})`,
    );
  }

  const perInstallmentCents = Math.floor(totalAmountCents / numInstallments);
  const lastInstallmentCents =
    totalAmountCents - (numInstallments - 1) * perInstallmentCents;

  const transactionAmounts: number[] = [];
  for (let i = 1; i <= numInstallments; i += 1) {
    transactionAmounts.push(
      i === numInstallments ? lastInstallmentCents : perInstallmentCents,
    );
  }

  return {
    perInstallmentCents,
    lastInstallmentCents,
    transactionAmounts,
  };
}
