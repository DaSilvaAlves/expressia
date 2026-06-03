import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { sql } from 'drizzle-orm';

import { createServerSupabaseClient } from '@meu-jarvis/auth/server';
import { captureException } from '@meu-jarvis/observability';
import type { WidgetsEnabled } from '@meu-jarvis/db';

import { getDb, withHousehold } from '@/lib/agent/db-shim';
import { resolveHouseholdId } from '@/lib/api-helpers/auth';
import { WidgetsEnabledSchema } from '@/lib/api-schemas/preferences';
import {
  getAccountsBalance,
  getCalendarWeek,
  getFinancesMonth,
  getRecurrencesNext,
  getTasksOverdue,
  getTasksToday,
} from '@/lib/visao/queries';
import { formatGreetingDate, getGreeting, resolveDisplayName } from '@/app/(app)/visao/_lib/greeting';
import { DEFAULT_WIDGETS_ENABLED, WIDGET_ORDER } from '@/app/(app)/visao/_lib/widgets';
import { WidgetGrid } from '@/app/(app)/visao/_components/WidgetGrid';
import { VisaoEmptyState } from '@/app/(app)/visao/_components/VisaoEmptyState';
import { WidgetConfigHydrator } from '@/app/(app)/visao/_components/WidgetConfigHydrator';
import { AddWidgetMenu } from '@/app/(app)/visao/_components/AddWidgetMenu';
import { WidgetConfigStatus } from '@/app/(app)/visao/_components/WidgetConfigStatus';
import { WelcomeToast } from '@/app/(app)/visao/_components/WelcomeToast';

export const metadata: Metadata = {
  title: 'Visão — Expressia',
};

interface PrefsRow {
  widgets_enabled: unknown;
}

/**
 * Lê `widgets_enabled` do utilizador em RSC-direct via `getDb()` (DP-5.6.B).
 *
 * - Valida o JSONB com `WidgetsEnabledSchema` (tolera JSONB legacy / shape drift).
 * - Fallback `DEFAULT_WIDGETS_ENABLED` (const local — PO-FIX-2) quando a row não
 *   existe (lazy-init de prefs ainda não correu) OU o JSONB é inválido.
 * - Este valor é também injectado no `widgetConfigStore` (Story 5.7) via
 *   `<WidgetConfigHydrator>` como estado inicial dos controlos de config.
 *   (O `GET /api/conta/preferencias` passou a devolver `widgets_enabled` na
 *   Story 5.7, mas a `/visao` continua a ler RSC-direct — DP-5.6.B.)
 */
async function readWidgetsEnabled(userId: string): Promise<WidgetsEnabled> {
  try {
    const db = getDb();
    const rows = await db.execute<PrefsRow>(sql`
      select widgets_enabled
      from public.user_prefs
      where user_id = ${userId}::uuid
      limit 1
    `);
    const raw = rows[0]?.widgets_enabled;
    if (raw == null) return DEFAULT_WIDGETS_ENABLED;

    const parsed = WidgetsEnabledSchema.safeParse(raw);
    return parsed.success ? parsed.data : DEFAULT_WIDGETS_ENABLED;
  } catch (err) {
    captureException(err instanceof Error ? err : new Error(String(err)), {
      route: '/visao',
      userId,
      extra: { op: 'readWidgetsEnabled' },
    });
    return DEFAULT_WIDGETS_ENABLED;
  }
}

/**
 * Gate de onboarding (Story 6.2 AC2): `true` se o utilizador já completou OU
 * saltou o tour (`user_prefs.onboarding_completed_at` não-null).
 *
 * Lazy-init: para utilizadores novos a row de `user_prefs` ainda não existe (o
 * trigger 0019 cria household/membership/conta/subscription, NÃO `user_prefs`)
 * → sem row = onboarding não visto = `false` → `/visao` redirecciona `/bem-vindo`.
 *
 * [DEV-DECISION D-6.2.2] Em erro de DB devolve `true` (deixa passar) para NUNCA
 * prender o utilizador num loop de redirect `/visao` ⇄ `/bem-vindo`.
 */
async function hasCompletedOnboarding(userId: string): Promise<boolean> {
  try {
    const db = getDb();
    const rows = await db.execute<{ onboarding_completed_at: string | null }>(sql`
      select onboarding_completed_at
      from public.user_prefs
      where user_id = ${userId}::uuid
      limit 1
    `);
    return rows[0]?.onboarding_completed_at != null;
  } catch (err) {
    captureException(err instanceof Error ? err : new Error(String(err)), {
      route: '/visao',
      userId,
      extra: { op: 'hasCompletedOnboarding' },
    });
    return true;
  }
}

/**
 * Decide se a `/visao` deve mostrar o empty-state global (AC7.b — DEV-DECISION).
 *
 * **Heurística (documentada):** o empty-state global aparece quando há ≥ 1 widget
 * de conteúdo activo E todos os agregados com dados retornam contadores a zero.
 * O `briefing` é ignorado nesta heurística (é um stub `available:false` sem
 * conteúdo real — nunca "preenche" a Visão). Só os widgets ON são consultados,
 * para não fazer queries desnecessárias.
 *
 * Em erro de qualquer agregado, assume-se NÃO-vazio (devolve `false`) — preferir
 * mostrar os widgets (que têm o seu próprio fallback inline) a esconder tudo.
 *
 * NOTA: estas queries correm uma vez para a decisão de empty-state; os widgets
 * voltam a chamá-las dentro dos seus `<Suspense>`. O trade-off (queries leves
 * agregadas, indexadas) é aceite para manter a página simples; uma optimização
 * de partilha de cache fica para a Story 5.10 (perf sweep).
 */
