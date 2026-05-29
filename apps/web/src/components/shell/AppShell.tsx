/**
 * `<AppShell>` — Server Component orquestrador do layout aplicacional
 * (Story 5.3 AC1).
 *
 * Substitui o header horizontal placeholder da Story 1.5. Estrutura 3-zonas:
 *
 *   Desktop (≥1024px):
 *   ┌────────────────────────────────────────────────────────────────┐
 *   │ Sidebar(240px)  │ ┌──────────────────┐ │ ChatPanelSlot         │
 *   │                 │ │ TopBar (56px)    │ │ (32px/400px auto)     │
 *   │                 │ └──────────────────┘ │                       │
 *   │                 │ main (children)      │                       │
 *   └────────────────────────────────────────────────────────────────┘
 *
 *   Mobile (<1024px):
 *   ┌────────────────────────┐
 *   │ TopBar (com hamburger) │
 *   ├────────────────────────┤
 *   │ main (children)        │
 *   └────────────────────────┘
 *   + Sidebar como drawer overlay (controlado pelo hamburger via shellStore)
 *   + ChatPanelSlot como FAB bottom-right
 *
 * Faz `await getUser()` UMA vez e injecta em `Sidebar` e `TopBar` — evita
 * round-trip duplicado ao Supabase. Se `user === null` (race com sign-out),
 * componentes renderizam estado defensivo sem crashar.
 *
 * Trace: `architecture.md §8.1` linha 663 ("sidebar + chat panel + topbar")
 *        + §8.2 (Server-default + Client onde precisar state); Story 5.3 AC1.
 */
import type { ReactNode } from 'react';

import { createServerSupabaseClient } from '@meu-jarvis/auth/server';

import { ChatPanelSlot } from '@/components/shell/ChatPanelSlot';
import { Sidebar } from '@/components/shell/Sidebar';
import { TopBar } from '@/components/shell/TopBar';
import { UndoToast } from '@/components/shell/UndoToast';
import { UndoToastBridge } from '@/components/shell/UndoToastBridge';

interface AppShellProps {
  children: ReactNode;
}

export async function AppShell({ children }: AppShellProps) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="flex min-h-screen w-full">
      {/* Sidebar — desktop in-flow, mobile drawer gerido pelo próprio componente Client. */}
      <Sidebar user={user} />

      {/* Centro: TopBar + main (coluna principal) */}
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar user={user} />
        <main className="flex-1 overflow-x-hidden p-4 lg:p-6">{children}</main>
      </div>

      {/* ChatPanelSlot — desktop col auto, mobile FAB gerido pelo próprio componente Client. */}
      <ChatPanelSlot />

      {/* Story 5.9 — undo global: bridge reactiva (chatStore → undoStore, sem UI)
          + toast fixo fora dos painéis (visível em qualquer rota). */}
      <UndoToastBridge />
      <UndoToast />
    </div>
  );
}
