#!/usr/bin/env tsx
/**
 * Helper de desenvolvimento — criar utilizador Supabase com email confirmado.
 *
 * Contexto (TASK-1 Dex 2026-05-26):
 *   O fluxo normal de signUp via UI fica bloqueado quando o `Confirm email`
 *   está ON no Dashboard sem SMTP custom configurado (rate limit + emails
 *   não entregues). Este script permite criar utilizadores prontos para
 *   smoke visual humano em segundos.
 *
 *   Apenas para uso em desenvolvimento. NUNCA em produção — usa o
 *   `SUPABASE_SERVICE_ROLE_KEY` (acesso admin total).
 *
 * Uso:
 *   pnpm --filter @meu-jarvis/db exec tsx src/scripts/dev-create-user.ts \
 *     --email=dex+smoke1@expressia.pt \
 *     --password=Smoke12345!
 *
 *   # Email gerado automaticamente:
 *   pnpm --filter @meu-jarvis/db exec tsx src/scripts/dev-create-user.ts --password=Smoke12345!
 *
 * Trigger 0003 (handle_new_user) corre normalmente — o utilizador fica com
 * household + membership + subscription + audit completos.
 *
 * Trace: Story 1.5 D8, TASK-1 root cause runbook §troubleshooting.
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadEnv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PKG_ROOT = resolve(__dirname, '..', '..');
const REPO_ROOT = resolve(PKG_ROOT, '..', '..');

loadEnv({ path: join(PKG_ROOT, '.env.local') });
loadEnv({ path: join(REPO_ROOT, 'apps', 'web', '.env.local'), override: false });

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : undefined;
}

async function main(): Promise<number> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    console.error(
      'Env vars em falta — verifica NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY em packages/db/.env.local ou apps/web/.env.local.',
    );
    return 1;
  }

  const password = parseArg('password');
  if (!password || password.length < 8) {
    console.error('Indica --password=... com pelo menos 8 caracteres.');
    return 1;
  }
  const email = parseArg('email') || `dex-dev-${Date.now()}@expressia.pt`;

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log(`A criar utilizador (admin, email_confirm: true): ${email}`);
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) {
    console.error('Erro:', error);
    return 2;
  }
  console.log('');
  console.log('Utilizador criado:');
  console.log(`  id:                 ${data.user.id}`);
  console.log(`  email:              ${data.user.email}`);
  console.log(`  email_confirmed_at: ${data.user.email_confirmed_at}`);
  console.log('');
  console.log('Credenciais para teste UI:');
  console.log(`  ${email}`);
  console.log(`  ${password}`);
  console.log('');
  console.log('Trigger 0003 cria household + membership + subscription + audit automaticamente.');
  console.log('Cleanup: ver runbook docs/runbooks/supabase-auth-setup.md §6 step 6.');

  return 0;
}

main().then((c) => process.exit(c));
