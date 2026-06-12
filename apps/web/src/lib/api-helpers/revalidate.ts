/**
 * Helper de revalidação de cache para mutações de tarefas (W2 — make-it-work).
 *
 * PROBLEMA (Next 15.5): qualquer mutação de tarefa (criar/editar/concluir/mover/
 * eliminar) passa por um Route Handler `/api/tasks/**` chamado via `fetch` do
 * cliente; o componente faz `router.refresh()` a seguir. Mas `router.refresh()`
 * só re-busca o RSC payload do *segmento da rota actual* (`/tarefas`) — nunca
 * invalida a entrada de `/visao` no Router Cache do cliente. Resultado: os
 * widgets da Visão (Tarefas Hoje, Em Atraso, Calendário da semana, etc.) ficam
 * stale até um refresh manual.
 *
 * SOLUÇÃO: invalidar no servidor, com `revalidatePath`, todas as vistas que
 * derivam do estado das tarefas. Combinado com `export const dynamic =
 * 'force-dynamic'` em `/visao` (que desliga o prefetch de dados dinâmicos para
 * essa rota), a próxima navegação para a Visão re-executa o RSC com dados
 * frescos em todos os caminhos (Lista, Kanban, Calendário e chat/Cérebro AI).
 *
 * Centralizado num único sítio para manter os paths em sincronia entre os 4
 * handlers de mutação (`POST /api/tasks`, `PATCH|DELETE /api/tasks/[id]`,
 * `PATCH /api/tasks/[id]/move`) e o caminho de mutação do Cérebro AI.
 */
import { revalidatePath } from 'next/cache';

/**
 * Vistas que dependem do estado das tarefas e têm de ser revalidadas após
 * qualquer mutação. A Visão é a principal afectada (widgets agregados); as três
 * vistas de `/tarefas` mantêm-se aqui por completude (defense-in-depth — uma
 * mutação no Kanban reflecte-se na Lista e no Calendário e vice-versa).
 */
const TASK_DEPENDENT_PATHS = [
  '/visao',
  '/tarefas',
  '/tarefas/kanban',
  '/tarefas/calendario',
] as const;

/**
 * Revalida (server-side) todas as vistas que derivam do estado das tarefas.
 *
 * Best-effort: nunca deve fazer falhar a mutação principal. Se a revalidação
 * lançar (p. ex. fora de um contexto de request), engole-se o erro — a mutação
 * já foi persistida com sucesso e a pior consequência é um refresh manual.
 */
export function revalidateTaskViews(): void {
  for (const path of TASK_DEPENDENT_PATHS) {
    try {
      revalidatePath(path);
    } catch {
      // Best-effort — a mutação principal já foi persistida.
    }
  }
}

/**
 * Vistas que dependem do estado financeiro (transacções/contas) e têm de ser
 * revalidadas após mutações de finanças. A Visão (widgets `financas-mes` e
 * `saldo-contas`) e o Património (saldo on-read — W1) são as principais; as
 * restantes vistas de `/financas` mantêm-se por completude (uma transacção de
 * cartão reflecte-se no extracto, etc.).
 */
const FINANCE_DEPENDENT_PATHS = [
  '/visao',
  '/financas/este-mes',
  '/financas/variaveis',
  '/financas/patrimonio',
  '/financas/cartoes',
  '/financas/recorrentes',
] as const;

/**
 * Revalida (server-side) todas as vistas que derivam do estado financeiro.
 *
 * Mesmo contrato de `revalidateTaskViews`: best-effort, nunca faz falhar a
 * mutação principal.
 */
export function revalidateFinanceViews(): void {
  for (const path of FINANCE_DEPENDENT_PATHS) {
    try {
      revalidatePath(path);
    } catch {
      // Best-effort — a mutação principal já foi persistida.
    }
  }
}
