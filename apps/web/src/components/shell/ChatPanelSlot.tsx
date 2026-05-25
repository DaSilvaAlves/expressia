'use client';

/**
 * `<ChatPanelSlot>` — slot lateral à direita para o chat (Story 5.3 AC4).
 *
 * Estados visuais:
 *   - **Desktop (≥1024px) collapsed:** botão vertical thin 32px com label
 *     rotated "Abrir chat".
 *   - **Desktop (≥1024px) expanded:** aside 400px com header "Chat" + close.
 *     Conteúdo interno é um `<div data-slot="chat-panel" />` vazio + dev
 *     placeholder PT-PT (apenas em `NODE_ENV !== 'production'`).
 *   - **Tablet/Mobile (<1024px):** FAB 56×56px fixed bottom-right. Click
 *     abre overlay full-screen com close button (também slot vazio).
 *
 * **D-5.3.3 (animação):** transições CSS triviais (Tailwind `transition`).
 * Story 5.4 pode refinar com `tokens.transitions.default` quando o
 * `<ChatPanel>` real for montado.
 *
 * Restrição AC4.e: NÃO importar `<JarvisChat>` nem qualquer componente
 * em `apps/web/src/app/(app)/jarvis/_components/`. Esta story cria APENAS
 * o slot vazio — a extracção real é Story 5.4.
 *
 * Trace: Epic 5 §8 DP8; Story 5.3 AC4.
 */
import { useChatPanelOpen, useShellActions, useShellHydrated } from '@/lib/stores/shellStore';

const DEV_PLACEHOLDER = 'O chat chega na Story 5.4.';

export function ChatPanelSlot() {
  const open = useChatPanelOpen();
  const hydrated = useShellHydrated();
  const { openChatPanel, closeChatPanel } = useShellActions();

  // Antes de hidratar, assume fechado (consistente com server render).
  const effectiveOpen = hydrated ? open : false;
  const isDev = process.env.NODE_ENV !== 'production';

  return (
    <>
      {/* Desktop: integra-se no flow do grid do AppShell (col lg auto) */}
      <aside
        aria-label="Painel de chat"
        role="complementary"
        data-state={effectiveOpen ? 'open' : 'collapsed'}
        className={[
          // Desktop: visível como col auto no grid. Em tablet/mobile esconde-se
          // — esses breakpoints usam o FAB em vez do aside no grid.
          'hidden border-l border-black/10 transition-[width] dark:border-white/10 lg:flex lg:flex-col',
          effectiveOpen ? 'lg:w-[400px]' : 'lg:w-8',
        ].join(' ')}
      >
        {effectiveOpen ? (
          <>
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-black/10 px-3 dark:border-white/10">
              <span className="text-sm font-medium">Chat</span>
              <button
                type="button"
                onClick={closeChatPanel}
                aria-label="Fechar chat"
                className="flex h-7 w-7 items-center justify-center rounded text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
              >
                ×
              </button>
            </div>
            <div
              data-slot="chat-panel"
              className="flex-1 overflow-y-auto p-3 text-sm text-neutral-700 dark:text-neutral-300"
            >
              {isDev && (
                <p className="rounded-md border border-dashed border-neutral-300 p-3 text-xs text-neutral-500 dark:border-neutral-700">
                  {DEV_PLACEHOLDER}
                </p>
              )}
            </div>
          </>
        ) : (
          <button
            type="button"
            onClick={openChatPanel}
            aria-label="Abrir chat"
            aria-expanded={false}
            className="flex h-full w-full items-center justify-center text-xs text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
            style={{ writingMode: 'vertical-rl' }}
          >
            Abrir chat
          </button>
        )}
      </aside>

      {/* Tablet/Mobile FAB — visível <1024px. */}
      {!effectiveOpen && (
        <button
          type="button"
          onClick={openChatPanel}
          aria-label="Abrir chat"
          aria-expanded={false}
          className="fixed bottom-6 right-6 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-[#1F4F6A] text-white shadow-lg hover:bg-[#163A4F] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1F4F6A] lg:hidden"
        >
          <span aria-hidden="true" className="text-xl">
            💬
          </span>
        </button>
      )}

      {/* Tablet/Mobile overlay quando aberto. */}
      {effectiveOpen && (
        <div className="fixed inset-0 z-40 flex flex-col bg-white lg:hidden dark:bg-neutral-900">
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-black/10 px-3 dark:border-white/10">
            <span className="text-sm font-medium">Chat</span>
            <button
              type="button"
              onClick={closeChatPanel}
              aria-label="Fechar chat"
              className="flex h-9 w-9 items-center justify-center rounded text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
            >
              ×
            </button>
          </div>
          <div
            data-slot="chat-panel-mobile"
            className="flex-1 overflow-y-auto p-3 text-sm text-neutral-700 dark:text-neutral-300"
          >
            {isDev && (
              <p className="rounded-md border border-dashed border-neutral-300 p-3 text-xs text-neutral-500 dark:border-neutral-700">
                {DEV_PLACEHOLDER}
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
