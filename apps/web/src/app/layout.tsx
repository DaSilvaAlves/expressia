import type { Metadata, Viewport } from 'next';

import '@/app/globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Expressia',
    template: '%s — Expressia',
  },
  description:
    'Expressia — o teu assistente fullstack para tarefas, finanças e rotinas familiares em português europeu.',
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
      <body>{children}</body>
    </html>
  );
}
