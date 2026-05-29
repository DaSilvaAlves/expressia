import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Autenticação',
};

/**
 * Layout partilhado pelas páginas de auth (entrar, registar, recuperar).
 *
 * Design: simples, centrado, acessível. Sem glassmorphism — formulários
 * de auth são pontos de stress; clareza > estética. Branding via tokens do
 * design system `@meu-jarvis/ui` (Story 6.1 AC1): card `bg-surface` +
 * `border-border`, wordmark `text-primary`. Dark mode via classe `.dark`
 * (toggle FR22, Story 5.8) — sem cores hardcoded.
 *
 * Trace: Story 1.5 Task 5, Story 6.1 AC1, Architecture §8.1 (route group `(auth)/`).
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-8">
      <Link
        href="/"
        className="mb-8 text-2xl font-bold tracking-tight text-primary"
      >
        Expressia
      </Link>
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-6 shadow-sm">
        {children}
      </div>
      <p className="mt-6 text-xs text-muted-foreground">
        Em portugu&ecirc;s europeu, com seguran&ccedil;a multi-tenant.
      </p>
    </main>
  );
}
