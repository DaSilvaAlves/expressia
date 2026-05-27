/**
 * Mapeamento de códigos de erro do backend → mensagens PT-PT amigáveis para
 * o chat `/jarvis`.
 *
 * Princípio (docs/ux/jarvis-error-ux-spec.md §2): o `error.code` decide a
 * mensagem; o `error.message` técnico do servidor NUNCA é renderizado no ecrã
 * — vai para Sentry/logs. Um código desconhecido (ou ausência de código)
 * resolve para um fallback genérico seguro, nunca para o `message` cru.
 *
 * Códigos cobertos: os 12 `apiError(...)` de `apps/web/src/app/api/agent/prompt/route.ts`.
 *
 * Trace: docs/ux/jarvis-error-ux-spec.md (spec UX de @ux-design-expert / Uma).
 */

/** Fallback seguro — usado para códigos desconhecidos ou ausência de código. */
const FALLBACK_MESSAGE = 'Erro temporário. Tenta de novo.';

/**
 * Detalhes opcionais do erro, vindos de `body.error.details`. Apenas os campos
 * usados para interpolação nas mensagens da tabela §3 da spec.
 */
export interface ErrorDetails {
  readonly retry_after_seconds?: number;
  readonly plan?: string;
  readonly period_end?: string;
}

/**
 * Formata um ISO 8601 para data/hora PT-PT — ex.: `14/05/2026 às 00:00`.
 * Valor inválido ou ausente → fallback neutro sem data.
 */
function formatPeriodEnd(periodEnd: string | undefined): string {
  if (!periodEnd) return 'no início do próximo período';
  const date = new Date(periodEnd);
  if (Number.isNaN(date.getTime())) return 'no início do próximo período';
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} às ${hh}:${min}`;
}

/**
 * Devolve a mensagem PT-PT amigável para um código de erro do backend.
 *
 * @param code - `body.error.code` da resposta do endpoint `/api/agent/prompt`.
 * @param details - `body.error.details` (opcional) — usado para interpolar
 *   `retry_after_seconds`, `plan` e `period_end` quando aplicável.
 */
export function errorMessageFor(code: string | undefined, details?: ErrorDetails): string {
  switch (code) {
    case 'HOUSEHOLD_NOT_FOUND':
      return 'Ainda não tens um agregado configurado. Termina o registo para começares a usar o Jarvis.';
    case 'VALIDATION_ERROR':
      return 'Não percebi esse pedido. Escreve o que precisas em texto (até 2000 caracteres).';
    case 'IDEMPOTENCY_IN_PROGRESS':
      return 'Esse pedido ainda está a ser processado. Espera um instante antes de repetir.';
    case 'RATE_LIMIT_EXCEEDED': {
      const retry = details?.retry_after_seconds ?? 60;
      return `Estás a enviar pedidos depressa demais. Tenta de novo em ${retry} segundos.`;
    }
    case 'QUOTA_EXCEEDED': {
      const plan = details?.plan ?? 'atual';
      return `Atingiste o limite de pedidos do teu plano (${plan}). A próxima janela abre ${formatPeriodEnd(details?.period_end)}.`;
    }
    case 'CLASSIFIER_ERROR':
      return 'Não consegui interpretar esse pedido agora. Tenta reformular de forma mais simples.';
    case 'PLANNER_ERROR':
      return 'Não consegui montar um plano para esse pedido. Tenta ser mais específico.';
    case 'EXECUTOR_VALIDATION_ERROR':
      return 'Esse pedido tem um detalhe que não consigo processar. Tenta reformular.';
    case 'TOOL_PLAN_GATE_ERROR':
      return 'Esse pedido pede uma ação que ainda não está disponível.';
    case 'TOOL_EXECUTION_ERROR':
      return 'Algo correu mal ao executar o teu pedido — não foi feita nenhuma alteração. Tenta de novo.';
    case 'INTERNAL_ERROR':
      return 'Tivemos um problema temporário do nosso lado. Tenta de novo daqui a pouco.';
    default:
      // Inclui `AUTH_REQUIRED` (tratado por redirect antes de chegar aqui) e
      // qualquer código futuro não mapeado — nunca expõe o `message` cru.
      return FALLBACK_MESSAGE;
  }
}
