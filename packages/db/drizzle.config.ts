/**
 * Drizzle Kit config — meu-jarvis (Expressia)
 *
 * Uso:
 *   pnpm db:generate   → gera SQL em ./migrations a partir do schema TS
 *   pnpm db:migrate    → aplica migrações pendentes em DATABASE_URL
 *   pnpm db:studio     → abre Drizzle Studio (UI local)
 *
 * Importante: NÃO usar `db:push` em produção (apenas dev local).
 * Migrações aplicam via GitHub Actions com approval gate (ver architecture §11.4).
 */
import { defineConfig } from 'drizzle-kit';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  // Em dev local pode-se usar um default; em CI/prod é OBRIGATÓRIO via env
  // eslint-disable-next-line no-console
  console.warn(
    '[drizzle.config] DATABASE_URL não definido — defina em .env.local ou environment do CI.',
  );
}

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: databaseUrl ?? 'postgresql://postgres:postgres@localhost:5432/meu_jarvis_dev',
  },
  // Aplica policies/RLS via SQL bruto (Drizzle ainda não tem first-class RLS DSL completo)
  // Migrações 0001+ assumem que 0000 já criou helpers e enums.
  verbose: true,
  strict: true,
  schemaFilter: ['public'],
  // Só gera diff para o nosso schema — não toca em auth.* (gerido por Supabase Auth)
  tablesFilter: ['!auth.*'],
});
