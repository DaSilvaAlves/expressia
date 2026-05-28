/**
 * Tests — `<WidgetSkeleton>` (Story 5.6 AC6, AC9).
 *
 * Render do placeholder de carregamento com `role="status"` acessível.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { WidgetSkeleton } from '@/app/(app)/visao/_components/WidgetSkeleton';

describe('<WidgetSkeleton>', () => {
  it('renderiza um placeholder com role status e label de carregamento', () => {
    render(<WidgetSkeleton />);
    const status = screen.getByRole('status', { name: /a carregar widget/i });
    expect(status).toBeInTheDocument();
    expect(status.querySelector('.animate-pulse')).not.toBeNull();
  });
});
