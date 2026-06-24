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
 * NÃO inclui Google Calendar (agenda) — isso entra após J-3.
 *
 * Trace: Story J-4 AC4/AC5/AC6.
 */
import type { DbShim } from '@/lib/agent/db-shim';
import { synthesizeBriefText, type BriefData } from '@/lib/brief/synthesize';
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
}

/**
 * Constrói o texto do brief para um household. O `db` deve vir de
 * `withHousehold` (role `authenticated`, RLS viva).
 */
export async function buildBriefForHousehold(
  db: DbShim,
  householdId: string,
  traceId: string,
): Promise<BriefResult> {
  // Agregação em paralelo — todas as queries são read-only e household-scoped.
  const [today, overdue, finances, accounts] = await Promise.all([
    getTasksToday(db, householdId),
    getTasksOverdue(db, householdId),
    getFinancesMonth(db, householdId),
    getAccountsBalance(db, householdId),
  ]);

  const data: BriefData = {
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
  };
}
