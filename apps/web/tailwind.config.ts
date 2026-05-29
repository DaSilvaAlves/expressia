import type { Config } from 'tailwindcss';

const config: Config = {
  // Story 5.8 (AC1.a / DP-5.8.A) — `darkMode: 'class'` em vez do default `'media'`.
  // Necessário para toggle manual por utilizador (FR22): as variantes `dark:` só
  // são emitidas quando existe a classe `dark` no `<html>` (aplicada pelo script
  // anti-FOUC + ThemeProvider). `'media'` (OS-driven) não permitia toggle manual.
  darkMode: 'class',
  content: [
    './src/app/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
    './src/lib/**/*.{ts,tsx}',
    // Story 5.2 — Tailwind precisa de detectar classes usadas dentro de
    // @meu-jarvis/ui (caso contrário seriam purged do CSS final).
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      // Story 5.8 (AC5.a / PO-FIX-2) — bloco `colors` que mapeia os nomes
      // semânticos às CSS vars de `globals.css`. ANTES desta story o config
      // NÃO tinha bloco `colors` — as classes `bg-background`/`text-foreground`/
      // `text-muted-foreground`/`border-border` (usadas em 14 ficheiros) ficavam
      // SILENCIOSAMENTE sem estilo. Cada var é hex (DP-5.8.C — `tokens.ts` é a
      // fonte canónica; `globals.css` materializa em `:root`/`.dark`).
      //
      // Dois conjuntos coexistem (D-5.8.1):
      //   - Nomes legacy (`background`/`foreground`/`muted`/`muted-foreground`/
      //     `border`) — preservam as classes já em uso, zero sweep desnecessário.
      //   - Nomes semânticos do front-end-spec §3.1-3.2 (`bg-canvas`/`bg-surface`/
      //     `text-primary`/...) — disponíveis para componentes novos.
      colors: {
        // ── Legacy aliases (Story 2.7/5.3) — mantidos para compat ──
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        muted: {
          DEFAULT: 'var(--muted)',
          foreground: 'var(--muted-foreground)',
        },
        border: 'var(--border)',
        // ── Semânticos canónicos (front-end-spec §3.1-3.2 / tokens.ts) ──
        canvas: 'var(--bg-canvas)',
        surface: 'var(--bg-surface)',
        'bg-muted': 'var(--bg-muted)',
        'border-default': 'var(--border-default)',
        'border-strong': 'var(--border-strong)',
        'text-primary': 'var(--text-primary)',
        'text-secondary': 'var(--text-secondary)',
        'text-muted': 'var(--text-muted)',
        primary: {
          DEFAULT: 'var(--primary)',
          hover: 'var(--primary-hover)',
          subtle: 'var(--primary-subtle)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          subtle: 'var(--accent-subtle)',
        },
        success: {
          DEFAULT: 'var(--success)',
          subtle: 'var(--success-subtle)',
        },
        warning: {
          DEFAULT: 'var(--warning)',
          subtle: 'var(--warning-subtle)',
        },
        danger: {
          DEFAULT: 'var(--danger)',
          subtle: 'var(--danger-subtle)',
        },
      },
    },
  },
  plugins: [],
};

export default config;
