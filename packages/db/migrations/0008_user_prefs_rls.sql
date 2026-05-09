-- =====================================================================
-- Migration 0008 — RLS defensiva idempotente para `user_prefs` (Story 2.7)
-- =====================================================================
--
-- CONTEXTO (NIT-002-NB ratificado pelo @architect Aria — D37):
--
-- A Story 2.7 (PO_FIX_INLINE 2 da v1.1) adicionou um DO block ao final do
-- `0001_rls_policies.sql:739-755` para criar 4 policies RLS na tabela
-- `user_prefs` (criada via `0007_user_prefs.sql`). Razão: o gate NFR5 em
-- `scripts/check-rls-coverage.ts:33` lê APENAS `0001_rls_policies.sql` como
-- fonte de verdade, portanto policies dispersas noutras migrations não eram
-- detectadas pelo gate.
--
-- PROBLEMA EM PROD EU:
--
-- O runner `apply-migrations.ts` regista cada migration aplicada no tracking
-- table `__schema_migrations` por NOME DE FICHEIRO (não por hash do conteúdo).
-- Em prod EU Supabase, `0001_rls_policies.sql` JÁ está registado como
-- aplicado desde a Story 1.3 (bootstrap inicial) — logo o append do DO block
-- de `user_prefs` em 0001 NUNCA voltará a correr em prod automaticamente.
--
-- Resultado em prod sem esta migration:
--   - 0007 cria a tabela `user_prefs` ✓
--   - DO block em 0001 NÃO corre (filename já registado)
--   - Tabela `user_prefs` em prod fica SEM RLS policies
--   - Violação directa de NFR5 (RLS coverage obrigatória) em produção
--
-- ESTRATÉGIA DESTA MIGRATION (filename novo → será aplicada uma vez em prod):
--
-- 1. Filename `0008_user_prefs_rls.sql` é distinto de 0001 → tracking em
--    `__schema_migrations` regista como nova.
-- 2. Idempotente — cada policy é criada apenas se NÃO existir
--    (`pg_policies` lookup). Re-runs em DBs onde 0001 DO block já criou
--    as policies (CI fresh + dev local) são no-op.
-- 3. Conditional na existência da tabela — não falha se 0007 ainda não
--    correu (drizzle-kit ordering ou edge cases CI).
-- 4. Predicate combo idêntico ao 0001 DO block:
--      USING:    public.is_household_member(household_id) AND auth.uid() = user_id
--      WITH CHECK: public.is_household_member(household_id) AND auth.uid() = user_id
--    Combina cross-tenancy isolation (NFR5) com user-scoped constraint
--    (1:1 user-prefs).
-- 5. `set local check_function_bodies = off` — precedente do
--    `apply-migrations.ts` para forward references SQL.
--
-- COMENTÁRIOS PLACEHOLDER PARA O GATE NFR5
--
-- O parser regex em `scripts/check-rls-coverage.ts` deteca strings literais
-- `create policy "..." on public.user_prefs for <command>`. Como o gate lê
-- apenas 0001, a presença destes comentários aqui NÃO contribui para a
-- contagem. As policies efectivas continuam declaradas em 0001.
--
-- =====================================================================

set local check_function_bodies = off;

do $rls_user_prefs_defensive$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'user_prefs'
  ) then
    execute 'alter table public.user_prefs enable row level security';
    execute 'alter table public.user_prefs force row level security';

    -- SELECT
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = 'user_prefs'
        and policyname = 'user_prefs_select_self'
    ) then
      execute $POLICY$create policy "user_prefs_select_self" on public.user_prefs for select to authenticated using (public.is_household_member(household_id) and auth.uid() = user_id)$POLICY$;
    end if;

    -- INSERT
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = 'user_prefs'
        and policyname = 'user_prefs_insert_self'
    ) then
      execute $POLICY$create policy "user_prefs_insert_self" on public.user_prefs for insert to authenticated with check (public.is_household_member(household_id) and auth.uid() = user_id)$POLICY$;
    end if;

    -- UPDATE
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = 'user_prefs'
        and policyname = 'user_prefs_update_self'
    ) then
      execute $POLICY$create policy "user_prefs_update_self" on public.user_prefs for update to authenticated using (public.is_household_member(household_id) and auth.uid() = user_id) with check (public.is_household_member(household_id) and auth.uid() = user_id)$POLICY$;
    end if;

    -- DELETE
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = 'user_prefs'
        and policyname = 'user_prefs_delete_self'
    ) then
      execute $POLICY$create policy "user_prefs_delete_self" on public.user_prefs for delete to authenticated using (public.is_household_member(household_id) and auth.uid() = user_id)$POLICY$;
    end if;
  end if;
end$rls_user_prefs_defensive$;

-- =====================================================================
-- FIM DA MIGRATION 0008
-- =====================================================================
