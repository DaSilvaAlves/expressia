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
import { getGmailSummaryForBrief, type GmailBriefItem } from '@/lib/google/gmail';
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
  /**
   * Número de emails não lidos incluídos no brief (Story J-6). Seguro para log
   * — só contagem, NUNCA subject/remetente/snippet (constraint privacidade J-6).
   */
  readonly emailCount: number;
}

/** Row de `google_oauth_tokens` necessária ao refresh (sem o token em claro). */
interface GoogleOauthTokenRow {
  readonly encrypted_refresh_token: string;
  readonly token_iv: string;
  readonly token_auth_tag: string;
}

/** Row de `jarvis_memories` — só `content` é necessário ao brief (Story M-3). */
interface JarvisMemoryRow {
  readonly content: string;
}

/**
 * Resolve as memórias explícitas do household (guardadas via "lembra-te que…",
 * Story M-1) para injectar no prompt de síntese do brief (Story M-3, metade
 * "brief" da decisão D4). Query idêntica à de `buildMemoryContext`
 * (`run-agent.ts`, M-2), duplicada localmente por menor blast radius — mesma
 * disciplina de `resolveCalendarSection`/`resolveEmailSection`, que também não
 * importam helpers de leitura do módulo `agent/` (ver AUTO-DECISION na story).
 *
 * Cap 50, `ORDER BY created_at DESC` — sem retrieval semântico/keyword (D3
 * rejeita-o para o MVP). Lê via o `db` RLS-scoped (`withHousehold`), NUNCA
 * `getServiceDb()`, com filtro `household_id` explícito por defesa-em-profundidade.
 *
 * NUNCA lança — qualquer falha de leitura é não-fatal: devolve `[]` e o brief
 * prossegue sem memória nesse dia (degradação graciosa, mesmo contrato da agenda
 * e do email). Segue o padrão silencioso de `resolveCalendarSection` (sem logger
 * acessível neste ponto); o `content` das memórias é PII sensível (migration
 * 0034) e NUNCA seria logado ainda que houvesse logger (N1 herdado da M-2).
 */
async function resolveMemoriesSection(
  db: DbShim,
  householdId: string,
): Promise<readonly string[]> {
  try {
    const rows = await db.execute<JarvisMemoryRow>(sql`
      select content
      from public.jarvis_memories
      where household_id = ${householdId}::uuid
      order by created_at desc
      limit 50
    `);
    return rows.map((r) => r.content);
  } catch {
    // Falha inesperada na leitura — memória fica de fora, mas o brief continua.
    // Sem log de conteúdo (PII, N1); padrão silencioso de resolveCalendarSection.
    return [];
  }
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
 * Resolve a secção de email (emails não lidos do inbox) para `(household, user)`.
 * NUNCA lança — qualquer falha (token, refresh, API) é mapeada para
 * `{ emails: [], error }`, de modo a que o email jamais derrube o brief
 * (degradação graciosa, mesmo padrão da agenda — Story J-6 AC10).
 *
 * Lê a linha de `google_oauth_tokens` via o `db` RLS-scoped (`withHousehold`),
 * NUNCA via `getServiceDb()` (RLS obrigatória para dados de domínio — lição
 * SEC-8.1). Os campos cifrados são passados a `getGmailSummaryForBrief`, que
 * decifra inline e lê a Gmail API. Os emails são processados em memória e nunca
 * persistidos (constraint privacidade J-6).
 */
async function resolveEmailSection(
  db: DbShim,
  householdId: string,
  userId: string,
): Promise<{ emails: GmailBriefItem[]; error?: string }> {
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
      // Sem token OAuth (Gmail não ligado) → secção de email omitida, sem nota.
      return { emails: [] };
    }

    return await getGmailSummaryForBrief({
      encryptedRefreshToken: token.encrypted_refresh_token,
      tokenIv: token.token_iv,
      tokenAuthTag: token.token_auth_tag,
    });
  } catch (err) {
    // Falha inesperada na leitura da DB — o email fica indisponível, mas o
    // brief continua.
    return { emails: [], error: err instanceof Error ? err.message : 'erro desconhecido' };
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
  const [today, overdue, finances, accounts, calendar, email, memories] = await Promise.all([
    getTasksToday(db, householdId),
    getTasksOverdue(db, householdId),
    getFinancesMonth(db, householdId),
    getAccountsBalance(db, householdId),
    resolveCalendarSection(db, householdId, userId),
    resolveEmailSection(db, householdId, userId),
    resolveMemoriesSection(db, householdId),
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
    emailSummary: email.emails,
    memories,
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
    emailCount: email.emails.length,
  };
}
