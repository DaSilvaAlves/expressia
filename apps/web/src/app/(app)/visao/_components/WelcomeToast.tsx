'use client';

/**
 * `<WelcomeToast>` — toast de boas-vindas pós-onboarding (Story 6.2 AC8).
 *
 * Mostra `"Bem-vindo, {nome}. O Expressia está pronto."` **uma vez**, na
 * primeira navegação para `/visao` após o tour (a server action redirecciona
 * para `/visao?welcome=1`, e a `/visao` só monta este componente quando o param
 * está presente).
 *
 * **Mostrado uma vez (AC8):** guard via `sessionStorage` — se a flag já existe
 * (ex.: refresh manual de `/visao?welcome=1`), não re-mostra. Navegações
 * normais para `/visao` (a partir da sidebar) não levam o param → o componente
 * nem é montado pelo servidor. Auto-dismiss após 5s.
 *
 * [DEV-DECISION D-6.2.3] Componente dedicado (NÃO o `undoStore`/`<UndoToast>`,
 * que é semanticamente sobre "anular acção") — reusa o mesmo padrão visual
 * (fixed, role="status", auto-dismiss) **sem introduzir lib de toast nova**.
 *
 * **SSR-safety (FIX-1 da 5.7):** acesso a `sessionStorage` e mutação de estado
 * só em `useEffect`/handlers — nunca no corpo do render.
 *
 * **A11y:** `role="status"` + `aria-live="polite"` (não é erro). Posição
 * `top-center` para não colidir com o `<UndoToast>` (bottom-center).
 *
 * Trace: Story 6.2 AC8; front-end-spec §5.3 l.484; precedente `UndoToast.tsx`.
 */
import { useEffect, useState } from 'react';

const SESSION_KEY = 'expressia-welcome-shown';

interface WelcomeToastProps {
  /** Nome a apresentar (resolvido por `resolveDisplayName` na `/visao`). */
  name: string;
}

export function WelcomeToast({ name }: WelcomeToastProps): React.ReactElement | null {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Guard "mostrar uma vez": se já foi mostrado nesta sessão, não repete.
    if (typeof window === 'undefined') return;
    if (window.sessionStorage.getItem(SESSION_KEY)) return;

    window.sessionStorage.setItem(SESSION_KEY, '1');
    setVisible(true);

    const t = setTimeout(() => setVisible(false), 5000);
    return () => clearTimeout(t);
  }, []);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-lg border border-border-default bg-surface px-4 py-3 text-sm text-foreground shadow-lg"
    >
      Bem-vindo, {name}. O Expressia está pronto.
    </div>
  );
}
