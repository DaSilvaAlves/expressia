'use client';

/**
 * `<TopBarHamburger>` — wrapper Client do `HamburgerButton` no `TopBar`
 * (Story 5.3 AC3.a).
 *
 * Lê `mobileDrawerOpen` e expõe o `toggleMobileDrawer()` do `shellStore`.
 * Permite que o `TopBar` (Server Component) continue a renderizar SSR sem
 * arrastar todo o markup para o Client.
 *
 * Trace: `architecture.md §8.2` (Server por defeito, sub-componente Client
 * isolado para state).
 */
import { HamburgerButton } from '@/components/shell/HamburgerButton';
import { useMobileDrawerOpen, useShellActions } from '@/lib/stores/shellStore';

export function TopBarHamburger() {
  const open = useMobileDrawerOpen();
  const { toggleMobileDrawer } = useShellActions();
  return (
    <HamburgerButton
      onClick={toggleMobileDrawer}
      label={open ? 'Fechar menu' : 'Abrir menu'}
      expanded={open}
    />
  );
}
