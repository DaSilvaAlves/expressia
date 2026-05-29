/**
 * Classes Tailwind partilhadas das páginas de auth (entrar, registar, recuperar,
 * confirm) — Story 6.1 AC1.
 *
 * Substituem as cores hardcoded anteriores (`bg-black`, `border-black/15`,
 * `bg-white`, `focus:ring-blue-500`, `bg-red-50`…) por tokens do design system
 * `@meu-jarvis/ui` materializados em `globals.css` (`:root`/`.dark`) e mapeados
 * no `tailwind.config.ts`. Dark-first, coerente com o shell do Epic 5.
 *
 * Decisões de tematização (Story 6.1):
 *   - Botão primário usa `text-surface` (não `text-white`): o token inverte com
 *     o tema → contraste WCAG garantido em ambos os modos (#fff sobre primary
 *     escuro #1F4F6A no claro; #171c1a sobre primary claro #5C9BBE no escuro).
 *   - Mensagens de estado usam borda + texto (`border-danger`/`border-success`)
 *     sem fundo `*-subtle`: os tokens `danger-subtle`/`success-subtle` só existem
 *     no modo claro (front-end-spec §3.2 não define equivalentes dark — ver
 *     `tokens.ts` / Constitution Article IV — No Invention). Não os inventamos.
 *   - Inputs em `bg-canvas` dentro do card `bg-surface` → profundidade subtil
 *     coerente em ambos os modos.
 *
 * Trace: Story 6.1 AC1; front-end-spec §3; packages/ui/src/tokens.ts;
 *        apps/web/tailwind.config.ts; apps/web/src/app/globals.css.
 */

/** Input de texto/email/password. */
export const INPUT_CLASS =
  'w-full rounded-md border border-border-default bg-canvas px-3 py-2 text-sm text-foreground placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary';

/** Label de campo de formulário. */
export const LABEL_CLASS = 'mb-1 block text-sm font-medium text-foreground';

/** Botão primário (submit). */
export const PRIMARY_BUTTON_CLASS =
  'w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-surface transition-colors hover:bg-primary-hover disabled:opacity-60';

/** Botão/link secundário com aparência de botão (ex.: "Voltar a entrar"). */
export const SECONDARY_BUTTON_CLASS =
  'block w-full rounded-md border border-border-default px-3 py-2 text-center text-sm font-medium text-foreground transition-colors hover:bg-bg-muted';

/** Caixa de erro (role="alert"). */
export const ERROR_CLASS =
  'rounded-md border border-danger px-3 py-2 text-sm text-danger';

/** Caixa de informação/sucesso (role="status"). */
export const INFO_CLASS =
  'rounded-md border border-success px-3 py-2 text-sm text-success';

/** Texto auxiliar abaixo de um campo (ex.: "Mínimo 8 caracteres."). */
export const HINT_CLASS = 'mt-1 text-xs text-muted-foreground';

/** Hiperligação inline destacada. */
export const LINK_CLASS = 'font-medium text-primary underline hover:no-underline';
