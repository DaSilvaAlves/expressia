import type { Metadata } from 'next';
import { cookies } from 'next/headers';

import { AppShell } from '@/components/shell/AppShell';
import { ThemeProvider, THEME_COOKIE } from '@/components/theme/ThemeProvider';
import { ThemeSchema, type Theme } from '@/lib/api-schemas/preferences';

export const metadata: Metadata = {
  title: 'Expressia',
};

/**
 * Layout do route group `(app)/` — rotas autenticadas.
 *
 * Story 5.3 substituiu o placeholder Story 1.5 pelo `<AppShell>` 3-zonas.
 * Story 5.8 (AC1.d/AC7) envolve o shell num `<ThemeProvider>` Client que
 * sincroniza o tema claro/escuro/sistema e expõe `useTheme()` ao toggle.
 *
 * O `theme` inicial é lido do cookie `expressia-theme` server-side (leitura
 * síncrona, zero round-trip DB por render — DP-5.8.B). A fonte de verdade
 * cross-device é `user_prefs.theme` (DB), sincronizada para o cookie pelo PATCH
 * do toggle e pelo script anti-FOUC. `ThemeSchema.safeParse` + fallback
 * `'system'` (default da coluna) — análogo ao padrão da Story 5.7.
 *
 * Contracts preservados:
 *   - `export default AppLayout({ children })` (Next.js App Router exige)
 *   - Server Component (sem `'use client'`) — o `<ThemeProvider>` Client é
 *     montado como filho (não converte o layout em Client)
 *   - `apps/web/src/middleware.ts` NÃO tocado (auth gate intacto)
 *
 * Trace: Story 5.3 AC1; Story 5.8 AC1.d/AC4/AC7; DP-5.8.A/B; Architecture §8.1.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const parsed = ThemeSchema.safeParse(cookieStore.get(THEME_COOKIE)?.value);
  const initialTheme: Theme = parsed.success ? parsed.data : 'system';

  return (
    <ThemeProvider initialTheme={initialTheme}>
      <AppShell>{children}</AppShell>
    </ThemeProvider>
  );
}
