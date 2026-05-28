// @vitest-environment node
/**
 * Tests — constantes locais dos widgets (`DEFAULT_WIDGETS_ENABLED`, `WIDGET_ORDER`)
 * (Story 5.6 PO-FIX-2, AC3.a, AC9).
 *
 * Confirma a paridade local com `prefs.ts:69` (5 ON / 2 OFF) e que a const local
 * valida contra o `WidgetsEnabledSchema` (single source of truth runtime).
 */
import { describe, expect, it } from 'vitest';

import { WidgetsEnabledSchema } from '@/lib/api-schemas/preferences';
import {
  DEFAULT_WIDGETS_ENABLED,
  WIDGET_ORDER,
  WIDGET_LABELS,
} from '@/app/(app)/visao/_lib/widgets';

describe('DEFAULT_WIDGETS_ENABLED (PO-FIX-2 — redeclaração local)', () => {
  it('tem 5 widgets ON e 2 OFF (match prefs.ts:69)', () => {
    expect(DEFAULT_WIDGETS_ENABLED).toEqual({
      briefing: true,
      tasks_today: true,
      finance_month: true,
      recurrences_next: true,
      tasks_overdue: true,
      accounts_balance: false,
      calendar_week: false,
    });
  });

  it('valida contra WidgetsEnabledSchema (parity guard runtime)', () => {
    expect(WidgetsEnabledSchema.safeParse(DEFAULT_WIDGETS_ENABLED).success).toBe(true);
  });
});

describe('WIDGET_ORDER (ordem canónica AC3.a)', () => {
  it('tem os 7 widgets na ordem do wireframe front-end-spec §5.4', () => {
    expect(WIDGET_ORDER).toEqual([
      'briefing',
      'tasks_today',
      'finance_month',
      'recurrences_next',
      'tasks_overdue',
      'accounts_balance',
      'calendar_week',
    ]);
  });
});

describe('WIDGET_LABELS (Story 5.7 AC5 — single source PT-PT)', () => {
  it('tem exactamente as 7 chaves de WidgetId (parity)', () => {
    expect(Object.keys(WIDGET_LABELS).sort()).toEqual([...WIDGET_ORDER].sort());
  });

  it('labels byte-a-byte iguais aos títulos hardcoded dos cards', () => {
    // Fonte: títulos `<WidgetCard title="…">` dos 7 widgets (front-end-spec §5.4).
    expect(WIDGET_LABELS).toEqual({
      briefing: 'Briefing diário',
      tasks_today: 'Tarefas hoje',
      finance_month: 'Gastos do mês',
      recurrences_next: 'Próximas recorrências',
      tasks_overdue: 'Tarefas atrasadas',
      accounts_balance: 'Saldo por conta',
      calendar_week: 'Calendário da semana',
    });
  });

  it('toda a chave de WIDGET_ORDER tem label não-vazia', () => {
    for (const id of WIDGET_ORDER) {
      expect(WIDGET_LABELS[id]).toBeTruthy();
      expect(typeof WIDGET_LABELS[id]).toBe('string');
    }
  });
});
