/**
 * Tests — `<TopBar>` (Story 5.3 AC7.b).
 *
 * Cobertura:
 *   1. Renderiza avatar (iniciais email) + botão Sair quando `user` válido.
 *   2. Renderiza topbar minimal sem crash quando `user === null`.
 *   3. Slots `data-slot="theme-toggle"` + `data-slot="household-switcher"`
 *      ambos presentes no DOM.
 *
 * Notes:
 *   - `logoutAction` Server Action é mocked (apenas precisamos que o `<form>`
 *     renderize com botão Sair — não testamos comportamento do action).
 *   - `BreadcrumbLabel` faz `usePathname()` — mock do `next/navigation`.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { User } from '@supabase/supabase-js';

import { TopBar } from '@/components/shell/TopBar';

vi.mock('next/navigation', () => ({
  usePathname: () => '/visao',
}));

vi.mock('@/app/(app)/logout-action', () => ({
  logoutAction: vi.fn(),
}));

const FAKE_USER: User = {
  id: 'user-1',
  email: 'eurico.silva@expressia.pt',
  app_metadata: {},
  user_metadata: {},
  aud: 'authenticated',
  created_at: new Date('2026-01-01').toISOString(),
} as unknown as User;

describe('<TopBar>', () => {
  it('renderiza avatar (iniciais) + botão Sair quando user válido', () => {
    const { container } = render(<TopBar user={FAKE_USER} />);
    // Iniciais "ES" (eurico.silva → E + S).
    expect(container.querySelector('[title="eurico.silva@expressia.pt"]')).not.toBeNull();
    // Botão Sair
    expect(screen.getByRole('button', { name: /sair/i })).toBeInTheDocument();
  });

  it('renderiza topbar minimal sem crash quando user === null', () => {
    render(<TopBar user={null} />);
    // Botão Sair continua renderizado (defensivo — AC3.g)
    expect(screen.getByRole('button', { name: /sair/i })).toBeInTheDocument();
  });

  it('inclui ambos os slots data-slot="theme-toggle" e data-slot="household-switcher"', () => {
    const { container } = render(<TopBar user={FAKE_USER} />);
    expect(container.querySelector('[data-slot="theme-toggle"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="household-switcher"]')).not.toBeNull();
  });
});
