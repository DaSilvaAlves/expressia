import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { TagBadge } from '@/app/(app)/tarefas/_components/TagBadge';

describe('<TagBadge>', () => {
  it('renderiza nome da tag', () => {
    render(<TagBadge tag={{ id: 't1', name: 'trabalho', color: '#3B82F6' }} />);
    expect(screen.getByText('trabalho')).toBeInTheDocument();
  });

  it('inclui title como tooltip nativo', () => {
    render(<TagBadge tag={{ id: 't1', name: 'compras', color: '#22C55E' }} />);
    const badge = screen.getByText('compras');
    expect(badge.getAttribute('title')).toBe('compras');
  });

  it('aplica role="listitem"', () => {
    render(<TagBadge tag={{ id: 't1', name: 'casa', color: '#EF4444' }} />);
    expect(screen.getByRole('listitem')).toBeInTheDocument();
  });

  it('size xs aplica classes compactas', () => {
    const { container } = render(
      <TagBadge tag={{ id: 't1', name: 'x', color: '#000000' }} size="xs" />,
    );
    const span = container.querySelector('span');
    expect(span?.className).toContain('text-[10px]');
    expect(span?.className).toContain('max-w-[64px]');
  });

  it('size sm (default) aplica classes maiores', () => {
    const { container } = render(
      <TagBadge tag={{ id: 't1', name: 'x', color: '#FFFFFF' }} />,
    );
    const span = container.querySelector('span');
    expect(span?.className).toContain('text-xs');
    expect(span?.className).toContain('max-w-[96px]');
  });
});
