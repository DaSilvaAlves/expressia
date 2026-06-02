/**
 * POST /api/agent/prompt/[runId]/undo — Undo endpoint (FR6 D21).
 *
 * Story 2.6 AC7 — utilizador reverte uma run em `status='success'` dentro
 * da janela 30s. Lê `agent_reverse_ops` rows com `expires_at > now() AND
 * executed_at IS NULL` (PO_FIX — coluna real é `executed_at`, não
 * `reverted_at`; ver db-schema.md §4.4 invariantes).
 *
 * Aplica transacção inversa interpretando `reverse_op` JSONB:
 *   - `delete_row` → DELETE com WHERE id
 *   - `restore_row` → UPDATE com snapshot
 *   - `composite` → ops aninhadas
 *
 * Marca `agent_reverse_ops.executed_at = now()` (row-level marca op aplicada)
 * + `agent_runs.status = 'reverted'` + `agent_runs.reverted_at = now()`
 * (run-level) via `getServiceDb()` (NFR9 — única excepção justificada,
 * análoga a GDPR purge — trigger imutabilidade bloqueia mutação terminal
 * em authenticated).
 *
 * Segurança (SEC-1-F3): pertença do utilizador autenticado ao
 * `run.household_id` verificada app-enforced (RLS inerte em runtime —
 * `getDb()` liga como role bypassrls). Cross-household → 404.
 *
 * Erros:
 *   - 401 AUTH_REQUIRED
 *   - 404 RUN_NOT_FOUND (cross-household ou inexistente — 404 não revela existência)
 *   - 409 UNDO_INVALID_STATE (run não está em success)
 *   - 409 UNDO_EXPIRED (TTL passou)
 *   - 409 UNDO_ALREADY_REVERTED (run já em reverted ou ops já executadas)
 *
 * Trace: Story 2.6 AC7 + D21, FR6, db-schema.md §4.4 invariantes.
 */
import { sql } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';

import { createServerSupabaseClient } from '@meu-jarvis/auth/server';
import { getDb, getServiceDb } from '@/lib/agent/db-shim';
import { resolveHouseholdId } from '@/lib/api-helpers/auth';
import {
  childLogger,
  captureException,
} from '@meu-jarvis/observability';

import { apiError } from '@/lib/errors';
import { sentrySafeContext } from '@/lib/agent/redaction';
import {
  withAgentPromptSpan,
  annotateAgentPromptSpan,
} from '@/lib/agent/tracing';

const ROUTE_TEMPLATE = '/api/agent/prompt/[runId]/undo';

interface AgentRunRow extends Record<string, unknown> {
  readonly id: string;
  readonly household_id: string;
  readonly status: string;
}

interface ReverseOpRow extends Record<string, unknown> {
  readonly id: string;
  readonly reverse_op: unknown;
  readonly expires_at: string;
  readonly executed_at: string | null;
}

/**
 * Reverse op tipos suportados — espelho de `@meu-jarvis/tools` `ReverseOpKind`
 * (Story 2.3). Mantemos cópia minimal local porque a interpretação é simples
 * e evita dep extra.
 */
