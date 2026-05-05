#!/usr/bin/env tsx
/**
 * Apply bootstrap (auth schema stub) — meu-jarvis (Expressia)
 *
 * Aplica o BOOTSTRAP_SQL do harness Testcontainers contra um Postgres
 * vanilla (CI) para criar roles + schema auth + tabela auth.users stub
 * + funções auth.uid()/auth.jwt() + grants. Necessário porque as migrations
 * de produção (0000_initial_schema.sql, 0001_rls_policies.sql) referenciam
 * estes objectos que existem em Supabase mas não em Postgres limpo.
 *
 * Uso:
 *   DATABASE_URL=postgresql://test:test@localhost:5432/testdb pnpm db:bootstrap
 *
 * Ambiente: APENAS CI / Testcontainers ad-hoc. Não correr contra Supabase
 * real (objectos já existem; risco de permission errors).
 *
 * Trace: Story 1.4 follow-up — fix CI rls-gate (run #25404823363).
 * Architecture §3.2 (RLS via JWT claims).
 */
import { applyBootstrap } from '../harness/bootstrap.js';

function redact(url: string): string {
  return url.replace(/\/\/[^@]+@/, '//***:***@');
}

async function main(): Promise<number> {
  const url = process.env.DATABASE_URL;

  if (!url) {
    console.error(
      '[db:bootstrap] ERRO: DATABASE_URL não definido. ' +
        'Define a connection string para o Postgres alvo (CI ou Testcontainers ad-hoc).',
    );
    return 1;
  }

  // Sanity guard — nunca correr contra Supabase real.
  if (/supabase\.co|pooler\.supabase/.test(url)) {
    console.error(
      '[db:bootstrap] ERRO: DATABASE_URL aponta para Supabase real. ' +
        'Este script destina-se apenas a Postgres vanilla (CI / Testcontainers ad-hoc). ' +
        'Em Supabase, o schema auth e roles já existem nativamente.',
    );
    return 1;
  }

  console.log(`[db:bootstrap] A aplicar bootstrap (auth stub + roles) contra ${redact(url)}…`);

  try {
    await applyBootstrap(url);
    console.log('[db:bootstrap] ✅ Bootstrap aplicado com sucesso.');
    return 0;
  } catch (err) {
    console.error('[db:bootstrap] ❌ Falhou:', err);
    return 1;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('[db:bootstrap] Erro inesperado:', err);
    process.exit(1);
  });
