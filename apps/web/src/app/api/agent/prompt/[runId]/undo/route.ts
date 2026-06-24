/**
 * POST /api/agent/prompt/[runId]/undo — Undo endpoint (FR6 D21).
 *
 * Story 2.6 AC7 — utilizador reverte uma run em `status='success'` dentro
 * da janela 30s. Lê `agent_reverse_ops` rows com `expires_at > now() AND
 * executed_at IS NULL` (PO_FIX — coluna real é `executed_at`, não
 * `reverted_at`; ver db-schema.md §4.4 invariantes).
 *
 * Story J-2 (AC9): a lógica de undo é extraída para a função exportada
 * `executeUndo({ runId, householdId, userId })`, chamável directamente sem HTTP
 * (o webhook do Telegram chama-a no callback `undo:{runId}`). Este route handler
 * passa a ser um wrapper fino: resolve auth + household e delega em `executeUndo`.
 *
 * Aplica transacção inversa interpretando `reverse_op` JSONB:
 *   - `delete_row` → DELETE com WHERE id
 *   - `restore_row` → UPDATE com snapshot
 *   - `reinsert_row` → INSERT (undo de hard delete)
 *   - `composite` → ops aninhadas
 *
 * Marca `agent_reverse_ops.executed_at = now()` + `agent_runs.status = 'reverted'`
 * + `agent_runs.reverted_at = now()` via `getServiceDb()` (NFR9 — única excepção
 * justificada; trigger imutabilidade bloqueia mutação terminal em authenticated).
 *
 * Segurança (SEC-1-F3): pertença do utilizador ao `run.household_id` verificada
 * app-enforced (RLS inerte em runtime — `getDb()` liga como role bypassrls).
 * Cross-household → 404.
 *
 * Trace: Story 2.6 AC7 + D21 + Story J-2 AC9, FR6, db-schema.md §4.4 invariantes.
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
import { revalidateTaskViews } from '@/lib/api-helpers/revalidate';
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
  | { readonly kind: 'reinsert_row'; readonly table: string; readonly id: string; readonly snapshot: Record<string, unknown> }
  | { readonly kind: 'composite'; readonly ops: ReadonlyArray<ReverseOp> };

/**
 * Resultado discriminado de `executeUndo` — distingue o estado para o caller
 * (route handler → HTTP status; webhook Telegram → mensagem PT-PT). `ok: true`
 * só quando o undo aplicou efectivamente as reverse ops.
 */
export type UndoResult =
  | { ok: true; runId: string; opsCount: number; message: string }
  | {
      ok: false;
      runId: string;
      reason:
        | 'not_found'
        | 'already_reverted'
        | 'invalid_state'
        | 'expired'
        | 'internal_error';
      message: string;
    };

/**
 * Executa o undo de uma run — chamável directamente (sem HTTP).
 *
 * Story J-2 AC9 — usada pelo route handler abaixo E pelo webhook do Telegram
 * (callback `undo:{runId}`), sem duplicar lógica nem fazer `fetch` HTTP interno.
 *
 * A pertença ao household é verificada pelo caller (resolve `householdId` do
 * utilizador autenticado/`telegram_link`) e re-confirmada aqui no filtro
 * `household_id` da query (SEC-1-F3: cross-household → `not_found`).
 */
