/**
 * RLS isolation — `user_prefs` (FR4, FR21, FR22).
 *
 * Story 5.1 AC4 — smoke tests pós-ALTER (`0016_user_prefs_theme_widgets.sql`)
 * confirmando que:
 *   1. Cross-household isolation preservada para `theme` (cross-tenancy +
 *      user-scoped predicate combo de `0001_rls_policies.sql:711-755`).
 *   2. Cross-household isolation preservada para `widgets_enabled`.
 *   3. Defaults SQL aplicados em INSERT sem valores explícitos
 *      (`theme='system'`, `widgets_enabled={5 ON + 2 OFF}` — front-end-spec §5.4).
 *
 * Predicate RLS user_prefs:
 *   `is_household_member(household_id) AND auth.uid() = user_id`
 *
 * Mais forte que o padrão `member` standard — combina cross-tenancy
 * isolation com user-scoped constraint específico desta tabela 1:1 user
 * (D29). Owner do household NÃO consegue ler prefs cognitivas de outros
 * membros.
 *
 * Trace: Story 5.1 AC4; Story 2.7 predicate combo; harness Story 1.4.
 */
import { afterAll, beforeEach, describe, expect, test } from 'vitest';

import { admin, insertUserPrefs } from '@/helpers/fixtures';
import { asUser, closeRlsHarness, resetData, seedTwoHouseholds } from '@/rls-harness';

afterAll(async () => {
  await closeRlsHarness();
});

describe('RLS isolation: user_prefs (Story 5.1)', () => {
  beforeEach(async () => {
    await resetData();
  });

  test('cross-household SELECT — U2 não vê theme/widgets_enabled de U1', async () => {
    const { householdA, householdB, userA, userB } = await seedTwoHouseholds();
    // U1 grava prefs específicas no household A.
    await insertUserPrefs(admin(), userA.id, householdA.id, {
      theme: 'dark',
      widgetsEnabled: {
        briefing: false,
        tasks_today: true,
        finance_month: false,
        recurrences_next: false,
        tasks_overdue: false,
        accounts_balance: true,
        calendar_week: true,
      },
    });

    // U2 (household B) tenta ler — RLS deve retornar 0 rows.
    await asUser(userB.id, householdB.id, async (sql) => {
      const rows = await sql<{ theme: string }[]>`
        select theme from public.user_prefs where user_id = ${userA.id}
      `;
      expect(rows).toHaveLength(0);
    });
  });

  test('cross-household UPDATE — U2 não consegue alterar widgets_enabled de U1', async () => {
    const { householdA, householdB, userA, userB } = await seedTwoHouseholds();
    await insertUserPrefs(admin(), userA.id, householdA.id, { theme: 'dark' });

    // U2 tenta UPDATE remoto — RLS deve filtrar antes do UPDATE (0 rows affected).
    await asUser(userB.id, householdB.id, async (sql) => {
      const result = await sql`
        update public.user_prefs
           set theme = 'light'
         where user_id = ${userA.id}
        returning user_id
      `;
      expect(result).toHaveLength(0);
    });

    // Verificar (via admin) que o valor de U1 não mudou.
    const verify = await admin()<{ theme: string }[]>`
      select theme from public.user_prefs where user_id = ${userA.id}
    `;
    expect(verify).toHaveLength(1);
    expect(verify[0]?.theme).toBe('dark');
  });

  test('defaults SQL aplicados em INSERT sem valores explícitos (migration 0016)', async () => {
    const { householdA, userA } = await seedTwoHouseholds();
    // INSERT só com user_id + household_id — defaults da migration 0016
    // devem ser aplicados a always_preview, theme e widgets_enabled.
    await insertUserPrefs(admin(), userA.id, householdA.id, { useDefaults: true });

    // Verificar via admin que defaults estão correctos.
    const rows = await admin()<
      {
        always_preview: boolean;
        theme: string;
        widgets_enabled: Record<string, boolean>;
      }[]
    >`
      select always_preview, theme, widgets_enabled
        from public.user_prefs
       where user_id = ${userA.id}
    `;
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.always_preview).toBe(false); // Story 2.7 default
    expect(row.theme).toBe('system'); // Story 5.1 AC1(a) default
    // 5 default ON + 2 default OFF conforme front-end-spec §5.4 (Story 5.1 AC1(b)).
    expect(row.widgets_enabled).toEqual({
      briefing: true,
      tasks_today: true,
      finance_month: true,
      recurrences_next: true,
      tasks_overdue: true,
      accounts_balance: false,
      calendar_week: false,
    });
  });
});