type ReverseOp =
  | { readonly kind: 'delete_row'; readonly table: string; readonly id: string }
  | { readonly kind: 'restore_row'; readonly table: string; readonly id: string; readonly snapshot: Record<string, unknown> }
  | { readonly kind: 'composite'; readonly ops: ReadonlyArray<ReverseOp> };

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ runId: string }> },
): Promise<NextResponse> {
  const { runId } = await ctx.params;

  return withAgentPromptSpan(
    'POST /api/agent/prompt/[runId]/undo',
    { method: 'POST', route: ROUTE_TEMPLATE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE_TEMPLATE, run_id: runId });

      // Auth
      const supabase = await createServerSupabaseClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        annotateAgentPromptSpan(span, { status_code: 401 });
        return apiError('AUTH_REQUIRED', 'Sessão inválida.', 401);
      }

      // SEC-1-F3: resolver o household do utilizador autenticado para isolar a
      // run por household app-enforced (RLS inerte em runtime). Sem household
      // activo → 404 (não revela se o run existe noutro household).
      const userHouseholdId = await resolveHouseholdId(user.id);
      if (!userHouseholdId) {
        annotateAgentPromptSpan(span, { status_code: 404 });
        return apiError('RUN_NOT_FOUND', 'Run não encontrado.', 404, { run_id: runId });
      }

      const db = getDb();

      // Lookup run — filtro household_id app-enforced (SEC-1-F3): só o household
      // dono do run o encontra; cross-household → 404. Sem este filtro, um membro
      // do household B reverteria mutações reais do household A via service_role.
      const runRows = await db.execute<AgentRunRow>(sql`
        select id, household_id, status
        from agent_runs
        where id = ${runId}::uuid
          and household_id = ${userHouseholdId}::uuid
        limit 1
      `);

      if (runRows.length === 0) {
        annotateAgentPromptSpan(span, { status_code: 404 });
        return apiError('RUN_NOT_FOUND', 'Run não encontrado.', 404, { run_id: runId });
      }

      const run = runRows[0]!;
      annotateAgentPromptSpan(span, { household_id: run.household_id });

      // Validar estado terminal `success` (não pode ser revertido se já reverted/failed)
      if (run.status === 'reverted') {
        annotateAgentPromptSpan(span, { status_code: 409 });
        return apiError('UNDO_ALREADY_REVERTED', 'Run já foi revertido anteriormente.', 409, {
          run_id: runId,
        });
      }
      if (run.status !== 'success') {
        annotateAgentPromptSpan(span, { status_code: 409 });
        return apiError(
          'UNDO_INVALID_STATE',
          `Apenas runs em sucesso podem ser revertidas (estado actual: ${run.status}).`,
          409,
          { run_id: runId, status: run.status },
        );
      }

      // Lookup reverse_ops com TTL activo + não-executadas
      const opRows = await db.execute<ReverseOpRow>(sql`
        select id, reverse_op, expires_at, executed_at
        from agent_reverse_ops
        where agent_run_id = ${runId}::uuid
          and household_id = ${run.household_id}::uuid
          and expires_at > now()
          and executed_at is null
      `);

      if (opRows.length === 0) {
        // Verificar se já foram executadas (vs expiradas)
        const allOps = await db.execute<{ executed_at: string | null }>(sql`
          select executed_at
          from agent_reverse_ops
          where agent_run_id = ${runId}::uuid
            and household_id = ${run.household_id}::uuid
        `);
        const hasExecuted = allOps.some((o) => o.executed_at !== null);
        if (hasExecuted) {
          annotateAgentPromptSpan(span, { status_code: 409 });
          return apiError('UNDO_ALREADY_REVERTED', 'Operações já foram revertidas.', 409, {
            run_id: runId,
          });
        }
        annotateAgentPromptSpan(span, { status_code: 409 });
        return apiError(
          'UNDO_EXPIRED',
          'Janela de undo expirou (30 segundos). A operação não pode mais ser revertida.',
          409,
          { run_id: runId },
        );
      }

      // Aplicar reverse ops via getServiceDb() (NFR9 análoga GDPR purge):
      // trigger imutabilidade bloqueia mutação de terminal `success` para
      // role authenticated; service_role bypassa.
      const serviceDb = getServiceDb();
      try {
        for (const op of opRows) {
          const parsed = op.reverse_op as ReverseOp;
          await applyReverseOp(parsed, serviceDb);
          await serviceDb.execute(sql`
            update agent_reverse_ops
            set executed_at = now()
            where id = ${op.id}::uuid
          `);
        }

        // Marcar run como reverted (terminal mutation via service_role)
        await serviceDb.execute(sql`
          update agent_runs
          set status = 'reverted',
              reverted_at = now()
          where id = ${runId}::uuid
        `);
      } catch (err) {
        log.error({ err }, 'Falha a aplicar reverse op');
        captureException(err instanceof Error ? err : new Error(String(err)), {
          ...sentrySafeContext({ route: ROUTE_TEMPLATE, householdId: run.household_id, runId }),
        });
        annotateAgentPromptSpan(span, { status_code: 500 });
        return apiError(
          'INTERNAL_ERROR',
          'Falha ao reverter operações. As operações originais permanecem.',
          500,
          { run_id: runId },
        );
      }

      // Story 2.8 AC5 — audit_log INSERT (não-fatal se falhar).
      //
      // [DEV-DECISION] PO_FIX_INLINE 1: `getDb()` (authenticated) é correcto
      // per RLS real (policy `audit_log_insert_member` em
      // `packages/db/migrations/0001_rls_policies.sql:569-573` PERMITE INSERT
      // a authenticated members; apenas UPDATE/DELETE são revogados :576-584).
      // Esta implementação usa `serviceDb` (já em scope) defensivamente para
      // consistência com as restantes ops da função (UPDATE agent_runs +
      // UPDATE agent_reverse_ops via serviceDb). Diferença é conceitual, não
      // comportamental — ambos atingem o mesmo INSERT. @architect ratifica
      // no gate (CONCERNS-ACCEPTABLE — handoff po→dev concern 2).
      try {
        const traceId = span.spanContext().traceId ?? null;
        await serviceDb.execute(sql`
          insert into audit_log (household_id, user_id, action, entity_table, entity_id, before_state, after_state, trace_id)
          values (
            ${run.household_id}::uuid,
            ${user.id}::uuid,
            'agent_run_reverted',
            'agent_runs',
            ${runId}::uuid,
            ${JSON.stringify({ status: 'success', ops_count: opRows.length })}::jsonb,
            ${JSON.stringify({ status: 'reverted', reverted_at: new Date().toISOString() })}::jsonb,
            ${traceId}
          )
        `);
      } catch (auditErr) {
        // Não-fatal: o undo já ocorreu com sucesso, mas registamos warn + Sentry.
        log.warn({ err: auditErr }, 'audit_log insert falhou (não-fatal)');
        captureException(
          auditErr instanceof Error ? auditErr : new Error(String(auditErr)),
          { ...sentrySafeContext({ route: ROUTE_TEMPLATE, householdId: run.household_id, runId }) },
        );
      }

      annotateAgentPromptSpan(span, { status_code: 200 });
      log.info({ run_id: runId, ops_reverted: opRows.length }, 'Run revertido com sucesso');

      return NextResponse.json({
        reverted: true,
        run_id: runId,
        ops_count: opRows.length,
      });
    },
  );
}