async function isVisaoEmpty(
  widgetsEnabled: WidgetsEnabled,
  householdId: string,
  userId: string,
): Promise<boolean> {
  try {
    // SEC-6 — os ≤6 agregados household-scoped correm num único `withHousehold`
    // (2.ª rede RLS em runtime). O filtro `household_id` de `queries.ts` (1.ª
    // rede) MANTÉM-SE dentro de cada `getX` — defense-in-depth.
    return await withHousehold({ userId, householdId }, async (tx) => {
      const checks: Array<Promise<boolean>> = [];

      if (widgetsEnabled.tasks_today) {
        checks.push(getTasksToday(tx, householdId).then((d) => d.count === 0));
      }
      if (widgetsEnabled.tasks_overdue) {
        checks.push(getTasksOverdue(tx, householdId).then((d) => d.count === 0));
      }
      if (widgetsEnabled.finance_month) {
        checks.push(getFinancesMonth(tx, householdId).then((d) => d.transactionCount === 0));
      }
      if (widgetsEnabled.recurrences_next) {
        checks.push(getRecurrencesNext(tx, householdId).then((d) => d.count === 0));
      }
      if (widgetsEnabled.accounts_balance) {
        checks.push(getAccountsBalance(tx, householdId).then((d) => d.accountCount === 0));
      }
      if (widgetsEnabled.calendar_week) {
        checks.push(
          getCalendarWeek(tx, householdId).then((d) => d.days.every((day) => day.taskCount === 0)),
        );
      }

      // Sem widgets de conteúdo activos → não há "vazio total" a comunicar aqui.
      if (checks.length === 0) return false;

      const results = await Promise.all(checks);
      return results.every((empty) => empty);
    });
  } catch (err) {
    captureException(err instanceof Error ? err : new Error(String(err)), {
      route: '/visao',
      extra: { op: 'isVisaoEmpty' },
    });
    return false;
  }
}

/**
 * `/visao` — Dashboard "Visão" (Story 5.6).
 *
 * Server Component (RSC) que substitui o placeholder Story 1.5 (AC1):
 *   (a) autentica via `createServerSupabaseClient` + `getUser()`; redirect
 *       `/entrar` se sem sessão (precedente `financas/este-mes`).
 *   (b) lê `widgets_enabled` RSC-direct (DP-5.6.B), fallback gracioso ao default.
 *   (c) renderiza header de saudação contextual PT-PT (AC2) + `<WidgetGrid>`
 *       (AC3) OU `<VisaoEmptyState>` global quando tudo está vazio (AC7).
 *
 * Renderiza dentro de `<main>` do `AppShell` (Story 5.3 — não tocado aqui).
 *
 * Story 6.2 AC2: gate de onboarding — utilizador que ainda não viu o tour é
 * redireccionado para `/bem-vindo` (reusa a leitura RSC-direct de `user_prefs`).
 * O param `?welcome=1` (vindo da server action do tour) mostra o toast (AC8).
 *
 * Trace: Story 5.6 AC1, AC2, AC3, AC7; Story 6.2 AC2/AC8; FR21; RLS NFR5 via `getDb()`.
 */
export default async function VisaoPage({
  searchParams,
}: {
  searchParams?: Promise<{ welcome?: string }>;
} = {}): Promise<React.ReactElement> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/entrar');

  // Story 6.2 AC2 — gate de onboarding: primeira utilização → tour /bem-vindo.
  const onboardingDone = await hasCompletedOnboarding(user.id);
  if (!onboardingDone) redirect('/bem-vindo');

  // SEC-1 — isolamento app-enforced: o household_id é necessário para filtrar
  // todas as queries dos widgets (a RLS está inerte em runtime). Sem household,
  // o utilizador ainda não completou o registo → tour /bem-vindo.
  const householdId = await resolveHouseholdId(user.id);
  if (!householdId) redirect('/bem-vindo');

  const { welcome } = (await searchParams) ?? {};
  const showWelcome = welcome === '1';

  const displayName = resolveDisplayName(user);
  const now = new Date();
  const greeting = getGreeting(now);

  const widgetsEnabled = await readWidgetsEnabled(user.id);
  const empty = await isVisaoEmpty(widgetsEnabled, householdId, user.id);
  // "Vazio por config" — utilizador removeu todos os widgets (distinto de
  // "vazio por dados" = `empty`). Story 5.7 AC6.
  const allOff = WIDGET_ORDER.every((id) => !widgetsEnabled[id]);

  return (
    <div className="space-y-6">
      {showWelcome && <WelcomeToast name={displayName} />}
      <header>
        <h1 className="font-serif text-2xl font-semibold tracking-tight md:text-3xl">
          {greeting}, {displayName}.
        </h1>
        <p className="mt-1 text-sm capitalize text-neutral-500">
          Hoje é {formatGreetingDate(now)}.
        </p>
      </header>

      {/* Story 5.7 — hidrata o widgetConfigStore com o estado lido RSC-direct. */}
      <WidgetConfigHydrator initial={widgetsEnabled} />

      {allOff ? (
        <p className="rounded-lg border border-dashed border-black/10 px-4 py-8 text-center text-sm text-neutral-500 dark:border-white/10">
          O teu painel está vazio. Adiciona widgets abaixo.
        </p>
      ) : empty ? (
        <VisaoEmptyState />
      ) : (
        <WidgetGrid widgetsEnabled={widgetsEnabled} householdId={householdId} userId={user.id} />
      )}

      {/* Story 5.7 — controlos de config inline (DP4 = B). Sempre acessíveis,
          incluindo no estado "todos OFF" (AC6). */}
      <div className="flex flex-col items-start gap-2">
        <AddWidgetMenu initial={widgetsEnabled} />
        <WidgetConfigStatus />
      </div>
    </div>
  );
}
