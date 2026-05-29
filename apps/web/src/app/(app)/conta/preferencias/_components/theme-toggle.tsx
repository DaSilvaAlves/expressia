'use client';

import { useState } from 'react';

import { useTheme } from '@/components/theme/ThemeProvider';
import type { Theme } from '@/lib/api-schemas/preferences';

type Banner =
  | { kind: 'idle' }
  | { kind: 'success'; text: string }
  | { kind: 'error'; text: string };

/** Opções do toggle em PT-PT (AC2.a) — ordem: Claro, Escuro, Sistema. */
const OPTIONS: ReadonlyArray<{ value: Theme; label: string }> = [
  { value: 'light', label: 'Claro' },
  { value: 'dark', label: 'Escuro' },
  { value: 'system', label: 'Sistema' },
];

/**
 * `<ThemeToggle>` — radiogroup de 3 opções (Claro / Escuro / Sistema) na página
 * `/conta/preferencias`, co-localizado com o `<PrefsToggle>` (Story 5.8 AC2/AC7).
 *
 * Comportamento (precedente `prefs-toggle.tsx`):
 *   - Optimistic: `setTheme()` muda a classe no `<html>` + escreve o cookie
 *     `expressia-theme` IMEDIATAMENTE (via `ThemeProvider`).
 *   - PATCH `{ theme }` persiste em `user_prefs.theme` (fonte de verdade
 *     cross-device — DP-5.8.B). Em erro, reverte para o valor anterior + banner.
 *   - Banner "Guardado."/"Erro ..." com auto-clear 3s.
 *
 * A11y: `role="radiogroup"` + cada opção `role="radio"` + `aria-checked`,
 * navegável por teclado (setas/Tab nativas via `<input type="radio">`).
 *
 * Tom PT-PT estrito.
 */
export function ThemeToggle(): React.ReactElement {
  const { theme, setTheme } = useTheme();
  const [pending, setPending] = useState(false);
  const [banner, setBanner] = useState<Banner>({ kind: 'idle' });

  async function handleSelect(next: Theme): Promise<void> {
    if (pending || next === theme) return;
    const previous = theme;
    setTheme(next); // optimistic — DOM + cookie mudam já
    setPending(true);
    setBanner({ kind: 'idle' });

    try {
      const res = await fetch('/api/conta/preferencias', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ theme: next }),
      });
      if (!res.ok) {
        setTheme(previous); // revert
        const body = (await res.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        setBanner({
          kind: 'error',
          text: body.error?.message ?? 'Erro ao guardar. Tenta de novo.',
        });
        return;
      }
      setBanner({ kind: 'success', text: 'Guardado.' });
      setTimeout(() => setBanner({ kind: 'idle' }), 3000);
    } catch {
      setTheme(previous); // revert
      setBanner({ kind: 'error', text: 'Erro temporário. Tenta de novo.' });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="space-y-1">
        <span className="block text-sm font-medium text-foreground">Aparência</span>
        <span className="block text-xs text-muted-foreground">
          Escolhe o tema da aplicação. &quot;Sistema&quot; segue a preferência do
          teu dispositivo.
        </span>
      </div>

      <div
        role="radiogroup"
        aria-label="Tema da aplicação"
        className="mt-3 flex gap-2"
      >
        {OPTIONS.map((opt) => {
          const checked = theme === opt.value;
          return (
            <label
              key={opt.value}
              className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors ${
                checked
                  ? 'border-primary bg-primary-subtle text-foreground'
                  : 'border-border text-muted-foreground hover:bg-muted'
              } ${pending ? 'cursor-not-allowed opacity-60' : ''}`}
            >
              <input
                type="radio"
                name="theme"
                role="radio"
                value={opt.value}
                checked={checked}
                aria-checked={checked}
                disabled={pending}
                onChange={() => void handleSelect(opt.value)}
                className="h-3.5 w-3.5 cursor-pointer disabled:cursor-not-allowed"
              />
              {opt.label}
            </label>
          );
        })}
      </div>

      {banner.kind === 'success' && (
        <div
          role="status"
          className="mt-3 rounded-md bg-success-subtle px-3 py-1.5 text-xs text-success"
        >
          {banner.text}
        </div>
      )}
      {banner.kind === 'error' && (
        <div
          role="alert"
          className="mt-3 rounded-md bg-danger-subtle px-3 py-1.5 text-xs text-danger"
        >
          {banner.text}
        </div>
      )}
    </div>
  );
}
