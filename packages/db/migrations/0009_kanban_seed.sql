-- =====================================================================
-- meu-jarvis (Expressia) — Seed defaults Kanban PT-PT por household
-- Migração: 0009_kanban_seed.sql
-- Data: 2026-05-15
-- Autor: Dex (@dev) — implementação Story 3.1 AC2-AC4 + AC8
--
-- Contexto:
--   Story 3.1 (Epic 3 — Módulo Tarefas) requer que cada household tenha
--   3 colunas Kanban default em PT-PT europeu ao primeiro acesso à vista
--   3.4 (FR9 vista Kanban). Para evitar onboarding manual, esta migração:
--
--     1. Cria função idempotente `seed_household_kanban_defaults(p_household_id)`
--        que insere 3 colunas: 'A fazer' (0), 'Em curso' (1), 'Concluído' (2).
--     2. Cria trigger AFTER INSERT em `households` que chama a função para
--        cada household novo (signup, accept_invite, etc.) — zero código app.
--     3. Backfill: aplica a função a TODOS os households existentes (idempotente
--        via ON CONFLICT — re-runs são safe e não duplicam).
--
-- Decisões (DP4 — Eurico aceitou recomendação Morgan A silenciosamente per PO
-- Validation Block):
--   DP4: 3 colunas PT-PT europeu — NÃO 'To do/Doing/Done' (EN), NÃO
--        'A fazer/Em progresso/Concluído' (PT-BR). 'Em curso' é o termo PT-PT
--        correcto (não 'Em progresso' que é PT-BR/anglicismo). AC8 enforced.
--
-- Constraints utilizadas:
--   - unique (household_id, sort_order) — pre-existe em tenancy.ts:171
--     (`kanban_columns_unique_order`). Permite `ON CONFLICT ... DO NOTHING`
--     para idempotência sem race conditions.
--   - kanban_columns.is_done_column é TEXT (não boolean) — schema actual
--     usa 'true'/'false' literais (tenancy.ts:165 DEFAULT 'false').
--
-- Convenções (consistentes com 0003_auth_user_trigger.sql):
--   - `security definer` + `set search_path = public` — pattern handle_new_user.
--   - `language plpgsql` — necessário para variáveis + DECLARE/BEGIN/END no backfill.
--   - Idempotência: `create or replace function` + `drop trigger if exists`.
--   - `set local check_function_bodies = off` no início — consistente com
--     `apply-migrations.ts` runner (suporta forward references).
--
-- Trace: PRD §6.3 FR9 (vista Kanban configurável), Story 3.1 AC2, AC3, AC4, AC8.
--        Schema reference: tenancy.ts:152-173 (kanban_columns table),
--        0001_rls_policies.sql:150-168 (RLS policies pre-existing incluindo
--        variant delete_owner_admin).
-- =====================================================================

set local check_function_bodies = off;

-- ─────────────────────────────────────────────────────────────────────
-- 1. FUNÇÃO seed_household_kanban_defaults
-- ─────────────────────────────────────────────────────────────────────

create or replace function public.seed_household_kanban_defaults(p_household_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- AC2(a) — Inserir 3 colunas PT-PT defaults na ordem 0/1/2.
  -- AC2(b) — Idempotente via ON CONFLICT (household_id, sort_order) DO NOTHING.
  --          O constraint unique `kanban_columns_unique_order` existe per
  --          tenancy.ts:171 — re-runs em households com colunas existentes
  --          NÃO duplicam, NÃO actualizam (preserva customizações do user).
  -- AC8 — PT-PT estrito: 'Em curso' (NÃO 'Em progresso' que é PT-BR).
  -- is_done_column TEXT — valores literais 'true'/'false' (schema actual).
  insert into public.kanban_columns (household_id, name, sort_order, color, is_done_column)
  values
    (p_household_id, 'A fazer',   0, '#6B7280', 'false'),
    (p_household_id, 'Em curso',  1, '#3B82F6', 'false'),
    (p_household_id, 'Concluído', 2, '#10B981', 'true')
  on conflict (household_id, sort_order) do nothing;
end;
$$;

comment on function public.seed_household_kanban_defaults(uuid) is
  'Insere 3 kanban_columns default PT-PT (A fazer/Em curso/Concluído) num household. Idempotente via ON CONFLICT — safe re-run, preserva customizações do user. Story 3.1 AC2.';

-- ─────────────────────────────────────────────────────────────────────
-- 2. TRIGGER trigger_seed_kanban_after_household_insert
-- ─────────────────────────────────────────────────────────────────────
-- AC4 — Households criados via signup/accept_invite/insert directo recebem
--       3 colunas automaticamente sem código aplicação.

create or replace function public.tr_seed_kanban_for_new_household()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.seed_household_kanban_defaults(new.id);
  return new;
end;
$$;

comment on function public.tr_seed_kanban_for_new_household() is
  'Trigger function: chama seed_household_kanban_defaults para cada novo household. Story 3.1 AC4.';

drop trigger if exists trigger_seed_kanban_after_household_insert on public.households;

create trigger trigger_seed_kanban_after_household_insert
  after insert on public.households
  for each row execute procedure public.tr_seed_kanban_for_new_household();

comment on trigger trigger_seed_kanban_after_household_insert on public.households is
  'AFTER INSERT em households: cria 3 kanban_columns default PT-PT automaticamente. Idempotente via ON CONFLICT na função alvo. Story 3.1 AC4.';

-- ─────────────────────────────────────────────────────────────────────
-- 3. BACKFILL — households existentes recebem defaults retroactively
-- ─────────────────────────────────────────────────────────────────────
-- AC3 — Após esta migração aplicar, TODOS os households existentes na DB
--       (criados em Story 1.3 seed + qualquer subsequente) têm exactamente
--       3 kanban_columns default. Query DoD verifica 0 rows non-conforming.
-- Idempotente — re-run em households com colunas pre-existing não duplica
-- (ON CONFLICT da função absorve duplicates).

do $$
declare
  h record;
  total_processed integer := 0;
begin
  for h in select id from public.households loop
    perform public.seed_household_kanban_defaults(h.id);
    total_processed := total_processed + 1;
  end loop;

  raise notice 'Story 3.1 — backfill kanban defaults: % households processados', total_processed;
end;
$$;
