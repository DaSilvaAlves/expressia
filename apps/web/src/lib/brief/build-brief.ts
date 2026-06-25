/**
 * Agregação do brief diário (Story J-4).
 *
 * Reúne os dados de tarefas + finanças de um household (reutilizando os
 * agregadores da Visão, sem os alterar) e produz o texto sintetizado.
 *
 * Recebe um `db` já dentro de `withHousehold` (RLS viva — lição SEC-8.1): o
 * caller (job Inngest) abre o `withHousehold({ userId, householdId })` e passa
 * o `tx` aqui. As queries da Visão filtram por `householdId` explícito E correm
 * sob RLS — defesa-em-profundidade.
 *
 * Inclui a agenda do Google Calendar de hoje (follow-up de J-3 — agenda no
 * brief). A agenda degrada graciosamente: nunca derruba o brief.
 *
 * Trace: Story J-4 AC4/AC5/AC6, Story J-3 AC7 (consumidor da agenda).
 */
import { sql } from 'drizzle-orm';

import type { DbShim } from '@/lib/agent/db-shim';
import {
  synthesizeBriefText,
  type BriefData,
  type CalendarSection,
} from '@/lib/brief/synthesize';
import { getCalendarEventsToday } from '@/lib/google/calendar';
import { refreshAccessToken } from '@/lib/google/oauth';
import {
  getAccountsBalance,
  getFinancesMonth,
  getTasksOverdue,
  getTasksToday,
} from '@/lib/visao/queries';

export interface BriefResult {
  readonly text: string;
  readonly usedFallback: boolean;
  /** Contagens agregadas — seguras para log (sem títulos nem valores). */
  readonly tasksTodayCount: number;
  readonly tasksOverdueCount: number;
  /**
   * Número de eventos de agenda lidos hoje, ou `null` quando a agenda não está
   * ligada (`not_connected`) ou ficou indisponível (`unavailable`). Seguro para
   * log — só contagem, NUNCA títulos ou localização (constraint J-3 AC9).
   */
  readonly calendarEventCount: number | null;
}

/** Row de `google_oauth_tokens` necessária ao refresh (sem o token em claro). */
interface GoogleOauthTokenRow {
  readonly encrypted_refresh_token: string;
  readonly token_iv: string;
  readonly token_auth_tag: string;
}

/**
 * Resolve a secção de agenda para `(household, user)`. NUNCA lança — toda a
 * falha é capturada e mapeada para um dos estados de `CalendarSection`, de modo
 * a que a agenda jamais derrube o brief (degradação graciosa).
 *
 *   - sem linha em `google_oauth_tokens`        → `not_connected` (sem nota).
 *   - linha presente + leitura OK                → `connected` (events pode []).
 *   - refresh lança OU leitura devolve `null`    → `unavailable` (nota discreta).
 *
 * Lê a linha via o `db` RLS-scoped (`withHousehold`), com `sql` parametrizado —
 * mesmo padrão das restantes queries do job.
 */
async function resolveCalendarSection(
  db: DbShim,
  householdId: string,
  userId: string,
): Promise<CalendarSection> {
  try {
    const rows = await db.execute<GoogleOauthTokenRow>(sql`
      select encrypted_refresh_token, token_iv, token_auth_tag
      from public.google_oauth_tokens
      where household_id = ${householdId}::uuid
        and user_id = ${userId}::uuid
      limit 1
    `);

    const token = rows[0];
    if (!token) {
      return { status: 'not_connected' };
    }

    // refreshAccessToken lança GoogleOAuthError em falha de decifração/refresh;
    // getCalendarEventsToday devolve null em qualquer falha de leitura.
    const { accessToken } = await refreshAccessToken(
      token.encrypted_refresh_token,
      token.token_iv,
      token.token_auth_tag,
    );

    const events = await getCalendarEventsToday(accessToken);
    if (events === null) {
      return { status: 'unavailable' };
    }

    return { status: 'connected', events };
  } catch {
    // Token presente mas refresh/leitura falharam (ou erro inesperado) — a
    // agenda fica indisponível, mas o brief continua.
    return { status: 'unavailable' };
  }
}

/**
 * Constrói o texto do brief para um household. O `db` deve vir de
 * `withHousehold` (role `authenticated`, RLS viva).
 */
export async function buildBriefForHousehold(
  db: DbShim,
  householdId: string,
  userId: string,
  traceId: string,
): Promise<BriefResult> {
  // Agregação em paralelo — todas as queries são read-only e household-scoped.
  // A agenda corre em paralelo e nunca lança (degradação graciosa interna).
  const [today, overdue, finances, accounts, calendar] = await Promise.all([
    getTasksToday(db, householdId),
    getTasksOverdue(db, householdId),
    getFinancesMonth(db, householdId),
    getAccountsBalance(db, householdId),
    resolveCalendarSection(db, householdId, userId),
  ]);

  const data: BriefData = {
    calendar,
    tasksTodayCount: today.count,
    tasksTodayTitles: today.tasks.map((t) => t.title),
    tasksOverdueCount: overdue.count,
    tasksOverdueTitles: overdue.tasks.map((t) => t.title),
    financeIncomeCents: finances.incomeTotal,
    financeExpenseCents: finances.expenseTotal,
    financeBalanceCents: finances.balance,
    accountsBalanceCents: accounts.totalBalanceCents,
  };

  const { text, usedFallback } = await synthesizeBriefText(data, {
    traceId,
    householdId,
  });

  return {
    text,
    usedFallback,
    tasksTodayCount: today.count,
    tasksOverdueCount: overdue.count,
    calendarEventCount: calendar.status === 'connected' ? calendar.events.length : null,
  };
}
