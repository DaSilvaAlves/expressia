/**
 * Função SQL `accept_invite(p_token, p_user_id)` — Story 6.7 AC1
 * (migration 0020 → fix ACHADO-1 via migration 0022).
 *
 * Valida o ciclo de aceitação de convite contra um Postgres real (Testcontainers):
 * sucesso, token inválido, expirado, dupla aceitação, email não corresponde, já
 * membro e limite de plano (Família=4). A identidade do convidado é passada
 * EXPLICITAMENTE em `p_user_id` (já não depende de `auth.uid()` — ver 0022): o
 * runtime `getDb()` liga sem JWT claims, logo `auth.uid()` era NULL. A função
 * continua SECURITY DEFINER para ler `auth.users.email` (email-match).
 *
 * Trace: Story 6.7 AC1/AC11; FR27; R-6.5; ACHADO-1.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, test } from 'vitest';

import { admin } from '@/helpers/fixtures';
import { asUser, closeRlsHarness, resetData, seedTwoHouseholds } from '@/rls-harness';

afterAll(async () => {
  await closeRlsHarness();
});

/** Executa `fn` com os triggers de auth.users/households desligados (evita o
 * trigger handle_new_user criar households extra ao inserir users de teste). */
async function withTriggersOff<T>(fn: () => Promise<T>): Promise<T> {
  const sql = admin();
  await sql.unsafe(`alter table auth.users disable trigger on_auth_user_created`);
  await sql.unsafe(
    `alter table public.households disable trigger trigger_seed_kanban_after_household_insert`,
  );
  try {
    return await fn();
  } finally {
    await sql.unsafe(
      `alter table public.households enable trigger trigger_seed_kanban_after_household_insert`,
    );
    await sql.unsafe(`alter table auth.users enable trigger on_auth_user_created`);
  }
}

async function createUser(email: string): Promise<string> {
  const id = randomUUID();
  await admin()`insert into auth.users (id, email) values (${id}, ${email})`;
  return id;
}

async function addMember(householdId: string, userId: string, role = 'member'): Promise<void> {
  await admin()`
    insert into public.household_members (household_id, user_id, role)
    values (${householdId}, ${userId}, ${role}::household_role)
  `;
}

async function createInvite(
  householdId: string,
  invitedBy: string,
  email: string,
  opts: { expired?: boolean; role?: string } = {},
): Promise<string> {
  const token = `tok_${randomUUID()}`;
  const expiresAt = opts.expired ? `now() - interval '1 day'` : `now() + interval '7 days'`;
  await admin().unsafe(
    `insert into public.household_invites (household_id, invited_by_user_id, email, token, expires_at, role)
     values ($1, $2, $3, $4, ${expiresAt}, $5::household_role)`,
    [householdId, invitedBy, email, token, opts.role ?? 'member'],
  );
  return token;
}

/**
 * Chama `accept_invite(token, p_user_id)` como `userId`.
 *
 * A identidade do convidado é passada EXPLICITAMENTE em `p_user_id` (espelha o
 * handler runtime, que passa `user.id`). O `asUser(...)` continua a correr a
 * transacção como role `authenticated` (necessário para o GRANT), mas o claim de
 * identidade já NÃO é a fonte de verdade da função — é o `p_user_id`.
 *
 * Por defeito `p_user_id === userId` (caso normal). `opts.asUserId` permite
 * passar um `p_user_id` DIFERENTE do utilizador da transacção, para provar que a
 * função valida sempre contra o p_user_id recebido (não contra o claim).
 */
async function callAccept(
  userId: string,
  claimHouseholdId: string,
  token: string,
  opts: { asUserId?: string } = {},
): Promise<string> {
  const targetUserId = opts.asUserId ?? userId;
  return asUser(userId, claimHouseholdId, async (sql) => {
    const rows = await sql<{ household_id: string }[]>`
      select public.accept_invite(${token}, ${targetUserId}::uuid) as household_id
    `;
    return rows[0]!.household_id;
  });
}

