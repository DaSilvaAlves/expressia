/**
 * Tests UI — page `/jarvis` (Story 2.7 T5 + AC6).
 *
 * Cobertura ≥4 tests: Server Component shell renderiza, header com título +
 * descrição PT-PT, integra <JarvisChat />.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import JarvisPage from '@/app/(app)/jarvis/page';

describe('JarvisPage (/jarvis)', () => {
  it('renderiza header com título "Jarvis"', () => {
    render(<JarvisPage />);
    expect(screen.getByRole('heading', { level: 1, name: /jarvis/i })).toBeInTheDocument();
  });

  it('mostra descrição PT-PT "Pede o que precisas — eu trato"', () => {
    render(<JarvisPage />);
    expect(screen.getByText(/pede o que precisas/i)).toBeInTheDocument();
  });

  it('integra ChatInput component', () => {
    render(<JarvisPage />);
    expect(screen.getByLabelText('Prompt')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /enviar/i })).toBeInTheDocument();
  });

  it('renderiza sem mensagens iniciais (estado limpo)', () => {
    render(<JarvisPage />);
    expect(screen.queryByText(/Feito/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Vais fazer/)).not.toBeInTheDocument();
  });
});