export async function executeUndo(params: {
  runId: string;
  householdId: string;
  userId: string;
}): Promise<UndoResult> {
  const { runId, householdId, userId } = params;
  const log = childLogger({ route: ROUTE_TEMPLATE, run_id: runId });

  const db = getDb();

  // Lookup run — filtro household_id app-enforced (SEC-1-F3): só o household
  // dono do run o encontra; cross-household → not_found.
  const runRows = await db.execute<AgentRunRow>(sql`
    select id, household_id, status
    from agent_runs
    where id = ${runId}::uuid
      and household_id = ${householdId}::uuid
    limit 1
  `);

  if (runRows.length === 0) {
    return { ok: false, runId, reason: 'not_found', message: 'Run não encontrado.' };
  }

  const run = runRows[0]!;

  // Validar estado terminal `success`.
  if (run.status === 'reverted') {
    return {
      ok: false,
      runId,
      reason: 'already_reverted',
      message: 'Esta acção já foi revertida anteriormente.',
    };
  }
  if (run.status !== 'success') {
    return {
      ok: false,
      runId,
      reason: 'invalid_state',
      message: `Apenas acções concluídas com sucesso podem ser revertidas (estado actual: ${run.status}).`,
    };
  }

  // Lookup reverse_ops com TTL activo + não-executadas.
  const opRows = await db.execute<ReverseOpRow>(sql`
    select id, reverse_op, expires_at, executed_at
    from agent_reverse_ops
    where agent_run_id = ${runId}::uuid
      and household_id = ${run.household_id}::uuid
      and expires_at > now()
      and executed_at is null
  `);

  if (opRows.length === 0) {
    // Verificar se já foram executadas (vs expiradas).
    const allOps = await db.execute<{ executed_at: string | null }>(sql`
      select executed_at
      from agent_reverse_ops
      where agent_run_id = ${runId}::uuid
        and household_id = ${run.household_id}::uuid
    `);
    const hasExecuted = allOps.some((o) => o.executed_at !== null);
    if (hasExecuted) {
      return {
        ok: false,
        runId,
        reason: 'already_reverted',
        message: 'Esta acção já foi revertida.',
      };
    }
    return {
      ok: false,
      runId,
      reason: 'expired',
      message: 'Cancelar já não é possível (expirou).',
    };
  }

  // Aplicar reverse ops via getServiceDb() (NFR9 análoga GDPR purge): trigger
  // imutabilidade bloqueia mutação de terminal `success` para role authenticated;
  // service_role bypassa.
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

    // Marcar run como reverted (terminal mutation via service_role).
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
    return {
      ok: false,
      runId,
      reason: 'internal_error',
      message: 'Falha ao reverter operações. As operações originais permanecem.',
    };
  }

  // Story 2.8 AC5 — audit_log INSERT (não-fatal se falhar). Usa serviceDb (já em
  // scope) por consistência com as restantes ops da função.
  try {
    await serviceDb.execute(sql`
      insert into audit_log (household_id, user_id, action, entity_table, entity_id, before_state, after_state, trace_id)
      values (
        ${run.household_id}::uuid,
        ${userId}::uuid,
        'agent_run_reverted',
        'agent_runs',
        ${runId}::uuid,
        ${JSON.stringify({ status: 'success', ops_count: opRows.length })}::jsonb,
        ${JSON.stringify({ status: 'reverted', reverted_at: new Date().toISOString() })}::jsonb,
        ${null}
      )
    `);
  } catch (auditErr) {
    log.warn({ err: auditErr }, 'audit_log insert falhou (não-fatal)');
    captureException(
      auditErr instanceof Error ? auditErr : new Error(String(auditErr)),
      { ...sentrySafeContext({ route: ROUTE_TEMPLATE, householdId: run.household_id, runId }) },
    );
  }

  // W2: o undo reverte mutações (tarefas/finanças) — invalida as vistas.
  revalidateTaskViews();

  log.info({ run_id: runId, ops_reverted: opRows.length }, 'Run revertido com sucesso');

  return {
    ok: true,
    runId,
    opsCount: opRows.length,
    message: 'Operação revertida.',
  };
}

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ runId: string }> },
): Promise<NextResponse> {
  const { runId } = await ctx.params;

  return withAgentPromptSpan(
    'POST /api/agent/prompt/[runId]/undo',
    { method: 'POST', route: ROUTE_TEMPLATE },
    async (span): Promise<NextResponse> => {
      // Auth
      const supabase = await createServerSupabaseClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        annotateAgentPromptSpan(span, { status_code: 401 });
        return apiError('AUTH_REQUIRED', 'Sessão inválida.', 401);
      }

      // SEC-1-F3: resolver o household do utilizador autenticado.
      const userHouseholdId = await resolveHouseholdId(user.id);
      if (!userHouseholdId) {
        annotateAgentPromptSpan(span, { status_code: 404 });
        return apiError('RUN_NOT_FOUND', 'Run não encontrado.', 404, { run_id: runId });
      }

      const result = await executeUndo({
        runId,
        householdId: userHouseholdId,
        userId: user.id,
      });

      if (result.ok) {
        annotateAgentPromptSpan(span, { status_code: 200 });
        return NextResponse.json({
          reverted: true,
          run_id: runId,
          ops_count: result.opsCount,
        });
      }

      // Mapear o `reason` para o HTTP status + error code histórico (regressão zero).
      switch (result.reason) {
        case 'not_found':
          annotateAgentPromptSpan(span, { status_code: 404 });
          return apiError('RUN_NOT_FOUND', 'Run não encontrado.', 404, { run_id: runId });
        case 'already_reverted':
          annotateAgentPromptSpan(span, { status_code: 409 });
          return apiError('UNDO_ALREADY_REVERTED', result.message, 409, { run_id: runId });
        case 'invalid_state':
          annotateAgentPromptSpan(span, { status_code: 409 });
          return apiError('UNDO_INVALID_STATE', result.message, 409, { run_id: runId });
        case 'expired':
          annotateAgentPromptSpan(span, { status_code: 409 });
          return apiError(
            'UNDO_EXPIRED',
            'Janela de undo expirou (30 segundos). A operação não pode mais ser revertida.',
            409,
            { run_id: runId },
          );
        case 'internal_error':
        default:
          annotateAgentPromptSpan(span, { status_code: 500 });
          return apiError('INTERNAL_ERROR', result.message, 500, { run_id: runId });
      }
    },
  );
}

