/**
 * Tests UI — `ResultMessage` (Story 2.7 T9 + AC7).
 *
 * Cobertura ≥3 tests: render summary, render lista de operations,
 * placeholder undo button disabled.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { ResultMessage } from '@/app/(app)/jarvis/_components/result-message';

describe('<ResultMessage />', () => {
  it('renderiza título "Feito ✓" + summary + run id', () => {
    render(
      <ResultMessage
        runId="run-123"
        summary="Executei 1 operação com sucesso. Tens 30 segundos para reverter."
      />,
    );
    expect(screen.getByText(/Feito/)).toBeInTheDocument();
    expect(screen.getByText(/Executei 1 operação/)).toBeInTheDocument();
    expect(screen.getByText(/run-123/)).toBeInTheDocument();
  });

  it('renderiza lista de operations quando results.results presente', () => {
    render(
      <ResultMessage
        runId="run-1"
        summary="Executei 2 operações."
        results={{
          success: true,
          results: [
            { tool_name: 'create_task', intent: 'criar_tarefa', result_id: 't-1' },
            { tool_name: 'create_transaction', intent: 'registar_despesa', result_id: 'tx-1' },
          ],
        }}
      />,
    );
    expect(screen.getByText(/create_task/)).toBeInTheDocument();
    expect(screen.getByText(/create_transaction/)).toBeInTheDocument();
    expect(screen.getByText(/t-1/)).toBeInTheDocument();
    expect(screen.getByText(/tx-1/)).toBeInTheDocument();
  });

  it('placeholder undo button está disabled com tooltip "Em breve"', () => {
    render(<ResultMessage runId="r1" summary="ok" />);
    const undo = screen.getByRole('button', { name: /anular/i });
    expect(undo).toBeDisabled();
    expect(undo).toHaveAttribute('title', 'Em breve');
  });

  it('lida com results vazio sem crash', () => {
    render(
      <ResultMessage runId="r1" summary="ok" results={{ success: true, results: [] }} />,
    );
    expect(screen.getByText(/Feito/)).toBeInTheDocument();
  });

  it('lida com results undefined sem crash', () => {
    render(<ResultMessage runId="r1" summary="apenas summary" />);
    expect(screen.getByText(/apenas summary/)).toBeInTheDocument();
  });
});