describe('accept_invite()', () => {
  beforeEach(async () => {
    await resetData();
  });

  test('aceita convite válido → convidado vira membro do household', async () => {
    const { householdA, userA } = await seedTwoHouseholds();
    const email = `guest-${randomUUID().slice(0, 6)}@meu-jarvis.test`;
    const guestId = await withTriggersOff(() => createUser(email));
    const token = await createInvite(householdA.id, userA.id, email);

    const result = await callAccept(guestId, householdA.id, token);
    expect(result).toBe(householdA.id);

    const members = await admin()`
      select user_id from public.household_members
      where household_id = ${householdA.id} and user_id = ${guestId}
    `;
    expect(members).toHaveLength(1);

    const invite = await admin()`
      select accepted_at, accepted_by_user_id from public.household_invites
      where token = ${token}
    `;
    expect(invite[0]!.accepted_at).not.toBeNull();
    expect(invite[0]!.accepted_by_user_id).toBe(guestId);
  });

  test('token inválido → INVITE_NOT_FOUND', async () => {
    const { householdA } = await seedTwoHouseholds();
    const guestId = await withTriggersOff(() => createUser(`g-${randomUUID().slice(0, 6)}@x.pt`));
    await expect(callAccept(guestId, householdA.id, 'inexistente')).rejects.toThrow(
      /INVITE_NOT_FOUND/,
    );
  });

  test('convite expirado → INVITE_EXPIRED', async () => {
    const { householdA, userA } = await seedTwoHouseholds();
    const email = `g-${randomUUID().slice(0, 6)}@x.pt`;
    const guestId = await withTriggersOff(() => createUser(email));
    const token = await createInvite(householdA.id, userA.id, email, { expired: true });
    await expect(callAccept(guestId, householdA.id, token)).rejects.toThrow(/INVITE_EXPIRED/);
  });

  test('email não corresponde → INVITE_EMAIL_MISMATCH', async () => {
    const { householdA, userA } = await seedTwoHouseholds();
    const guestId = await withTriggersOff(() => createUser(`g-${randomUUID().slice(0, 6)}@x.pt`));
    const token = await createInvite(householdA.id, userA.id, 'outro-email@x.pt');
    await expect(callAccept(guestId, householdA.id, token)).rejects.toThrow(
      /INVITE_EMAIL_MISMATCH/,
    );
  });

  test('dupla aceitação → segunda falha INVITE_ALREADY_ACCEPTED', async () => {
    const { householdA, userA } = await seedTwoHouseholds();
    const email = `g-${randomUUID().slice(0, 6)}@x.pt`;
    const guestId = await withTriggersOff(() => createUser(email));
    const token = await createInvite(householdA.id, userA.id, email);

    await callAccept(guestId, householdA.id, token);
    await expect(callAccept(guestId, householdA.id, token)).rejects.toThrow(
      /INVITE_ALREADY_ACCEPTED/,
    );
  });

  test('limite de plano Família=4 → 5º membro recusado (MEMBER_LIMIT_REACHED)', async () => {
    const { householdA, userA } = await seedTwoHouseholds(); // 1 membro (owner), plan 'familia'
    // Encher até 4 membros (owner + 3).
    await withTriggersOff(async () => {
      for (let i = 0; i < 3; i++) {
        const u = await createUser(`m${i}-${randomUUID().slice(0, 6)}@x.pt`);
        await addMember(householdA.id, u);
      }
    });

    const email = `g-${randomUUID().slice(0, 6)}@x.pt`;
    const guestId = await withTriggersOff(() => createUser(email));
    const token = await createInvite(householdA.id, userA.id, email);

    await expect(callAccept(guestId, householdA.id, token)).rejects.toThrow(
      /MEMBER_LIMIT_REACHED/,
    );
  });

  test('já membro → ALREADY_MEMBER', async () => {
    const { householdA, userA } = await seedTwoHouseholds();
    const email = `g-${randomUUID().slice(0, 6)}@x.pt`;
    const guestId = await withTriggersOff(async () => {
      const id = await createUser(email);
      await addMember(householdA.id, id); // já é membro
      return id;
    });
    const token = await createInvite(householdA.id, userA.id, email);
    await expect(callAccept(guestId, householdA.id, token)).rejects.toThrow(/ALREADY_MEMBER/);
  });

  test('p_user_id diferente do convidado NÃO contorna email-match (segurança)', async () => {
    // ACHADO-1 fix: a função valida SEMPRE contra o p_user_id recebido. Um
    // p_user_id de um utilizador cujo email NÃO corresponde ao do convite tem de
    // falhar com INVITE_EMAIL_MISMATCH — passar um id arbitrário não permite
    // entrar num household alheio.
    const { householdA, userA } = await seedTwoHouseholds();
    const guestEmail = `guest-${randomUUID().slice(0, 6)}@x.pt`;
    const attackerEmail = `attacker-${randomUUID().slice(0, 6)}@x.pt`;

    const { guestId, attackerId } = await withTriggersOff(async () => {
      const g = await createUser(guestEmail);
      const a = await createUser(attackerEmail);
      return { guestId: g, attackerId: a };
    });

    // Convite nominal para o guestEmail.
    const token = await createInvite(householdA.id, userA.id, guestEmail);

    // O atacante (email diferente) tenta aceitar passando o SEU id → email-match falha.
    await expect(
      callAccept(attackerId, householdA.id, token, { asUserId: attackerId }),
    ).rejects.toThrow(/INVITE_EMAIL_MISMATCH/);

    // Não foi criada membership para o atacante.
    const members = await admin()`
      select user_id from public.household_members
      where household_id = ${householdA.id} and user_id = ${attackerId}
    `;
    expect(members).toHaveLength(0);

    // O convidado legítimo (email correcto) consegue aceitar.
    const result = await callAccept(guestId, householdA.id, token, { asUserId: guestId });
    expect(result).toBe(householdA.id);
  });

  test('p_user_id null → AUTH_REQUIRED (guarda defensiva)', async () => {
    const { householdA, userA } = await seedTwoHouseholds();
    const email = `g-${randomUUID().slice(0, 6)}@x.pt`;
    const guestId = await withTriggersOff(() => createUser(email));
    const token = await createInvite(householdA.id, userA.id, email);

    await expect(
      asUser(guestId, householdA.id, async (sql) => {
        await sql`select public.accept_invite(${token}, ${null}::uuid) as household_id`;
      }),
    ).rejects.toThrow(/AUTH_REQUIRED/);
  });
});
