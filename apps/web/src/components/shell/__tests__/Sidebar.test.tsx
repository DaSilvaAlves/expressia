/**
 * Tests — `<Sidebar>` (Story 5.3 AC7.a).
 *
 * Cobertura:
 *   1. Renderiza os 5 itens de nav principal (Visão, Chat, Tarefas, Finanças, Conta).
 *   2. `aria-current="page"` em `/visao` (mock usePathname).
 *   3. Grupo Tarefas expandido mostra 3 sub-items (Lista/Kanban/Calendário).
 *   4. Grupo Finanças expandido mostra 5 sub-items.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { User } from '@supabase/supabase-js';

import { Sidebar } from '@/components/shell/Sidebar';
import { useShellStore } from '@/lib/stores/shellStore';

// Mock `next/navigation` — `usePathname()` retorna o pathname controlado.
let mockPathname = '/visao';
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}));

const FAKE_USER: User = {
  id: 'user-1',
  email: 'eurico@expressia.pt',
  app_metadata: {},
  user_metadata: {},
  aud: 'authenticated',
  created_at: new Date('2026-01-01').toISOString(),
} as unknown as User;

function resetStore() {
  useShellStore.setState({
    sidebarCollapsed: false,
    chatPanelOpen: false,
    mobileDrawerOpen: false,
  });
}

beforeEach(() => {
  resetStore();
  mockPathname = '/visao';
});

afterEach(() => {
  resetStore();
});

describe('<Sidebar>', () => {
  it('renderiza os 5 itens de nav principal (Visão, Chat, Tarefas, Finanças, Conta)', () => {
    render(<Sidebar user={FAKE_USER} />);
    // Visão, Chat são leaves; Tarefas, Finanças são botões de grupo; Conta é leaf.
    expect(screen.getByRole('link', { name: /visão/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /chat/i })).toBeInTheDocument();
    // Grupo Tarefas: botão expansível
    expect(screen.getByRole('button', { name: /tarefas/i })).toBeInTheDocument();
    // Grupo Finanças
    expect(screen.getByRole('button', { name: /finanças/i })).toBeInTheDocument();
    // Conta leaf
    expect(screen.getByRole('link', { name: /conta/i })).toBeInTheDocument();
  });

  it('aplica aria-current="page" no link activo (/visao)', () => {
    mockPathname = '/visao';
    render(<Sidebar user={FAKE_USER} />);
    const visaoLink = screen.getByRole('link', { name: /visão/i });
    expect(visaoLink).toHaveAttribute('aria-current', 'page');
  });

  it('grupo Tarefas activo (pathname /tarefas/kanban) expande e mostra 3 sub-items', () => {
    mockPathname = '/tarefas/kanban';
    render(<Sidebar user={FAKE_USER} />);
    // Sub-items aparecem como links
    expect(screen.getByRole('link', { name: /lista/i })).toHaveAttribute('href', '/tarefas');
    expect(screen.getByRole('link', { name: /kanban/i })).toHaveAttribute(
      'href',
      '/tarefas/kanban',
    );
    expect(screen.getByRole('link', { name: /calendário/i })).toHaveAttribute(
      'href',
      '/tarefas/calendario',
    );
  });

  it('grupo Finanças activo (pathname /financas/cartoes) expande e mostra 5 sub-items', () => {
    mockPathname = '/financas/cartoes';
    render(<Sidebar user={FAKE_USER} />);
    expect(screen.getByRole('link', { name: /este mês/i })).toHaveAttribute(
      'href',
      '/financas/este-mes',
    );
    expect(screen.getByRole('link', { name: /variáveis/i })).toHaveAttribute(
      'href',
      '/financas/variaveis',
    );
    expect(screen.getByRole('link', { name: /recorrentes/i })).toHaveAttribute(
      'href',
      '/financas/recorrentes',
    );
    expect(screen.getByRole('link', { name: /cartões/i })).toHaveAttribute(
      'href',
      '/financas/cartoes',
    );
    expect(screen.getByRole('link', { name: /património/i })).toHaveAttribute(
      'href',
      '/financas/patrimonio',
    );
  });
});
