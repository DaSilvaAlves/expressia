/**
 * `formatEuroCents` — formata cêntimos em EUR PT-PT canónico.
 *
 * Regras PT-PT (CON9):
 *   - Vírgula como separador decimal: 7870 → "€78,70"
 *   - Sempre 2 casas decimais
 *   - Sem separador de milhar (mantém compacto para preview cards)
 *   - Sinal negativo prefixa o símbolo: -7870 → "-€78,70"
 *
 * Exemplos:
 *   - 0     → "€0,00"
 *   - 870   → "€8,70"
 *   - 7870  → "€78,70"
 *   - 12000 → "€120,00"
 *   - -500  → "-€5,00"
 *
 * Função pura — sem `Intl` para evitar deriva entre runtimes Node/jsdom.
 *
 * Trace: Story 4.10 AC1-AC4 (preview) + CON9.
 */

export function formatEuroCents(amountCents: number): string {
  if (!Number.isInteger(amountCents)) {
    throw new Error(
      `formatEuroCents: amountCents deve ser inteiro (recebido ${String(amountCents)})`,
    );
  }
  const isNegative = amountCents < 0;
  const absCents = Math.abs(amountCents);
  const euros = Math.floor(absCents / 100);
  const cents = absCents % 100;
  const centsPadded = cents < 10 ? `0${String(cents)}` : String(cents);
  return `${isNegative ? '-' : ''}€${String(euros)},${centsPadded}`;
}
