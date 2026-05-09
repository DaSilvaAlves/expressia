/**
 * Tests UI — `ChatInput` (Story 2.7 T7).
 *
 * Cobertura ≥3 tests: render, Enter submits, Shift+Enter newline,
 * disabled state, max chars indicator.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { ChatInput } from '@/app/(app)/jarvis/_components/chat-input';

describe('<ChatInput />', () => {
  it('renderiza textarea + botão Enviar + counter', () => {
    render(<ChatInput onSubmit={() => {}} />);
    expect(screen.getByLabelText('Prompt')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /enviar/i })).toBeInTheDocument();
    expect(screen.getByText(/0\/2000/)).toBeInTheDocument();
  });

  it('Enter submete o prompt e limpa o textarea', () => {
    const onSubmit = vi.fn();
    render(<ChatInput onSubmit={onSubmit} />);
    const ta = screen.getByLabelText('Prompt') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'amanhã reunião 15h' } });
    fireEvent.keyDown(ta, { key: 'Enter', shiftKey: false });
    expect(onSubmit).toHaveBeenCalledWith('amanhã reunião 15h');
    expect(ta.value).toBe('');
  });

  it('Shift+Enter NÃO submete (permite newline)', () => {
    const onSubmit = vi.fn();
    render(<ChatInput onSubmit={onSubmit} />);
    const ta = screen.getByLabelText('Prompt') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'linha 1' } });
    fireEvent.keyDown(ta, { key: 'Enter', shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(ta.value).toBe('linha 1');
  });

  it('botão Enviar fica disabled com input vazio', () => {
    render(<ChatInput onSubmit={() => {}} />);
    const btn = screen.getByRole('button', { name: /enviar/i });
    expect(btn).toBeDisabled();
  });

  it('disabled prop bloqueia submit + desactiva botão', () => {
    const onSubmit = vi.fn();
    render(<ChatInput onSubmit={onSubmit} disabled />);
    const ta = screen.getByLabelText('Prompt') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'oi' } });
    fireEvent.keyDown(ta, { key: 'Enter' });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /enviar/i })).toBeDisabled();
  });

  it('counter mostra demasiado longo quando > 2000 chars', () => {
    render(<ChatInput onSubmit={() => {}} />);
    const ta = screen.getByLabelText('Prompt') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'a'.repeat(2001) } });
    expect(screen.getByText(/demasiado longo/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /enviar/i })).toBeDisabled();
  });
});
