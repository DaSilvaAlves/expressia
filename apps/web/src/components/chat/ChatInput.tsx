'use client';

import { useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react';

const MAX_CHARS = 2000;

export interface ChatInputProps {
  readonly onSubmit: (prompt: string) => void;
  readonly disabled?: boolean;
}

/**
 * `ChatInput` — textarea controlled + botão Enviar + counter de caracteres.
 *
 * Story 2.7 AC6 + T7:
 *   - Enter submits, Shift+Enter newline (UX standard).
 *   - Disabled durante loading (`disabled` prop).
 *   - Max 2000 chars (consistente com Zod do endpoint).
 *   - Trim antes de submit; recusa submit se vazio após trim.
 */
export function ChatInput({ onSubmit, disabled }: ChatInputProps): React.ReactElement {
  const [value, setValue] = useState('');
  const trimmed = value.trim();
  const length = value.length;
  const overLimit = length > MAX_CHARS;
  const canSubmit = !disabled && trimmed.length > 0 && !overLimit;

  function handleSubmit(e?: FormEvent): void {
    if (e) e.preventDefault();
    if (!canSubmit) return;
    onSubmit(trimmed);
    setValue('');
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  function handleChange(e: ChangeEvent<HTMLTextAreaElement>): void {
    setValue(e.target.value);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <textarea
        aria-label="Prompt"
        placeholder="Pede o que precisas — ex: amanhã reunião 15h e paguei 78,70 no supermercado"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        rows={3}
        className="block w-full resize-y rounded-md border border-black/15 bg-white px-3 py-2 text-sm placeholder:text-neutral-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/15 dark:bg-neutral-900"
      />
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span aria-live="polite">
          {length}/{MAX_CHARS}
          {overLimit && <span className="ml-2 text-red-500">Demasiado longo</span>}
        </span>
        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Enviar
        </button>
      </div>
    </form>
  );
}
