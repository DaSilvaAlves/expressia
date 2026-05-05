/**
 * Bootstrap SQL — cria role e funções que existem em Supabase mas não em Postgres vanilla.
 *
 * Em Supabase, o role `authenticated` e as funções `auth.uid()` / `auth.jwt()` são
 * fornecidos automaticamente. Num Postgres 16 cru via Testcontainers temos de os criar
 * manualmente ANTES de aplicar as migrations de produção, porque o ficheiro
 * `0001_rls_policies.sql` referencia-os directamente nas policies.
 *
 * Decisão arquitectural: este bootstrap vive APENAS no harness de testes. NÃO é
 * adicionado às migrations de produção (essas já assumem ambiente Supabase). Isto
 * mantém as migrations limpas e específicas do ambiente de produção.
 *
 * Trace: Architecture §3.2 (RLS via JWT claims), Story 1.4 Dev Notes (decisão técnica nº 6).
 */
import postgres from 'postgres';

/**
 * SQL que prepara o ambiente para aceitar as migrations de produção.
 *
 * Cria:
 *   - Role `authenticated` (sem login, herdado por sessões via `SET ROLE`)
 *   - Role `anon` (para completar paridade com Supabase)
 *   - Role `service_role` (mesmo motivo — algumas migrations podem usar)
 *   - Schema `auth` (Supabase guarda lá `auth.users`)
 *   - Tabela mínima `auth.users` para satisfazer FKs do schema de produção
 *   - Função `auth.uid()` que lê `request.jwt.claims->>'sub'`
 *   - Função `auth.jwt()` que devolve as claims completas (não usado pelas policies
 *     actuais mas standard Supabase, incluído por completude)
 */
const BOOTSTRAP_SQL = `
-- Roles Supabase (idempotente).
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end
$$;

-- Schema auth (Supabase nativo).
create schema if not exists auth;

-- auth.users mínima — apenas as colunas que as FKs do schema de produção referenciam.
-- Só id é estritamente necessário para FK; email é útil para uma das policies
-- (household_invites_select_household_or_invited usa auth.users.email).
create table if not exists auth.users (
  id uuid primary key,
  email text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Função auth.uid() — lê o sub claim do JWT simulado via SET request.jwt.claims.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    current_setting('request.jwt.claims', true)::json->>'sub',
    ''
  )::uuid
$$;

-- Função auth.jwt() — devolve as claims completas como jsonb.
create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb,
    '{}'::jsonb
  )
$$;

-- Permissões básicas para os roles (Supabase concede assim por defeito).
grant usage on schema auth to authenticated, anon, service_role;
grant select on auth.users to authenticated, anon, service_role;
grant execute on function auth.uid() to authenticated, anon, service_role;
grant execute on function auth.jwt() to authenticated, anon, service_role;

-- O role authenticated precisa de USAGE no schema public e de privilégios nas tabelas.
-- Em Supabase isto vem por default; replicamos aqui.
grant usage on schema public to authenticated, anon;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant usage on sequences to authenticated;
alter default privileges in schema public grant execute on functions to authenticated;
`;

/**
 * Aplica o bootstrap SQL contra o container.
 *
 * @param url Connection URL postgres-style (postgres://postgres:postgres@host:port/rls_test).
 */
export async function applyBootstrap(url: string): Promise<void> {
  const sql = postgres(url, {
    max: 1,
    prepare: false,
    onnotice: () => {
      // Suprimir NOTICEs ruidosos (ex: "role already exists" do bloco do$$).
    },
  });

  try {
    await sql.unsafe(BOOTSTRAP_SQL);
  } finally {
    await sql.end();
  }
}
