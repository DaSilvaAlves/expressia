/**
 * Parsing de valores monetários introduzidos pelo utilizador (PT-PT) — A1.
 *
 * Convenção PT-PT (CON9): vírgula é o separador decimal, ponto é separador de
 * milhares ("1.234,56"). Excepção pragmática: um único ponto seguido de 1-2
 * dígitos no fim, SEM vírgula presente ("13.50"), é tratado como separador
 * decimal — teclados numéricos e utilizadores habituados ao formato US.
 *
 * O valor devolvido é em cêntimos de euro (`amount_cents integer` — CON9), tal
 * como o `AmountCentsSchema` do endpoint exige: inteiro positivo.
 */

/**
 * Converte input livre ("13,50", "€ 1.234,56", "13.50", "13") em cêntimos.
 *
 * Devolve `null` quando o input não é um valor monetário positivo válido
 * (vazio, zero, negativo, mais de 2 casas decimais, caracteres estranhos).
 */
export function parseEuroInputToCents(raw: string): number | null {
  const stripped = raw.trim().replace(/€/g, '').replace(/\s+/g, '');
  if (!stripped) return null;

  let normalized: string;
  if (stripped.includes(',')) {
    // Vírgula presente → decimal PT-PT. Segunda vírgula é inválida ("1,2,3").
    if (stripped.indexOf(',') !== stripped.lastIndexOf(',')) return null;
    const [intRaw = '', decRaw = ''] = stripped.split(',');
    // Pontos na parte inteira têm de ser milhares bem agrupados ("1.234").
    if (intRaw.includes('.') && !/^\d{1,3}(\.\d{3})+$/.test(intRaw)) return null;
    normalized = `${intRaw.replace(/\./g, '')}.${decRaw}`;
  } else if (/^\d+\.\d{1,2}$/.test(stripped)) {
    // Ponto único decimal no fim sem vírgula ("13.5"/"13.50") — formato US.
    normalized = stripped;
  } else if (stripped.includes('.')) {
    // Sem vírgula → pontos só podem ser milhares bem agrupados ("1.234" = 1234 €).
    if (!/^\d{1,3}(\.\d{3})+$/.test(stripped)) return null;
    normalized = stripped.replace(/\./g, '');
  } else {
    normalized = stripped;
  }

  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;

  const [intPart = '', decPart = ''] = normalized.split('.');
  const cents = Number(intPart) * 100 + Number(`${decPart}00`.slice(0, 2));
  if (!Number.isSafeInteger(cents) || cents <= 0) return null;
  return cents;
}
