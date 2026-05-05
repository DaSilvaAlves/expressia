/**
 * Drizzle Kit config — meu-jarvis (Expressia)
 *
 * Uso:
 *   pnpm db:generate   → gera SQL em ./migrations a partir do schema TS (usa DIRECT_URL)
 *   pnpm db:push       → aplica schema directamente (DEV ONLY)
 *   pnpm db:studio     → abre Drizzle Studio (UI local)
 *   pnpm db:migrate    → corre o runner custom em src/scripts/apply-migrations.ts
 *                         (aplica os ficheiros SQL handwritten em ordem; usa DIRECT_URL)
 *   pnpm db:seed       → corre src/scripts/apply-seeds.ts (usa DIRECT_URL)
 *
 * Importante: NÃO usar `db:push` em produção (apenas dev local).
 * Migrações em produção aplicam via GitHub Actions com approval gate (ver
 * architecture §11.4) — usam o mesmo runner custom mas com `SUPABASE_DB_URL`.
 *
 * Dual-URL pattern (Supabase, ver architecture §11.2):
 *   - DATABASE_URL   → pooler 6543 (transaction-mode pgbouncer; runtime queries)
 *   - DIRECT_URL     → pooler 5432 (session-mode; migrations + drizzle-kit)
 *
 * `drizzle-kit` precisa de prepared statements e DDL session-scoped, por isso
 * usa SEMPRE `DIRECT_URL` (porta 5432). Em runtime o `client.ts` usa o pooler 6543
 * com `prepare: false` (compat pgbouncer transaction-mode).
 */
import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

// Carregar .env.local quando se corre drizzle-kit a partir de packages/db/
// (pnpm não injecta automaticamente .env.local em scripts custom).
loadEnv({ path: '.env.local' });

const directUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL_DIRECT;

if (!directUrl) {
  // Em dev local pode-se usar um default; em CI/prod é OBRIGATÓRIO via env
  // eslint-disable-next-line no-console
  console.warn(
    '[drizzle.config] DIRECT_URL não definido — defina em .env.local ou environment do CI.',
  );
}

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: directUrl ?? 'postgresql://postgres:postgres@localhost:5432/meu_jarvis_dev',
  },
  // Aplica policies/RLS via SQL bruto (Drizzle ainda não tem first-class RLS DSL completo)
  // Migrações 0001+ assumem que 0000 já criou helpers e enums.
  verbose: true,
  strict: true,
  schemaFilter: ['public'],
  // Só gera diff para o nosso schema — não toca em auth.* (gerido por Supabase Auth)
  tablesFilter: ['!auth.*'],
});
