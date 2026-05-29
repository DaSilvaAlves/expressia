import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { createServerSupabaseClient } from '@meu-jarvis/auth/server';

import { PrefsToggle } from '@/app/(app)/conta/preferencias/_components/prefs-toggle';
import { ThemeToggle } from '@/app/(app)/conta/preferencias/_components/theme-toggle';

export const metadata: Metadata = {
  title: 'Preferências — Expressia',
};

/**
 * Página `/conta/preferencias` — toggle FR4 `always_preview`.
 *
 * Server Component que faz fetch directo via Supabase + DB query (lazy-init
 * via endpoint GET /api/conta/preferencias seria duplo round-trip; aqui
 * fazemos apenas SSR initial value e o Client Component faz PATCH).
 *
 * Na realidade, fazer fetch ao próprio endpoint a partir de RSC requer URL
 * absoluta — preferimos chamar logica directa via DB shim.
 *
 * Trace: Story 2.7 AC10, Architecture §4.4, FR4.
 */
export default async function PreferenciasPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/entrar');
  }

  // Fetch initial value via endpoint próprio — `headers()` injecta cookies
  // automaticamente em fetch SSR, garantindo auth via session.
  const hdrs = await headers();
  const protocol = hdrs.get('x-forwarded-proto') ?? 'http';
  const host = hdrs.get('host') ?? 'localhost:3000';
  const cookie = hdrs.get('cookie') ?? '';

  let initialAlwaysPreview = false;
  try {
    const res = await fetch(`${protocol}://${host}/api/conta/preferencias`, {
      headers: { cookie },
      cache: 'no-store',
    });
    if (res.ok) {
      const data = (await res.json()) as { always_preview?: boolean };
      initialAlwaysPreview = data.always_preview ?? false;
    }
  } catch {
    // Falha não-fatal — Client Component faz refresh próprio se necessário.
  }

  return (
    <div className="space-y-6">
      <div>
        <nav className="text-xs text-muted-foreground" aria-label="Breadcrumb">
          Conta › Preferências
        </nav>
        <h1 className="mt-1 text-2xl font-bold">Preferências</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Ajusta o comportamento do Jarvis ao teu gosto.
        </p>
      </div>

      <PrefsToggle initial={{ always_preview: initialAlwaysPreview }} />

      {/* Story 5.8 (AC2.d) — toggle de tema. O valor inicial vem do
          `<ThemeProvider>` (cookie lido server-side em `(app)/layout.tsx`),
          via `useTheme()` — sem round-trip extra. */}
      <ThemeToggle />
    </div>
  );
}
