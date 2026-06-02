#!/usr/bin/env tsx
/**
 * Verificador one-shot do smoke INVITE-E2E (re-teste ACHADO-1 pós-0022).
 * Uso: pnpm --filter @meu-jarvis/db tsx src/scripts/verify-invite-smoke.ts
 *
 * Confirma em prod (DIRECT_URL) se o convite pendente do smoke foi aceite:
 *   1. household_invites do token → accepted_at / accepted_by_user_id
 *   2. household_members do +t3 → em quantos households está (deve ficar em 2)
 *
 * Script ad-hoc de smoke — não faz parte do schema/CI.
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadEnv } from 'dotenv';
import postgres from 'postgres';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PKG_ROOT = resolve(__dirname, '..', '..');
loadEnv({ path: join(PKG_ROOT, '.env.local') });

const TOKEN = 'b3c18eb4b22d229040e2b536ddec80cfadc7cd66757a373acbdb53cbf47e5e8b';
const T3_USER_ID = 'b11472e4-7536-4e58-a2a0-f72be21d097a';
const T2_HOUSEHOLD = '74a4d7bc-31f4-48ef-b2d4-9790d02dd031';

async function main(): Promise<number> {
  const url = process.env.DIRECT_URL;
  if (!url) {
    console.error('DIRECT_URL não definido.');
    return 1;
  }
  const sql = postgres(url, { max: 1, prepare: false });
  try {
    console.log('=== 1. Estado do convite (token do smoke) ===');
    const invite = await sql<
      {
        id: string;
        email: string;
        household_id: string;
        accepted_at: Date | null;
        accepted_by_user_id: string | null;
        expires_at: Date;
      }[]
    >`
      select id, email, household_id, accepted_at, accepted_by_user_id, expires_at
      from public.household_invites
      where token = ${TOKEN}
    `;
    console.log(invite);

    console.log('\n=== 2. Memberships do +t3 (deve estar em 2 households se aceite) ===');
    const members = await sql<
      { household_id: string; role: string; display_name: string | null }[]
    >`
      select household_id, role, display_name
      from public.household_members
      where user_id = ${T3_USER_ID}
      order by household_id
    `;
    console.log(members);

    const accepted =
      invite.length === 1 &&
      invite[0]!.accepted_at !== null &&
      invite[0]!.accepted_by_user_id === T3_USER_ID;
    const inT2 = members.some((m) => m.household_id === T2_HOUSEHOLD);

    console.log(`\n=== VEREDICTO ===`);
    console.log(`Convite aceite (accepted_at + accepted_by=+t3): ${accepted ? 'SIM ✅' : 'NÃO ❌'}`);
    console.log(`+t3 é membro do household do +t2: ${inT2 ? 'SIM ✅' : 'NÃO ❌'}`);
    return accepted && inT2 ? 0 : 1;
  } catch (err) {
    console.error('Erro:', err);
    return 1;
  } finally {
    await sql.end();
  }
}

main().then((c) => process.exit(c));
