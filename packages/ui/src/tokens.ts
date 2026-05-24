/**
 * Design tokens — `@meu-jarvis/ui` (Story 5.2, DP6 Epic 5 = A).
 *
 * Extraídos do `docs/front-end-spec.md` v1.0 §3 (linhas 96-216).
 * Fonte de verdade tipada — consumidos por:
 *   - Tailwind config (`tailwind.config.ts`) em stories futuras (5.3/5.8)
 *   - CSS variables (`:root` + `.dark`) em Story 5.8 (sweep dark mode toggle)
 *   - Stories 5.3 (shell), 5.6 (WidgetGrid) podem consumir directamente via
 *     `tokens.colors.light.primary` (TypeScript) ou Tailwind arbitrary values
 *     (`bg-[${tokens.colors.light.primary}]`) até Story 5.8 materializar.
 *
 * **PO_FIX_INLINE F2 v1.1 — colors.dark com 16 tokens (não 19):**
 * O front-end-spec §3.2 (linhas 122-140) lista apenas 16 entries para dark —
 * os 3 `*Subtle` de status (`successSubtle`, `warningSubtle`, `dangerSubtle`)
 * não estão definidos. Tipagem usa `Omit<>` para garantir shape correcto sem
 * inventar valores (Constitution Article IV — No Invention). Story 5.8 decide
 * se preenche (consulta @ux-design-expert) ou mantém omissão.
 *
 * Trace: Epic 5 §8 DP6; front-end-spec §3.1-§3.7.
 */

// ───────────────────────────────────────────────────────────────────────────
// COLORS — §3.1 (light: 19 tokens) + §3.2 (dark: 16 tokens — F2 v1.1)
// ───────────────────────────────────────────────────────────────────────────

const colorsLight = {
  bgCanvas: '#FAFAF7',
  bgSurface: '#FFFFFF',
  bgMuted: '#F0EEE8',
  borderDefault: '#E5E2D9',
  borderStrong: '#C8C3B5',
  textPrimary: '#1A1A1A',
  textSecondary: '#525252',
  textMuted: '#8A857A',
  primary: '#1F4F6A',
  primaryHover: '#163A4F',
  primarySubtle: '#E6EEF3',
  accent: '#B5754A',
  accentSubtle: '#F4ECE3',
  success: '#3F7D58',
  successSubtle: '#E5F0E9',
  warning: '#B8862E',
  warningSubtle: '#F8EFD9',
  danger: '#A33A2E',
  dangerSubtle: '#F5E2DE',
} as const;

export type ColorToken = keyof typeof colorsLight;

/**
 * Dark colors com 3 tokens omissos vs light (PO_FIX_INLINE F2 v1.1).
 * `successSubtle`, `warningSubtle`, `dangerSubtle` não existem em
 * front-end-spec §3.2 — `Omit<>` garante shape correcto.
 */
export type DarkColorToken = Exclude<
  ColorToken,
  'successSubtle' | 'warningSubtle' | 'dangerSubtle'
>;

const colorsDark: Record<DarkColorToken, string> = {
  bgCanvas: '#0F1311',
  bgSurface: '#171C1A',
  bgMuted: '#1F2624',
  borderDefault: '#2A322F',
  borderStrong: '#3A4541',
  textPrimary: '#F0EEE8',
  textSecondary: '#B5B0A4',
  textMuted: '#7A766C',
  primary: '#5C9BBE',
  primaryHover: '#7AB1D0',
  primarySubtle: '#1E3343',
  accent: '#D29465',
  accentSubtle: '#3A2D20',
  success: '#7DB585',
  warning: '#D4A85D',
  danger: '#D17068',
};

// ───────────────────────────────────────────────────────────────────────────
// TYPOGRAPHY — §3.3
// ───────────────────────────────────────────────────────────────────────────

const fontFamilies = {
  sans: "'Inter', system-ui, -apple-system, sans-serif",
  serif: "'Lora', Georgia, serif",
  mono: "'JetBrains Mono', ui-monospace, monospace",
} as const;

