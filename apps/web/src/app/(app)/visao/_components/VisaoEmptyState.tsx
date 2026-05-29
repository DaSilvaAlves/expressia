import type * as React from 'react';

import { EmptyState } from '@meu-jarvis/ui';

/**
 * `<VisaoEmptyState>` — empty-state central da `/visao` (Story 5.6 AC7).
 *
 * **Story 5.9 AC5 — consolidado:** delega ao `<EmptyState variant="visao">` de
 * `@meu-jarvis/ui` (fonte única do design system). Copy/estilo byte-a-byte
 * iguais à versão local anterior (a variante visao replica o markup original
 * — mesmo padding, superfície neutra clara e CTA "Abrir o chat" → /jarvis),
 * zero mudança visual.
 *
 * Mantido como wrapper fino (DEV-DECISION D-5.9.1) em vez de eliminação directa:
 * preserva o ponto de uso em `page.tsx:177` e o mock em `page.test.tsx` sem
 * tocar o teste RSC (stringifyTree) — zero risco de regressão. O `page.tsx`
 * continua a importar `<VisaoEmptyState>`; a consolidação é real (delega ao
 * componente shared).
 *
 * Trace: Story 5.6 AC7; Story 5.9 AC5; DP-5.9.C.
 */
export function VisaoEmptyState(): React.ReactElement {
  return <EmptyState variant="visao" />;
}
