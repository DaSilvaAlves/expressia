'use client';

/**
 * Operação aplicada — shape mínimo extraído do `AtomicOutcome` da Story 2.5.
 * Campos opcionais para resiliência a futuras mudanças no schema (Story 2.8+).
 */
export interface ResultOperation {
  readonly toolName?: string;
  readonly tool_name?: string;
  readonly intent?: string;
  readonly result_id?: string;
  readonly resultId?: string;
  readonly output?: unknown;
}

export interface ResultMessageProps {
  readonly runId: string;
  readonly summary: string;
  readonly results?: {
    readonly success?: boolean;
    readonly results?: readonly unknown[];
  };
}

/**
 * `ResultMessage` — exibe o resultado bem-sucedido de uma run executada.
 *
 * Story 2.7 AC7 — renderiza:
 *   - Título "Feito ✓"
 *   - Summary PT-PT (ex: "Executei 2 operações com sucesso")
 *   - Lista das operations aplicadas (`tool_name` + `intent`)
 *   - Placeholder undo button — disabled com tooltip "Em breve" (Story 2.8)
 */
export function ResultMessage({
  runId,
  summary,
  results,
}: ResultMessageProps): React.ReactElement {
  const ops: ResultOperation[] = (results?.results ?? []).map((r) =>
    typeof r === 'object' && r !== null ? (r as ResultOperation) : {},
  );

  return (
    <div
      role="region"
      aria-label="Resultado da operação"
      className="rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-900/40 dark:bg-green-950/30"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-base font-semibold text-green-900 dark:text-green-100">
          Feito ✓
        </h2>
        <button
          type="button"
          disabled
          title="Em breve"
          aria-label="Anular operação (em breve)"
          className="rounded-md border border-black/10 bg-white px-2 py-1 text-xs text-muted-foreground opacity-50 dark:border-white/10 dark:bg-neutral-900"
        >
          Anular
        </button>
      </div>

      <p className="mt-2 text-sm text-green-900 dark:text-green-100">{summary}</p>

      {ops.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-neutral-700 dark:text-neutral-200">
          {ops.map((op, i) => {
            const tool = op.tool_name ?? op.toolName ?? 'tool';
            const intent = op.intent ? ` (${op.intent})` : '';
            const id = op.result_id ?? op.resultId;
            return (
              <li key={i} className="font-mono">
                • {tool}
                {intent}
                {id ? ` → ${id}` : ''}
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-3 text-[10px] font-mono text-muted-foreground">run: {runId}</div>
    </div>
  );
}
