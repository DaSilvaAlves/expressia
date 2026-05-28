import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { sql } from 'drizzle-orm';

import { createServerSupabaseClient } from '@meu-jarvis/auth/server';
import { captureException } from '@meu-jarvis/observability';
import type { WidgetsEnabled } from '@meu-jarvis/db';

import { getDb } from '@/lib/agent/db-shim';
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
import { DEFAULT_WIDGETS_ENABLED } from '@/app/(app)/visao/_lib/widgets';
import { WidgetGrid } from '@/app/(app)/visao/_components/WidgetGrid';
import { VisaoEmptyState } from '@/app/(app)/visao/_components/VisaoEmptyState';

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
 * - NÃO estende `GET /api/conta/preferencias` (só devolve `always_preview` —
 *   Story 5.7 fá-lo-á se precisar).
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
async function isVisaoEmpty(widgetsEnabled: WidgetsEnabled): Promise<boolean> {
  const db = getDb();
  try {
    const checks: Array<Promise<boolean>> = [];

    if (widgetsEnabled.tasks_today) {
      checks.push(getTasksToday(db).then((d) => d.count === 0));
    }
    if (widgetsEnabled.tasks_overdue) {
      checks.push(getTasksOverdue(db).then((d) => d.count === 0));
    }
    if (widgetsEnabled.finance_month) {
      checks.push(getFinancesMonth(db).then((d) => d.transactionCount === 0));
    }
    if (widgetsEnabled.recurrences_next) {
      checks.push(getRecurrencesNext(db).then((d) => d.count === 0));
    }
    if (widgetsEnabled.accounts_balance) {
      checks.push(getAccountsBalance(db).then((d) => d.accountCount === 0));
    }
    if (widgetsEnabled.calendar_week) {
      checks.push(
        getCalendarWeek(db).then((d) => d.days.every((day) => day.taskCount === 0)),
      );
    }

    // Sem widgets de conteúdo activos → não há "vazio total" a comunicar aqui.
    if (checks.length === 0) return false;

    const results = await Promise.all(checks);
    return results.every((empty) => empty);
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
 * Trace: Story 5.6 AC1, AC2, AC3, AC7; FR21; RLS NFR5 via `getDb()`.
 */
export default async function VisaoPage(): Promise<React.ReactElement> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/entrar');

  const displayName = resolveDisplayName(user);
  const now = new Date();
  const greeting = getGreeting(now);

  const widgetsEnabled = await readWidgetsEnabled(user.id);
  const empty = await isVisaoEmpty(widgetsEnabled);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-serif text-2xl font-semibold tracking-tight md:text-3xl">
          {greeting}, {displayName}.
        </h1>
        <p className="mt-1 text-sm capitalize text-neutral-500">
          Hoje é {formatGreetingDate(now)}.
        </p>
      </header>

      {empty ? <VisaoEmptyState /> : <WidgetGrid widgetsEnabled={widgetsEnabled} />}
    </div>
  );
}
