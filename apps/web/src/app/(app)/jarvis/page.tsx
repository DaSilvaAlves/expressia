import type { Metadata } from 'next';

import { ChatPanel } from '@/components/chat/ChatPanel';

export const metadata: Metadata = {
  title: 'Jarvis — Expressia',
};

/**
 * Página `/jarvis` — chat principal com o cérebro AI multi-intent (FR4).
 *
 * Server Component shell mínimo — todo o estado interactivo vive em
 * `<ChatPanel mode="fullscreen" />` (Story 5.4 — extracção de `<JarvisChat>`
 * Story 2.7 para componente agnóstico de rota em `apps/web/src/components/chat/`
 * + estado partilhado via `chatStore` Zustand).
 *
 * Auth gate: middleware (`apps/web/src/middleware.ts`) redirecciona para
 * `/entrar` se sem sessão (Story 2.7 PO_FIX_INLINE 4 — `APP_PATH_PREFIXES`
 * inclui `/jarvis`).
 *
 * **DP-5.4.G:** `metadata.title` mantém "Jarvis — Expressia" mesmo que sidebar
 * Story 5.3 mostre label "Chat" (divergência consciente entre nome interno do
 * agente AI e função user-facing per front-end-spec §5.4 linha 500).
 *
 * Trace: Story 2.7 AC6 + Story 5.4 AC3, Architecture §4.4 + §8.4 linha 727, FR4.
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
      <ChatPanel mode="fullscreen" />
    </div>
  );
}