/**
 * Aplica um `ReverseOp` ao DB (service_role para bypass RLS).
 *
 * Tipos suportados:
 *   - `delete_row` → DELETE FROM table WHERE id
 *   - `restore_row` → UPDATE table SET ... WHERE id (snapshot full)
 *   - `composite` → recursivamente cada op
 *
 * Tabelas alvo são whitelisted para evitar SQL injection via `table` field.
 *
 * Story 4.10 — Task T11: whitelist actualizada com `cards` (criado por
 * `create_card` tool) e `_noop` (sentinela inerte para read-only — pattern
 * Story 3.8 R1b reusado pelas tools `listar_tarefas`/`listar_atrasadas`/
 * `query_finance_summary`). Removidos `card_accounts`/`card_transactions` —
 * tabelas que NÃO existem no schema real (`packages/db/src/schema/finance.ts`
 * tem apenas `cards`).
 */
const ALLOWED_REVERSE_TABLES = new Set([
  'tasks',
  'transactions',
  'recurrences',
  'cards',
  'installments',
]);

/**
 * Tabela sentinela inerte (Story 3.8 R1b v1.1 + Story 4.10 D-4.10.3).
 *
 * Tools read-only persistem uma row em `agent_reverse_ops` com
 * `reverse_op.table = '_noop'` para satisfazer `ReverseOpDeleteRowSchema` sem
 * permitir undo real. Aqui no endpoint, simplesmente saltamos a aplicação
 * (sem erro nem efeito — `executed_at` ainda é marcado para impedir replay).
 */
const NOOP_SENTINEL_TABLE = '_noop';

async function applyReverseOp(
  op: ReverseOp,
  db: ReturnType<typeof getServiceDb>,
): Promise<void> {
  if (op.kind === 'composite') {
    for (const sub of op.ops) {
      await applyReverseOp(sub, db);
    }
    return;
  }

  // Sentinela `_noop` — read-only tools (Story 3.8 R1b / Story 4.10 D-4.10.3).
  // No-op silencioso: a row continua marcada `executed_at = now()` pelo caller
  // (linha 170-174) para impedir replay.
  if (op.table === NOOP_SENTINEL_TABLE) {
    return;
  }

  if (!ALLOWED_REVERSE_TABLES.has(op.table)) {
    throw new Error(`Tabela "${op.table}" não permitida em reverse op (whitelist).`);
  }

  if (op.kind === 'delete_row') {
    // sql.identifier não está exposto pelo Drizzle de forma estável — usar
    // raw template com whitelist para safety.
    await db.execute(sql.raw(`delete from ${op.table} where id = '${op.id}'`));
    return;
  }

  if (op.kind === 'restore_row') {
    // Restaurar snapshot completo — assemble UPDATE dinâmico com keys do snapshot.
    const snapshot = op.snapshot ?? {};
    const keys = Object.keys(snapshot).filter((k) => k !== 'id');
    if (keys.length === 0) {
      return; // nada a restaurar (defensive)
    }
    const setClauses = keys
      .map((k) => {
        const value = snapshot[k];
        if (value === null) {
          return `${k} = NULL`;
        }
        if (typeof value === 'number' || typeof value === 'boolean') {
          return `${k} = ${value}`;
        }
        // Strings — escape simples (snapshot vem do executeAtomic da Story 2.3
        // que valida tipos).
        const safe = String(value).replace(/'/g, "''");
        return `${k} = '${safe}'`;
      })
      .join(', ');
    await db.execute(sql.raw(`update ${op.table} set ${setClauses} where id = '${op.id}'`));
    return;
  }

  // Defensive: never-reached
  throw new Error(`Reverse op kind desconhecido.`);
}
