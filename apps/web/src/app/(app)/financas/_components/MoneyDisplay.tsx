/**
 * `<MoneyDisplay>` — formatação monetária PT-PT centralizada (Story 4.6 AC2,
 * D-4.6.1, D-4.6.9).
 *
 * Ponto ÚNICO de formatação de valores em euros nas vistas de Finanças
 * (reutilizado por 4.6-4.9). Nunca formatar moeda inline (CON3/CON9).
 *
 * D-4.6.9 — porquê não `Intl.NumberFormat` com `style: 'currency'`: o estilo
 * `currency` em `pt-PT` emite o símbolo à direita (`1.234,56 €`), o que
 * contradiz o formato de marca mandatado pelo `CLAUDE.md` (`€1.234,56` —
 * símbolo à esquerda). Usa-se o `Intl.NumberFormat('pt-PT')` apenas para a
 * magnitude (separadores de milhar/decimal correctos) e prefixa-se `€`.
 *
 * `amount_cents` é sempre positivo no schema (`transactions_amount_positive`
 * CHECK); o sinal/cor visual vem da prop `tone`, NUNCA do valor — para
 * transacções.
 *
 * Story 4.9 D-4.9.8 — extensão aditiva: `tone="signed"` apresenta um valor
 * que PODE ser negativo (saldos de conta / património), em que o sinal
 * mostrado é o sinal REAL do valor (`−` quando `cents < 0`, nada quando
 * `cents >= 0` — nunca `+`) e a cor é vermelha quando negativo, neutra
 * quando >= 0. Os tones existentes (`expense`/`income`/`neutral`) NÃO mudam.
 */

/** Formatador de magnitude — separadores PT-PT (`,` decimal). */
const numberFormatter = new Intl.NumberFormat('pt-PT', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Formata cêntimos de euro como string PT-PT com prefixo `€`.
 * Ex: `12345` → `"€123,45"`. Usa o valor absoluto — o sinal é responsabilidade
 * do chamador (via `tone` em `<MoneyDisplay>`).
 */
export function formatEuroCents(cents: number): string {
  return `€${numberFormatter.format(Math.abs(cents) / 100)}`;
}

export interface MoneyDisplayProps {
  /** Valor em cêntimos de euro (inteiro — schema `*_cents integer`). */
  readonly cents: number;
  /**
   * Sinal visual:
   *  - `expense` → prefixo `−`, vermelho (transacção de despesa, valor sempre positivo no schema)
   *  - `income`  → prefixo `+`, verde (transacção de receita, valor sempre positivo no schema)
   *  - `neutral` → sem prefixo, sem cor (uso geral, descarta sinal — magnitude)
   *  - `signed`  → prefixo `−` quando `cents < 0`, nada quando `cents >= 0`; vermelho se negativo,
   *                neutro se positivo. Story 4.9 D-4.9.8 — saldos de conta / património.
   *  Default: `neutral`.
   */
  readonly tone?: 'expense' | 'income' | 'neutral' | 'signed';
  readonly className?: string;
}

export function MoneyDisplay({
  cents,
  tone = 'neutral',
  className = '',
}: MoneyDisplayProps): React.ReactElement {
  const formatted = formatEuroCents(cents);

  let prefix = '';
  let toneClass = '';
  if (tone === 'expense') {
    prefix = '−';
    toneClass = 'text-red-600 dark:text-red-400';
  } else if (tone === 'income') {
    prefix = '+';
    toneClass = 'text-green-600 dark:text-green-400';
  } else if (tone === 'signed') {
    // D-4.9.8 — sinal real do valor; nunca `+`; vermelho se negativo, neutro se >= 0.
    if (cents < 0) {
      prefix = '−';
      toneClass = 'text-red-600 dark:text-red-400';
    }
  }
  const text = `${prefix}${formatted}`;

  return (
    <span className={`tabular-nums ${toneClass} ${className}`.trim()} aria-label={text}>
      {text}
    </span>
  );
}
