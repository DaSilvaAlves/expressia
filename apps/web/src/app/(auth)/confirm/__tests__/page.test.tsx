/**
 * Testes da página `/confirm` (Story 6.1 AC4/AC10).
 *
 * Cobre os três estados derivados do query param `status`: pendente (sem
 * status), sucesso (`ok`) e erro (`error`). Component é async (lê searchParams
 * como Promise em Next 15) — resolvemos a função e renderizamos o elemento.
 */
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const { default: ConfirmPage } = await import('@/app/(auth)/confirm/page');

async function renderConfirm(status?: string) {
  const ui = await ConfirmPage({ searchParams: Promise.resolve(status ? { status } : {}) });
  render(ui);
}

describe('/confirm page', () => {
  it('estado pendente (sem status): pede para verificar o email', async () => {
    await renderConfirm();
    expect(screen.getByRole('heading')).toHaveTextContent('Confirma o teu email');
    expect(screen.getByText(/link de confirmação para o teu email/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Entra' })).toHaveAttribute('href', '/entrar');
  });

  it('estado ok: confirma sucesso com CTA para continuar', async () => {
    await renderConfirm('ok');
    expect(screen.getByRole('heading')).toHaveTextContent('Email confirmado');
    expect(screen.getByRole('link', { name: 'Continuar' })).toHaveAttribute('href', '/visao');
  });

  it('estado error: comunica link inválido com CTAs de recuperação', async () => {
    await renderConfirm('error');
    expect(screen.getByRole('heading')).toHaveTextContent('Link inválido ou expirado');
    expect(screen.getByRole('link', { name: 'Voltar a registar' })).toHaveAttribute(
      'href',
      '/registar',
    );
    expect(screen.getByRole('link', { name: 'Entrar' })).toHaveAttribute('href', '/entrar');
  });

  it('status desconhecido cai no estado pendente (fail-safe)', async () => {
    await renderConfirm('lixo');
    expect(screen.getByRole('heading')).toHaveTextContent('Confirma o teu email');
  });
});
