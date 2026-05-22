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
 * CHECK); o sinal/cor visual vem da prop `tone`, NUNCA do valor.
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
   * Sinal visual: `expense` a vermelho com prefixo `−`, `income` a verde com
   * prefixo `+`, `neutral` sem cor nem prefixo. Default: `neutral`.
   */
  readonly tone?: 'expense' | 'income' | 'neutral';
  readonly className?: string;
}

export function MoneyDisplay({
  cents,
  tone = 'neutral',
  className = '',
}: MoneyDisplayProps): React.ReactElement {
  const formatted = formatEuroCents(cents);
  const prefix = tone === 'expense' ? '−' : tone === 'income' ? '+' : '';
  const toneClass =
    tone === 'expense'
      ? 'text-red-600 dark:text-red-400'
      : tone === 'income'
        ? 'text-green-600 dark:text-green-400'
        : '';
  const text = `${prefix}${formatted}`;

  return (
    <span className={`tabular-nums ${toneClass} ${className}`.trim()} aria-label={text}>
      {text}
    </span>
  );
}