export type FontFamilyToken = keyof typeof fontFamilies;

const typeScale = {
  display: { size: '2.5rem', lineHeight: '48px', weight: 600, family: 'serif' },
  h1: { size: '2rem', lineHeight: '40px', weight: 600, family: 'serif' },
  h2: { size: '1.5rem', lineHeight: '32px', weight: 600, family: 'sans' },
  h3: { size: '1.25rem', lineHeight: '28px', weight: 600, family: 'sans' },
  h4: { size: '1rem', lineHeight: '24px', weight: 600, family: 'sans' },
  body: { size: '0.9375rem', lineHeight: '24px', weight: 400, family: 'sans' },
  bodySmall: { size: '0.8125rem', lineHeight: '20px', weight: 400, family: 'sans' },
  caption: { size: '0.75rem', lineHeight: '16px', weight: 500, family: 'sans' },
  mono: { size: '0.875rem', lineHeight: '20px', weight: 500, family: 'mono' },
  monoSmall: { size: '0.75rem', lineHeight: '16px', weight: 500, family: 'mono' },
} as const;

export type TypeScaleToken = keyof typeof typeScale;

// ───────────────────────────────────────────────────────────────────────────
// SPACING — §3.4 (11 tokens, sistema 4px base)
// ───────────────────────────────────────────────────────────────────────────

const spacing = {
  space0: '0',
  space1: '0.25rem',
  space2: '0.5rem',
  space3: '0.75rem',
  space4: '1rem',
  space5: '1.25rem',
  space6: '1.5rem',
  space8: '2rem',
  space10: '2.5rem',
  space12: '3rem',
  space16: '4rem',
} as const;

export type SpacingToken = keyof typeof spacing;

// ───────────────────────────────────────────────────────────────────────────
// RADIUS — §3.5 (6 tokens)
// ───────────────────────────────────────────────────────────────────────────

const radius = {
  sm: '4px',
  md: '8px',
  lg: '12px',
  xl: '16px',
  '2xl': '24px',
  full: '9999px',
} as const;

export type RadiusToken = keyof typeof radius;

// ───────────────────────────────────────────────────────────────────────────
// SHADOWS — §3.6 (5 tokens; sombras calibradas para fundo creme)
// ───────────────────────────────────────────────────────────────────────────

const shadows = {
  xs: '0 1px 2px rgba(26,26,26,0.04)',
  sm: '0 2px 4px rgba(26,26,26,0.05)',
  md: '0 4px 12px rgba(26,26,26,0.08)',
  lg: '0 12px 32px rgba(26,26,26,0.10)',
  xl: '0 24px 48px rgba(26,26,26,0.12)',
} as const;

export type ShadowToken = keyof typeof shadows;

// ───────────────────────────────────────────────────────────────────────────
// TRANSITIONS — §3.7 (4 tokens; respeitar `prefers-reduced-motion`)
// ───────────────────────────────────────────────────────────────────────────

const transitions = {
  fast: { duration: 120, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' },
  default: { duration: 180, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' },
  slow: { duration: 240, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' },
  spring: { duration: 320, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' },
} as const;

export type TransitionToken = keyof typeof transitions;

// ───────────────────────────────────────────────────────────────────────────
// EXPORT PRINCIPAL — agregado tokens
// ───────────────────────────────────────────────────────────────────────────

/**
 * Tokens agregados de design system. Consumir como:
 * ```ts
 * import { tokens } from '@meu-jarvis/ui';
 * const primary = tokens.colors.light.primary; // '#1F4F6A'
 * const dark = tokens.colors.dark.primary;     // '#5C9BBE'
 * ```
 *
 * Cross-confirm contagem (PO_FIX_INLINE F2 v1.1):
 * `Object.keys(tokens.colors.light).length === 19`
 * `Object.keys(tokens.colors.dark).length === 16`
 */
export const tokens = {
  colors: {
    light: colorsLight,
    dark: colorsDark,
  },
  typography: {
    fontFamilies,
    typeScale,
  },
  spacing,
  radius,
  shadows,
  transitions,
} as const;
