/**
 * AC9 (SEC-8 / ADR-003 Fase 4 Fatia D) — gate RLS REAL do caminho de escrita do
 * cérebro AI (`executeAtomic`). Teste-gémeo de `packages/tools/src/__tests__/
 * atomic.test.ts`, mas com a RLS GENUINAMENTE ACTIVA contra um Postgres real
 * (Testcontainers), provando a 2.ª rede.
 *
 * Monta o `txRunner` que `executeAtomic` recebe replicando EXACTAMENTE a mecânica
 * de produção do `withHousehold` (`packages/db/src/client.ts:119` / harness
 * `rls-harness.ts:asUser`): `begin()` → `SET LOCAL ROLE authenticated` →
 * `set_config('request.jwt.claims', …)` → cliente Drizzle scoped à transacção.
 * Sob esses claims as 104 policies activam.
 *
 * Prova (predicado real `is_household_member(household_id)` — correcção Fase 0 §12.7):
 *   - NEGATIVO (tabela de domínio `tasks`): uma tool a tentar escrever
 *     `household_id` do household B sob claims do A é REJEITADA pelo Postgres
 *     (`/row-level security|new row violates/i`) — não pelo filtro app. Rollback.
 *   - NEGATIVO (`agent_reverse_ops`): com `ctx.householdId` = B sob claims A, o
 *     INSERT de `agent_reverse_ops` (atomic.ts) é rejeitado por `WITH CHECK
 *     is_household_member(B)`. Rollback total (a task já inserida desfaz junto).
 *   - POSITIVO (não-regressão): a mesma operação no household A (claims A) SUCEDE
 *     e persiste `tasks` + `agent_reverse_ops`.
 *
 * Não-tautológico: os IDs do household B são semeados via admin (bypass RLS) e a
 * rejeição prova-se sob a sessão `authenticated`. Se a RLS estivesse inerte (como
 * `getDb()`/`rolbypassrls` em runtime ANTES do SEC-8), os casos negativos
 * SUCEDERIAM e o teste falharia nas asserções de 0 rows. Réplica do rigor de
 * `rls-application.test.ts` (SEC-2/3/5/7).
 *
 * Trace: SEC-8 AC9; ADR-003 §12.8; db-specialist-review-sec8-fase0-20260609.md.
 */
import { randomUUID } from 'node:crypto';

