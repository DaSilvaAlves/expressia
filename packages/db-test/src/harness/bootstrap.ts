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
  -- supabase_auth_admin: role usado pelo Supabase Auth para invocar Auth Hooks
  -- (ex: custom_access_token_hook em migration 0002). A migração 0002 faz
  -- 'grant ... to supabase_auth_admin'; sem este role criado, a aplicação
  -- da migration falha com "role does not exist" (Postgres 42704).
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin nologin;
  end if;
end
$$;

-- Schema auth (Supabase nativo).
create schema if not exists auth;

-- auth.users mínima — apenas as colunas que as FKs do schema de produção referenciam.
-- Só id é estritamente necessário para FK; email é útil para uma das policies
-- (household_invites_select_household_or_invited usa auth.users.email).
-- raw_user_meta_data: o trigger handle_new_user (migração 0019) lê o nome do
-- utilizador daqui (options.data.name no signup) → paridade com a auth.users
-- real do Supabase, que tem esta coluna jsonb. Default '{}' para que inserts
-- sem metadata (insert into auth.users (id, email)) continuem a funcionar.
create table if not exists auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
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

-- service_role precisa de privilégios completos para representar o servidor
-- (Inngest jobs, Stripe webhooks, etc.). Em Supabase isto vem por default;
-- replicamos aqui para que os testes possam validar fluxos como o setter de
-- reverted_at via service_role no agent_runs (NFR9 / Story 2.1 AC6).
-- O role já tem bypassrls (criado acima); aqui adicionamos as grants de table-level.
grant usage on schema public to service_role;
alter default privileges in schema public grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public grant usage on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;
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
