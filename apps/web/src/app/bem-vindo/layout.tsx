import type { Metadata } from 'next';
import { cookies } from 'next/headers';

import { ThemeProvider, THEME_COOKIE } from '@/components/theme/ThemeProvider';
import { ThemeSchema, type Theme } from '@/lib/api-schemas/preferences';

export const metadata: Metadata = {
  title: 'Bem-vindo — Expressia',
};

/**
 * Layout do tour de onboarding `/bem-vindo` (Story 6.2 AC1).
 *
 * [DEV-DECISION D-6.2.1] Rota TOP-LEVEL (não em `(app)/`) para conseguir um
 * tour **fullscreen sem a sidebar/topbar** do `<AppShell>` — o `(app)/layout`
 * envolve tudo no shell 3-zonas, o que contraria a AC1. Aqui herdamos apenas o
 * `<ThemeProvider>` (modo claro/escuro, mesmo mecanismo do `(app)/layout`:
 * leitura síncrona do cookie `expressia-theme` server-side, zero round-trip DB).
 *
 * O auth gate continua garantido pelo `middleware.ts` (`/bem-vindo` está em
 * `APP_PATH_PREFIXES`); a página faz `getUser()` defensivo na mesma.
 *
 * Trace: Story 6.2 AC1; precedente `(app)/layout.tsx` (Story 5.8).
 */
export default async function BemVindoLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const parsed = ThemeSchema.safeParse(cookieStore.get(THEME_COOKIE)?.value);
  const initialTheme: Theme = parsed.success ? parsed.data : 'system';

  return (
    <ThemeProvider initialTheme={initialTheme}>
      <div className="min-h-screen bg-canvas text-foreground">{children}</div>
    </ThemeProvider>
  );
}
