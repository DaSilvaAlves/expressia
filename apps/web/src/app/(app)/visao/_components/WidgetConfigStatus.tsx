'use client';

import { useEffect } from 'react';
import type * as React from 'react';

import {
  useWidgetConfigBanner,
  useWidgetConfigActions,
} from '@/lib/stores/widgetConfigStore';

/**
 * `<WidgetConfigStatus>` — banner de feedback da persistência de widgets
 * (Story 5.7 AC2/AC7). Lê o `banner` do `widgetConfigStore`:
 *   - `success` → "Guardado." (auto-clear 3s, precedente `prefs-toggle.tsx`).
 *   - `error`   → mensagem PT-PT (`role="alert"`).
 *   - `idle`    → nada renderizado.
 *
 * Trace: Story 5.7 AC2/AC7; precedente `prefs-toggle.tsx:83-98`.
 */
export function WidgetConfigStatus(): React.ReactElement | null {
  const banner = useWidgetConfigBanner();
  const { clearBanner } = useWidgetConfigActions();

  useEffect(() => {
    if (banner.kind === 'success') {
      const t = setTimeout(() => clearBanner(), 3000);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [banner, clearBanner]);

  if (banner.kind === 'idle') return null;

  if (banner.kind === 'success') {
    return (
      <div
        role="status"
        className="rounded-md bg-green-50 px-3 py-1.5 text-xs text-green-800 dark:bg-green-950/30 dark:text-green-200"
      >
        {banner.text}
      </div>
    );
  }

  return (
    <div
      role="alert"
      className="rounded-md bg-red-50 px-3 py-1.5 text-xs text-red-800 dark:bg-red-950/30 dark:text-red-200"
    >
      {banner.text}
    </div>
  );
}
