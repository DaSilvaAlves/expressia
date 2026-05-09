import type { Metadata } from 'next';

import { JarvisChat } from '@/app/(app)/jarvis/_components/jarvis-chat';

export const metadata: Metadata = {
  title: 'Jarvis — Expressia',
};

/**
 * Página `/jarvis` — chat principal com o cérebro AI multi-intent (FR4).
 *
 * Server Component shell mínimo — todo o estado interactivo vive em
 * `<JarvisChat />` Client Component (D31 components inline em `_components/`).
 *
 * Auth gate: middleware (`apps/web/src/middleware.ts`) redirecciona para
 * `/entrar` se sem sessão (Story 2.7 PO_FIX_INLINE 4 — `APP_PATH_PREFIXES`
 * inclui `/jarvis`).
 *
 * Trace: Story 2.7 AC6, Architecture §4.4, FR4.
 */
export default function JarvisPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Jarvis</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pede o que precisas — eu trato.
        </p>
      </div>
      <JarvisChat />
    </div>
  );
}
