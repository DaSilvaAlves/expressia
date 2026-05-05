/**
 * RLS isolation — `audit_log` (NFR9 append-only, AC8 alta prioridade).
 *
 * Notas críticas (0001_rls_policies.sql + REVOKE):
 *   - SELECT permitido APENAS a owner/admin do household (PII em IPs/user_agents).
 *   - INSERT permitido a qualquer membro.
 *   - UPDATE/DELETE bloqueados (append-only); REVOKE adicional reforça.
 *
 * Trace: Story 1.4 AC2, AC8 (audit_log).
 */
import { afterAll, beforeEach, describe, expect, test } from 'vitest';

import { admin, insertAuditLog } from '@/helpers/fixtures';
import { asUser, closeRlsHarness, expectRlsBlocks, resetData, seedTwoHouseholds } from '@/rls-harness';

afterAll(async () => {
  await closeRlsHarness();
});

describe('RLS isolation: audit_log', () => {
  beforeEach(async () => {
    await resetData();
  });

  test('owner do householdA vê audit_log do próprio household, não vê o do B', async () => {
    const { householdA, householdB, userA, userB } = await seedTwoHouseholds();
    await insertAuditLog(admin(), householdA.id, userA.id);
    await insertAuditLog(admin(), householdB.id, userB.id);

    await asUser(userA.id, householdA.id, async (sql) => {
      const rows = await sql<{ household_id: string }[]>`
        select household_id from public.audit_log
      `;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.household_id).toBe(householdA.id);
    });
  });

  test('cross-household SELECT bloqueado', async () => {
    const { householdA, householdB, userA, userB } = await seedTwoHouseholds();
    await insertAuditLog(admin(), householdA.id, userA.id);

    await asUser(userB.id, householdB.id, async (sql) => {
      const rows = await sql`select id from public.audit_log`;
      expect(rows).toHaveLength(0);
    });
  });

  test('UPDATE bloqueado para authenticated (append-only — REVOKE explícito)', async () => {
    const { householdA, userA } = await seedTwoHouseholds();
    const auditId = await insertAuditLog(admin(), householdA.id, userA.id);

    // O REVOKE UPDATE garante "permission denied" antes mesmo de avaliar policies.
    // A excepção propaga para fora do asUser via rollback da transação.
    await expect(
      asUser(userA.id, householdA.id, async (sql) => {
        await sql`update public.audit_log set ip = '1.2.3.4' where id = ${auditId}`;
      }),
    ).rejects.toThrow(/permission denied|row-level security/i);

    // Verificar que o ip não mudou.
    const rows = await admin()<{ ip: string | null }[]>`
      select ip from public.audit_log where id = ${auditId}
    `;
    expect(rows[0]?.ip).toBeNull();
  });

  test('DELETE bloqueado para authenticated (append-only — REVOKE explícito)', async () => {
    const { householdA, userA } = await seedTwoHouseholds();
    const auditId = await insertAuditLog(admin(), householdA.id, userA.id);

    await expect(
      asUser(userA.id, householdA.id, async (sql) => {
        await sql`delete from public.audit_log where id = ${auditId}`;
      }),
    ).rejects.toThrow(/permission denied|row-level security/i);

    // Verificar que a row sobrevive.
    const rows = await admin()<{ n: number }[]>`
      select count(*)::int as n from public.audit_log where id = ${auditId}
    `;
    expect(rows[0]?.n).toBe(1);
  });

  test('cross-household INSERT bloqueado', async () => {
    const { householdA, householdB, userB } = await seedTwoHouseholds();

    const blocked = await expectRlsBlocks(userB.id, householdB.id, async (sql) => {
      await insertAuditLog(sql, householdA.id, userB.id);
    });
    expect(blocked).toBe(true);
  });
});