/**
 * Aplica um `ReverseOp` ao DB (service_role para bypass RLS).
 *
 * Tipos suportados:
 *   - `delete_row` → DELETE FROM table WHERE id
 *   - `restore_row` → UPDATE table SET ... WHERE id (snapshot full)
 *   - `reinsert_row` → INSERT INTO table (id, ...cols) VALUES (...) — undo de
 *     hard delete (Story 2.14 FIX-1). As keys do snapshot são usadas como nomes
 *     de coluna LITERALMENTE — devem vir em snake_case (PO-FIX-1).
 *   - `composite` → recursivamente cada op
 *
 * Tabelas alvo são whitelisted para evitar SQL injection via `table` field.
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
  if (op.table === NOOP_SENTINEL_TABLE) {
    return;
  }

  if (!ALLOWED_REVERSE_TABLES.has(op.table)) {
    throw new Error(`Tabela "${op.table}" não permitida em reverse op (whitelist).`);
  }

  if (op.kind === 'delete_row') {
    await db.execute(sql.raw(`delete from ${op.table} where id = '${op.id}'`));
    return;
  }

  if (op.kind === 'reinsert_row') {
    // Story 2.14 FIX-1 — undo de hard delete: re-inserir a row com o `id` original.
    const snapshot = op.snapshot ?? {};
    const allFields: Record<string, unknown> = { id: op.id, ...snapshot };
    const cols = Object.keys(allFields).join(', ');
    const vals = Object.values(allFields)
      .map((value) => {
        if (value === null || value === undefined) {
          return 'NULL';
        }
        if (typeof value === 'number' || typeof value === 'boolean') {
          return String(value);
        }
        const safe = String(value).replace(/'/g, "''");
        return `'${safe}'`;
      })
      .join(', ');
    await db.execute(sql.raw(`insert into ${op.table} (${cols}) values (${vals})`));
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
