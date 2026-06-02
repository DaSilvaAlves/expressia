#!/usr/bin/env tsx
/**
 * Diagnóstico one-shot (SMOKE-6.7): a conexão runtime do getDb() (DATABASE_URL,
 * pgbouncer 6543) expõe auth.uid()? Prova se accept_invite() pode obter o
 * utilizador via auth.uid() ou se este vem NULL (gap de claims).
 *
 * Uso: pnpm --filter @meu-jarvis/db exec tsx src/scripts/diag-getdb-auth.ts
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadEnv } from 'dotenv';
import postgres from 'postgres';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PKG_ROOT = resolve(__dirname, '..', '..');
loadEnv({ path: join(PKG_ROOT, '.env.local') });

async function main(): Promise<number> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL não definido.');
    return 1;
  }
  const sql = postgres(url, { prepare: false, max: 1 });
  try {
    const r = await sql<
      { current_user: string; auth_uid: string | null; jwt_claims: string | null }[]
    >`
      select
        current_user,
        auth.uid()::text as auth_uid,
        current_setting('request.jwt.claims', true) as jwt_claims
    `;
    console.log('=== getDb() runtime connection (DATABASE_URL) ===');
    console.log(r);
    const uidNull = r[0]?.auth_uid == null;
    console.log(
      `\nauth.uid() = ${r[0]?.auth_uid ?? 'NULL'} → accept_invite() ${uidNull ? 'FALHA com AUTH_REQUIRED (gap confirmado)' : 'consegue o utilizador'}`,
    );
    return 0;
  } catch (err) {
    console.error('Erro:', err);
    return 1;
  } finally {
    await sql.end();
  }
}

main().then((c) => process.exit(c));
