#!/usr/bin/env tsx
/**
 * Helper de desenvolvimento — diagnosticar e confirmar email de utilizador.
 *
 * Contexto (SMOKE-6.7): o signUp via UI fica bloqueado quando `Confirm email`
 * está ON sem SMTP custom (rate limit do SMTP de cortesia do Supabase → email
 * não chega). Este helper diagnostica o estado do utilizador em auth.users e,
 * com --apply, confirma o email (email_confirmed_at = now()) para permitir login
 * imediato em testes manuais. NUNCA usar em produção.
 *
 * Uso:
 *   # Diagnóstico (read-only):
 *   pnpm --filter @meu-jarvis/db exec tsx src/scripts/dev-confirm-user.ts --email=euricojsalves+t3@gmail.com
 *   # Confirmar (write):
 *   pnpm --filter @meu-jarvis/db exec tsx src/scripts/dev-confirm-user.ts --email=euricojsalves+t3@gmail.com --apply
 *
 * Trace: Story 6.7 SMOKE-6.7; espelha dev-create-user.ts (TASK-1).
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadEnv } from 'dotenv';
import postgres from 'postgres';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PKG_ROOT = resolve(__dirname, '..', '..');
loadEnv({ path: join(PKG_ROOT, '.env.local') });

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : undefined;
}

async function main(): Promise<number> {
  const url = process.env.DIRECT_URL;
  if (!url) {
    console.error('DIRECT_URL não definido.');
    return 1;
  }
  const email = parseArg('email');
  if (!email) {
    console.error('Indica --email=...');
    return 1;
  }
  const apply = process.argv.includes('--apply');

  const sql = postgres(url, { max: 1, prepare: false });
  try {
    console.log(`=== auth.users WHERE email = ${email} ===`);
    const users = await sql<
      { id: string; email: string; email_confirmed_at: Date | null; created_at: Date }[]
    >`
      select id, email, email_confirmed_at, created_at
      from auth.users
      where lower(email) = lower(${email})
    `;
    console.log(users);

    if (users.length === 0) {
      console.log('Utilizador NÃO existe. Usa dev-create-user.ts para o criar confirmado.');
      return 2;
    }

    const u = users[0]!;
    console.log(`\n=== household_members do utilizador (${u.id}) ===`);
    const members = await sql<
      { household_id: string; role: string; display_name: string | null }[]
    >`
      select household_id, role, display_name
      from public.household_members
      where user_id = ${u.id}::uuid
    `;
    console.log(members);

    if (u.email_confirmed_at) {
      console.log('\nEmail JÁ confirmado — pode fazer login. Nada a aplicar.');
      return 0;
    }

    if (!apply) {
      console.log('\nEmail NÃO confirmado. Corre de novo com --apply para confirmar.');
      return 0;
    }

    console.log('\n=== A confirmar email (email_confirmed_at = now()) ===');
    const updated = await sql<{ id: string; email_confirmed_at: Date | null }[]>`
      update auth.users
      set email_confirmed_at = now()
      where id = ${u.id}::uuid
      returning id, email_confirmed_at
    `;
    console.log(updated);
    console.log('\nConfirmado ✅ — já podes fazer login no browser com a password do signUp.');
    return 0;
  } catch (err) {
    console.error('Erro:', err);
    return 1;
  } finally {
    await sql.end();
  }
}

main().then((c) => process.exit(c));
