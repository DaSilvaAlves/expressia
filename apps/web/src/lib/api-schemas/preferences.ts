/**
 * Zod schemas — endpoint `/api/conta/preferencias` (Story 5.1 AC3).
 *
 * Convenções (Story 5.1 AC3 + AC6): `.strict()` rejeita campos extra para
 * impedir shape drift do JSONB (R-5.4 Epic 5 mitigação). Story 5.7/5.8
 * consomem `PreferencesPatchSchema` no PATCH handler.
 *
 * Single source of truth: `WidgetsEnabled` type vive em
 * `@meu-jarvis/db/src/schema/prefs.ts` (Story 5.1 AC2.d). Aqui só
 * declaramos o Zod schema que valida runtime — o type TS é re-exportado
 * para conveniência sem duplicação.
 *
 * Mensagens de erro em PT-PT europeu (AC6 / CON3).
 *
 * Trace: Story 5.1 AC1+AC3; Epic 5 §8 DP2 (tema híbrido) + DP3 (JSONB Zod);
 * PRD FR21+FR22.
 */
import type { WidgetsEnabled } from '@meu-jarvis/db';
import { z } from 'zod';

/**
 * Modo de tema preferido pelo utilizador (FR22).
 *
 * Validado contra o CHECK constraint `user_prefs_theme_check` aplicado
 * pela migration 0016. Default `'system'` segue preferência do OS.
 */
export const ThemeSchema = z.enum(['light', 'dark', 'system']);
export type Theme = z.infer<typeof ThemeSchema>;

/**
 * Configuração de widgets do dashboard "Visão" (FR21).
 *
 * `.strict()` rejeita keys desconhecidas — qualquer widget novo no futuro
 * exige update explícito deste schema (não pode ser injectado via PATCH).
 * 7 chaves obrigatórias alinhadas com `WidgetId` em `@meu-jarvis/db`.
 *
 * Trace: front-end-spec §5.4 (naming dos 7 widgets).
 */
export const WidgetsEnabledSchema = z
  .object({
    briefing: z.boolean(),
    tasks_today: z.boolean(),
    finance_month: z.boolean(),
    recurrences_next: z.boolean(),
    tasks_overdue: z.boolean(),
    accounts_balance: z.boolean(),
    calendar_week: z.boolean(),
  })
  .strict();

/**
 * Type narrowing: garante que o output do Zod parsing é compatível com
 * o type `WidgetsEnabled` exportado por `@meu-jarvis/db` (single source
 * of truth — schema da DB).
 */
type _WidgetsEnabledParityCheck = z.infer<typeof WidgetsEnabledSchema> extends WidgetsEnabled
  ? WidgetsEnabled extends z.infer<typeof WidgetsEnabledSchema>
    ? true
    : false
  : false;
// Se este alias falhar a compilação, é porque os tipos divergiram —
// actualizar uma das fontes para manter parity.
const _widgetsEnabledParity: _WidgetsEnabledParityCheck = true;
void _widgetsEnabledParity;

/**
 * Schema parcial para `PATCH /api/conta/preferencias` — todos os campos
 * são opcionais (utilizador pode actualizar só `theme`, só `widgets_enabled`,
 * ou ambos). `.strict()` rejeita campos não-listados.
 *
 * `always_preview` mantém-se aqui para compatibilidade com Story 2.7
 * (endpoint pré-existente).
 *
 * Stories que consomem: 5.7 (widget config UI) e 5.8 (toggle tema).
 */
export const PreferencesPatchSchema = z
  .object({
    always_preview: z.boolean().optional(),
    theme: ThemeSchema.optional(),
    widgets_enabled: WidgetsEnabledSchema.optional(),
  })
  .strict();

export type PreferencesPatch = z.infer<typeof PreferencesPatchSchema>;
