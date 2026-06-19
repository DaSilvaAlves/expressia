import type { Metadata, Viewport } from 'next';

import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';

import { THEME_SCRIPT } from '@/components/theme/theme-script';

import '@/app/globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Expressia',
    template: '%s — Expressia',
  },
  description:
    'Expressia — o teu assistente fullstack para tarefas, finanças e o teu dia a dia em português europeu.',
  applicationName: 'Expressia',
  authors: [{ name: 'Expressia' }],
  generator: 'Next.js',
  referrer: 'origin-when-cross-origin',
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0b1220' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-PT">
      <head>
        {/* Story 5.8 (AC1.c) — anti-FOUC: aplica a classe `dark` ANTES do
            primeiro paint, lendo o cookie `expressia-theme`. JS puro,
            pré-hidratação — elimina o flash de tema errado (DP-5.8.A). */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        {children}
        {/* Vercel Observability (Story 1.7 AC4) — RUM/Web Vitals + Analytics. */}
        {/* Both auto-noop em dev (NODE_ENV !== 'production'); ambos respeitam DNT. */}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
