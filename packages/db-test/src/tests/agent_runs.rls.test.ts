/**
 * RLS isolation + immutability — `agent_runs` (FR3, NFR9 audit imutável).
 *
 * Notas críticas (architecture §3.2 + 0001_rls_policies.sql + 0005_agent_immutability_and_ttl.sql):
 *   - INSERT requer `user_id = auth.uid()` E `is_household_member(household_id)`.
 *   - DELETE bloqueado para `authenticated` (audit imutável — NFR9).
 *   - Trigger `trg_agent_runs_immutability`: bloqueia UPDATE quando OLD.status
 *     é terminal (success/reverted/failed) excepto via service_role.
 *
 * Trace: Story 1.4 AC2, AC8 + Story 2.1 AC6 (immutability NFR9).
 */
import { afterAll, beforeEach, describe, expect, test } from 'vitest';

import { admin, insertAgentRun } from '@/helpers/fixtures';
import { asUser, closeRlsHarness, expectRlsBlocks, resetData, seedTwoHouseholds } from '@/rls-harness';

afterAll(async () => {
  await closeRlsHarness();
});

describe('RLS isolation: agent_runs', () => {
  beforeEach(async () => {
    await resetData();
  });

  test('userA vê os seus agent_runs e NÃO vê os de B', async () => {
    const { householdA, householdB, userA, userB } = await seedTwoHouseholds();
    await insertAgentRun(admin(), householdA.id, userA.id);
    await insertAgentRun(admin(), householdB.id, userB.id);

    await asUser(userA.id, householdA.id, async (sql) => {
      const rows = await sql<{ user_id: string }[]>`select user_id from public.agent_runs`;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.user_id).toBe(userA.id);
    });
  });

  test('cross-household INSERT bloqueado: userB não pode inserir run com household_id de A', async () => {
    const { householdA, householdB, userB } = await seedTwoHouseholds();

    const blocked = await expectRlsBlocks(userB.id, householdB.id, async (sql) => {
      await insertAgentRun(sql, householdA.id, userB.id);
    });
    expect(blocked).toBe(true);
  });

  test('INSERT com user_id ≠ auth.uid() bloqueado (policy: user_id = auth.uid())', async () => {
    const { householdA, userA, userB } = await seedTwoHouseholds();

    // userA está autenticado mas tenta inserir run em nome do userB no householdA.
    // Como userB não é membro de householdA, e a policy exige user_id = auth.uid(),
    // qualquer combinação que viole isto deve falhar.
    const blocked = await expectRlsBlocks(userA.id, householdA.id, async (sql) => {
      await insertAgentRun(sql, householdA.id, userB.id);
    });
    expect(blocked).toBe(true);
  });

  test('DELETE bloqueado para authenticated (audit imutável NFR9)', async () => {
    const { householdA, userA } = await seedTwoHouseholds();
    const runId = await insertAgentRun(admin(), householdA.id, userA.id);

    await asUser(userA.id, householdA.id, async (sql) => {
      const result = await sql`delete from public.agent_runs where id = ${runId}`;
      expect(result.count).toBe(0);
    });

    const rows = await admin()<{ n: number }[]>`
      select count(*)::int as n from public.agent_runs where id = ${runId}
    `;
    expect(rows[0]?.n).toBe(1);
  });

  // ───────────────────────────────────────────────────────────────────
  // Story 2.1 — Immutability NFR9 (trigger trg_agent_runs_immutability)
  // ───────────────────────────────────────────────────────────────────
  // O trigger `trg_agent_runs_immutability` (migration 0005) bloqueia UPDATE
  // em agent_runs com status terminal (success/reverted/failed) APENAS para
  // os roles aplicacionais (`authenticated`, `anon`). service_role, postgres
  // superuser e outros roles privilegiados continuam a poder modificar
  // (necessário para Inngest purge job + setter de reverted_at).
  //
  // Nos testes:
  //   - admin() = connection postgres superuser → trigger PERMITE
  //   - asUser(...) = set local role authenticated → trigger BLOQUEIA
  //   - admin().begin(set role service_role) → trigger PERMITE

  test('UPDATE em agent_run com status="success" bloqueado para authenticated (NFR9)', async () => {
    const { householdA, userA } = await seedTwoHouseholds();
    const runId = await insertAgentRun(admin(), householdA.id, userA.id);

    // admin() = postgres superuser, trigger permite. Promovemos a terminal.
    await admin()`
      update public.agent_runs
      set status = 'success', completed_at = now()
      where id = ${runId}
    `;

    // Tentativa de mutação como authenticated → trigger lança excepção.
    // Nota: `expectRlsBlocks` faz match em mensagens RLS; o nosso erro é
    // check_violation (23514) com mensagem "imutável após estado terminal".
    // Validamos directamente que o conteúdo NÃO mudou — invariante NFR9.
    let raised = false;
    try {
      await asUser(userA.id, householdA.id, async (sql) => {
        await sql`
          update public.agent_runs
          set response_summary = 'tentativa de mutação ilegal'
          where id = ${runId}
        `;
      });
    } catch (err) {
      raised = err instanceof Error && /imutável após estado terminal/.test(err.message);
    }
    expect(raised).toBe(true);

    const rows = await admin()<{ response_summary: string | null }[]>`
      select response_summary from public.agent_runs where id = ${runId}
    `;
    expect(rows[0]?.response_summary).toBeNull();
  });

  test('UPDATE em agent_run com status="reverted" bloqueado para authenticated (NFR9)', async () => {
    const { householdA, userA } = await seedTwoHouseholds();
    const runId = await insertAgentRun(admin(), householdA.id, userA.id);

    await admin()`
      update public.agent_runs
      set status = 'reverted', reverted_at = now()
      where id = ${runId}
    `;

    let raised = false;
    try {
      await asUser(userA.id, householdA.id, async (sql) => {
        await sql`
          update public.agent_runs
          set response_summary = 'mutação após reverted'
          where id = ${runId}
        `;
      });
    } catch (err) {
      raised = err instanceof Error && /imutável após estado terminal/.test(err.message);
    }
    expect(raised).toBe(true);
  });

  test('UPDATE em agent_run com status="executing" PERMITIDO para authenticated (fluxo normal pré-terminal)', async () => {
    const { householdA, userA } = await seedTwoHouseholds();
    const runId = await insertAgentRun(admin(), householdA.id, userA.id);

    // Mover para 'executing' (não-terminal — trigger NÃO dispara).
    await admin()`update public.agent_runs set status = 'executing' where id = ${runId}`;

    // UPDATE como authenticated em estado pré-terminal → permitido (WHEN clause não match).
    await asUser(userA.id, householdA.id, async (sql) => {
      const result = await sql`
        update public.agent_runs
        set response_summary = 'progresso normal'
        where id = ${runId}
      `;
      expect(result.count).toBe(1);
    });

    const rows = await admin()<{ response_summary: string | null }[]>`
      select response_summary from public.agent_runs where id = ${runId}
    `;
    expect(rows[0]?.response_summary).toBe('progresso normal');
  });

  test('UPDATE em agent_run terminal PERMITIDO via service_role (Inngest purge + reverted_at setter)', async () => {
    const { householdA, userA } = await seedTwoHouseholds();
    const runId = await insertAgentRun(admin(), householdA.id, userA.id);

    // Promover a 'success' (admin = postgres, permitido).
    await admin()`
      update public.agent_runs
      set status = 'success', completed_at = now()
      where id = ${runId}
    `;

    // service_role pode marcar reverted_at mesmo após terminal (fluxo undo Story 2.5+).
    await admin().begin(async (tx) => {
      await tx.unsafe('set local role service_role');
      const result = await tx`
        update public.agent_runs
        set status = 'reverted', reverted_at = now()
        where id = ${runId}
      `;
      expect(result.count).toBe(1);
    });

    const rows = await admin()<{ status: string; reverted_at: Date | null }[]>`
      select status, reverted_at from public.agent_runs where id = ${runId}
    `;
    expect(rows[0]?.status).toBe('reverted');
    expect(rows[0]?.reverted_at).not.toBeNull();
  });
});