import { sql as dsql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { afterAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';

// Observability mockada (igual a atomic.test.ts) — evita requirimento de SDK OTel
// registado no ambiente node do db-test. NÃO afecta a mecânica RLS sob teste.
vi.mock('@meu-jarvis/observability', () => ({
  withSpan: vi.fn(
    async (_name: string, _attrs: unknown, fn: (span: unknown) => unknown) =>
      fn({
        setAttribute: vi.fn(),
        setAttributes: vi.fn(),
        end: vi.fn(),
        recordException: vi.fn(),
        setStatus: vi.fn(),
      }),
  ),
  hashForCorrelation: vi.fn((s: string) => `hash_${String(s).slice(0, 8)}`),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  executeAtomic,
  ToolExecutionError,
  type AtomicOutcome,
  type DrizzleDbClient,
  type ReverseOpPayload,
  type ToolDefinition,
  type ToolExecutionContext,
  type TxRunner,
} from '@meu-jarvis/tools';

import { admin, insertAgentRun } from '@/helpers/fixtures';
import {
  closeRlsHarness,
  getRlsHarness,
  resetData,
  seedTwoHouseholds,
} from '@/rls-harness';

afterAll(async () => {
  await closeRlsHarness();
});

// ─────────────────────────────────────────────────────────────────────────────
// txRunner que replica a mecânica de produção do `withHousehold`
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Constrói um `TxRunner` que abre a transacção como role `authenticated` +
 * claims JWT (`sub`/`household_id`/`role`) — mesma semântica de `withHousehold`
 * (client.ts:119: `SET LOCAL ROLE authenticated` + `set_config(request.jwt.claims)`)
 * e de `asUser` (rls-harness.ts:322). Sob esta sessão as policies activam.
 *
 * O cliente Drizzle é construído sobre o `adminSql` base (que expõe `.options`)
 * e a transacção é aberta via `db.transaction()` do próprio Drizzle; o role e os
 * claims são definidos DENTRO da tx via `SET LOCAL` (scoped à transacção). O
 * `tx` que `fn` recebe é o mesmo cliente que `executeAtomic` usa para
 * `tx.execute(sql\`…\`)` — RLS genuinamente activa.
 */
function withHouseholdTxRunner(userId: string, householdId: string): TxRunner {
  const { adminSql } = getRlsHarness();
  const db = drizzle(adminSql);
  const claims = JSON.stringify({
    sub: userId,
    household_id: householdId,
    role: 'authenticated',
  });

  return (<T,>(fn: (tx: DrizzleDbClient) => Promise<T>): Promise<T> =>
    db.transaction(async (tx) => {
      await tx.execute(dsql`set local role authenticated`);
      await tx.execute(dsql`select set_config('request.jwt.claims', ${claims}, true)`);
      await tx.execute(dsql`select set_config('app.current_household_id', ${householdId}, true)`);
      return fn(tx as unknown as DrizzleDbClient);
    }) as Promise<T>) as TxRunner;
}

/**
 * `ctx.db` placeholder — com `txRunner` injectado, `executeAtomic` NUNCA o usa
 * para abrir a tx (o loop usa o `tx` do runner). Falha ruidosamente se tocado.
 */
const CTX_DB_PLACEHOLDER: DrizzleDbClient = {
  transaction() {
    throw new Error('AC9: ctx.db não deve ser usado em modo txRunner');
  },
  insert() {
    throw new Error('AC9: ctx.db.insert não deve ser usado em modo txRunner');
  },
  execute() {
    throw new Error('AC9: ctx.db.execute não deve ser usado em modo txRunner');
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Tool inline mínima — INSERT real em public.tasks via SQL puro no tx do runner
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tool de teste que insere uma row em `public.tasks` com um `household_id`
 * configurável (o vector de ataque cross-household). Satisfaz o mesmo contrato
 * `ToolDefinition` das tools reais; o `reverse` declara o `delete_row`.
 */
function makeInsertTaskTool(
  targetHouseholdId: string,
  createdByUserId: string,
): { tool: ToolDefinition<{ title: string }, { taskId: string }>; taskId: string } {
  const taskId = randomUUID();
  const tool: ToolDefinition<{ title: string }, { taskId: string }> = {
    name: 'ac9_insert_task',
    domain: 'tasks',
    description: 'AC9 — insere uma task (household configurável) para exercitar a RLS real',
    inputSchema: z.object({ title: z.string().min(1) }),
    outputSchema: z.object({ taskId: z.string().uuid() }),
    preview: () => 'AC9 insert task',
    execute: async (input, ctx) => {
      // `ctx.db` aqui é o `tx` que o txRunner forneceu (role authenticated).
      await ctx.db.execute(dsql`
        insert into public.tasks (id, household_id, created_by_user_id, title)
        values (${taskId}, ${targetHouseholdId}, ${createdByUserId}, ${input.title})
      `);
      return { taskId };
    },
    reverse: async (output): Promise<ReverseOpPayload> => ({
      kind: 'delete_row',
      table: 'tasks',
      id: output.taskId,
    }),
  };
  return { tool, taskId };
}

function rlsRejected(outcome: AtomicOutcome): boolean {
  if (outcome.success) return false;
  const err = outcome.error;
  const cause = err instanceof ToolExecutionError ? err.cause : err;
  const msg = cause instanceof Error ? cause.message : String(cause);
  return /row-level security|violates row-level|new row violates/i.test(msg);
}

async function countTasks(): Promise<number> {
  const rows = await admin()<{ n: number }[]>`select count(*)::int as n from public.tasks`;
  return rows[0]?.n ?? -1;
}

async function countReverseOps(): Promise<number> {
  const rows = await admin()<
    { n: number }[]
  >`select count(*)::int as n from public.agent_reverse_ops`;
  return rows[0]?.n ?? -1;
}

// ─────────────────────────────────────────────────────────────────────────────
// Testes
// ─────────────────────────────────────────────────────────────────────────────

describe('AC9 — executeAtomic RLS-enforced (2.ª rede) cross-household', () => {
  beforeEach(async () => {
    await resetData();
  });

  test('POSITIVO: escrita no próprio household (claims A) sucede + persiste tasks e agent_reverse_ops', async () => {
    const { householdA, userA } = await seedTwoHouseholds();
    const runId = await insertAgentRun(admin(), householdA.id, userA.id);

    const { tool } = makeInsertTaskTool(householdA.id, userA.id);
    const ctx: ToolExecutionContext = {
      householdId: householdA.id,
      userId: userA.id,
      db: CTX_DB_PLACEHOLDER,
      traceId: 'ac9-pos',
      runId,
    };

    const outcome = await executeAtomic(
      [{ definition: tool, input: { title: 'Tarefa AC9 válida' } }],
      ctx,
      withHouseholdTxRunner(userA.id, householdA.id),
    );

    expect(outcome.success).toBe(true);
    if (outcome.success) {
      expect(outcome.results).toHaveLength(1);
      expect(outcome.results[0]?.reverseOpId).toMatch(/^[0-9a-f-]{36}$/);
    }
    // Persistência genuína (commit) — admin (bypass RLS) confirma ambas as tabelas.
    expect(await countTasks()).toBe(1);
    expect(await countReverseOps()).toBe(1);
  });

  test('NEGATIVO (tasks): tool a escrever household B sob claims A é REJEITADA pelo Postgres (rollback)', async () => {
    const { householdA, householdB, userA } = await seedTwoHouseholds();
    const runId = await insertAgentRun(admin(), householdA.id, userA.id);

    // Vector de ataque: a tool tenta escrever tasks com household_id = B,
    // mas a sessão está scoped ao A. App-enforced usaria ctx.householdId; aqui
    // provamos que o POSTGRES bloqueia mesmo que a tool injecte B directamente.
    const { tool } = makeInsertTaskTool(householdB.id, userA.id);
    const ctx: ToolExecutionContext = {
      householdId: householdA.id,
      userId: userA.id,
      db: CTX_DB_PLACEHOLDER,
      traceId: 'ac9-neg-tasks',
      runId,
    };

    const outcome = await executeAtomic(
      [{ definition: tool, input: { title: 'Tarefa cross-household' } }],
      ctx,
      withHouseholdTxRunner(userA.id, householdA.id),
    );

    expect(outcome.success).toBe(false);
    // A rejeição vem do Postgres (RLS), não do filtro app.
    expect(rlsRejected(outcome)).toBe(true);
    // Rollback total: nada persistiu (se a RLS estivesse inerte, seria 1 → falha).
    expect(await countTasks()).toBe(0);
    expect(await countReverseOps()).toBe(0);
  });

  test('NEGATIVO (agent_reverse_ops): INSERT do reverse_op com household B sob claims A é REJEITADO (rollback total)', async () => {
    const { householdA, householdB, userA } = await seedTwoHouseholds();
    const runId = await insertAgentRun(admin(), householdA.id, userA.id);

    // A tool insere tasks(A) — passa sob claims A. Mas ctx.householdId = B, logo
    // executeAtomic insere agent_reverse_ops com household_id = B →
    // WITH CHECK is_household_member(B) sob claims A → REJEITADO pelo Postgres.
    const { tool } = makeInsertTaskTool(householdA.id, userA.id);
    const ctx: ToolExecutionContext = {
      householdId: householdB.id, // mismatch deliberado — alvo do reverse_op
      userId: userA.id,
      db: CTX_DB_PLACEHOLDER,
      traceId: 'ac9-neg-reverseop',
      runId,
    };

    const outcome = await executeAtomic(
      [{ definition: tool, input: { title: 'Tarefa A, reverse_op B' } }],
      ctx,
      withHouseholdTxRunner(userA.id, householdA.id),
    );

    expect(outcome.success).toBe(false);
    expect(rlsRejected(outcome)).toBe(true);
    // Rollback total: a task (A) inserida antes do reverse_op desfaz junto.
    expect(await countTasks()).toBe(0);
    expect(await countReverseOps()).toBe(0);
  });

  test('CONTRA-PROVA (não-tautológico): admin (bypass RLS) consegue inserir tasks(B) — a tabela aceita a row; só a RLS sob authenticated bloqueia', async () => {
    const { householdB, userB } = await seedTwoHouseholds();
    // O mesmo INSERT que foi rejeitado sob authenticated A SUCEDE via admin —
    // prova que a rejeição dos casos negativos é RLS, não constraint/FK.
    const taskId = randomUUID();
    await admin()`
      insert into public.tasks (id, household_id, created_by_user_id, title)
      values (${taskId}, ${householdB.id}, ${userB.id}, 'AC9 admin bypass')
    `;
    expect(await countTasks()).toBe(1);
  });
});
