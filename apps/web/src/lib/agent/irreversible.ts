/**
 * Story J-7 UNDO-MISLEAD-1 — detecção de escritas externas IRREVERSÍVEIS.
 *
 * Algumas tools fazem uma escrita externa que NÃO tem undo real (o `reverse`
 * devolve o sentinela inerte `_noop`). O caso nuclear é `enviar_email`: um email
 * enviado não pode ser "des-enviado". Para estas, a camada de resposta (webhook
 * Telegram / summary do confirm) NÃO deve oferecer a afordância de undo enganadora
 * — nem o botão "(Cancelar)", nem "Tens 30 segundos para reverter", nem
 * "Revertido." — porque afirmar que a acção foi revertida seria mentira.
 *
 * Distinto do `_noop` das tools de LEITURA (`consultar_emails`): essas já não
 * oferecem undo porque o outcome é marcado `readOnly`. Aqui o `_noop` é de uma
 * ESCRITA consumada e irreversível — a honestidade da resposta é o valor nuclear
 * do produto ("a confiança é o produto").
 *
 * Módulo-folha deliberadamente sem dependências pesadas (só tipos de
 * `@meu-jarvis/planner-executor`) — importado por `run-agent.ts`,
 * `confirm/route.ts` e o webhook do Telegram sem arrastar o grafo do pipeline.
 *
 * Trace: Story J-7 QA gate concern UNDO-MISLEAD-1.
 */
import type { AtomicOutcome, AtomicResult } from '@meu-jarvis/planner-executor';

/**
 * Tools cuja escrita externa é irreversível (sem undo real; `reverse` = `_noop`).
 * Restrito a `enviar_email` — a única escrita irreversível do Jarvis (v1.1).
 */
export const IRREVERSIBLE_WRITE_TOOLS: ReadonlySet<string> = new Set(['enviar_email']);

/**
 * O outcome executado contém alguma tool de escrita externa irreversível?
 *
 * Usado pela camada de resposta para suprimir a afordância de undo enganadora.
 * Falha `false` para outcomes de rollback (`success: false`) — não há nada
 * executado a assinalar.
 */
export function outcomeHasIrreversibleWrite(outcome: AtomicOutcome): boolean {
  if (outcome.success === false) {
    return false;
  }
  const result = outcome as AtomicResult;
  return (result.results ?? []).some((r) => IRREVERSIBLE_WRITE_TOOLS.has(r.toolName));
}
