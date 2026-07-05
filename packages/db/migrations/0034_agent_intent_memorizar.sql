-- =====================================================================
-- 0034_agent_intent_memorizar.sql
-- =====================================================================
-- Story M-1 — Capturar e guardar memória explícita (primeira story da epic
-- v2 "Memória rica"). Âmbito: D1+D2 do brief do @pm (captura explícita +
-- tabela nova). Usar a memória (M-2), no brief (M-3) e esquecer (M-4) ficam
-- para stories seguintes.
--
-- Este ficheiro faz DUAS coisas (padrão análogo à 0029 — tabela nova + trigger;
-- e à 0030-0033 — valor novo no enum agent_intent):
--   1. ALTER TYPE agent_intent ADD VALUE 'memorizar' (idempotente).
--   2. CREATE TABLE public.jarvis_memories — texto livre de memória por
--      household, DISTINTA de jarvis_facts (key-value, reservada a settings
--      estruturados como timezone/brief_tone). Cada memória é uma frase de
--      preferência/facto pessoal ditada pelo utilizador.
--
-- [PO-FIX-1] IMPORTANTE — as 4 RLS policies de jarvis_memories vivem em DOIS
-- sítios (duplicação segura e idempotente):
--   (a) AQUI na 0034, logo APÓS o CREATE TABLE (APLICAÇÃO REAL). Garante que
--       (i) o teste RLS dedicado (AC9) passa em Testcontainers — a tabela e as
--       policies nascem no mesmo ficheiro, ordem garantida — e (ii) chegam a
--       produção AUTOMATICAMENTE via `db:migrate` (0034 é ficheiro novo, não
--       sofre o skip da 0001 já registada). O passo manual do SQL Editor da
--       lição J-3 DEIXA de ser necessário.
--   (b) No 0001_rls_policies.sql via DO-block condicional `$rls_jarvis_memories$`
--       (SÓ para o gate estático `scripts/check-rls-coverage.ts:33`, que lê
--       APENAS a 0001). Em runtime esse bloco é no-op (guard `if exists` FALSE
--       quando a 0001 corre — a tabela ainda não existe; 0001 corre antes da
--       0034). O `drop policy if exists` garante idempotência se ambos correrem.
--
-- Predicate das policies: household_id = public.current_household_id()
-- (cross-tenancy, NFR5). Predicate idêntico a jarvis_facts/tasks.
--
-- Total tabelas pós-0034: 32 (era 31). Policies: +4.
--
-- Trace: Story M-1 AC1/AC2, brief epic v2-memoria-rica (D1+D2), PRD-Jarvis §5/§9.
-- =====================================================================

set local check_function_bodies = off;

-- ─── 1. Enum agent_intent — +1 valor 'memorizar' ────────────────────
-- ADD VALUE IF NOT EXISTS é idempotente. NÃO usamos o valor na mesma
-- transacção (a jarvis_memories não referencia o enum) — seguro no runner
-- (precedente 0030-0033).

alter type agent_intent add value if not exists 'memorizar';

-- ─── 2. jarvis_memories ──────────────────────────────────────────────

create table if not exists public.jarvis_memories (
  id                  uuid        not null default gen_random_uuid() primary key,
  household_id        uuid        not null references public.households(id) on delete cascade,
  created_by_user_id  uuid        not null references auth.users(id) on delete restrict,
  content             text        not null,
  source              text        not null default 'explicit',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.jarvis_memories is
  'Memórias explícitas de texto livre por household (Story M-1) — factos/preferências ditados pelo utilizador ("lembra-te que odeio reuniões antes das 10h"). Distinta de jarvis_facts (key-value). `source` default ''explicit'' (sem CHECK rígido — permite ''inferred'' futuro em v2.x sem nova migration).';

comment on column public.jarvis_memories.content is
  'Texto da memória tal-e-qual ditado pelo utilizador (sem parsing/estruturação). Conteúdo pessoal sensível (risco R2 do brief) — nunca em span attributes OTel.';

comment on column public.jarvis_memories.source is
  'Origem da memória: ''explicit'' (captura via chat, M-1) ou ''inferred'' (inferência automática, v2.x). Sem CHECK para não forçar migration futura.';

create index if not exists jarvis_memories_household_id_idx
  on public.jarvis_memories (household_id);

-- ─── 3. Trigger updated_at (jarvis_memories) ────────────────────────
-- Reutiliza o helper canónico public.set_updated_at() (0000_initial_schema.sql).
-- NÃO usar update_updated_at_column() — gotcha de J-2 (PO-MUST-FIX-1).

drop trigger if exists jarvis_memories_set_updated_at on public.jarvis_memories;

create trigger jarvis_memories_set_updated_at
  before update on public.jarvis_memories
  for each row
  execute function public.set_updated_at();

-- ─── 4. RLS policies (APLICAÇÃO REAL — PO-FIX-1 alínea (a)) ──────────
-- 4 policies (SELECT/INSERT/UPDATE/DELETE), predicate household_id =
-- public.current_household_id(). Bloco idêntico ao replicado em 0001 (só que
-- aqui DISPARA porque a tabela já existe neste ponto). `drop policy if exists`
-- antes de cada `create policy` garante idempotência (re-run seguro).

do $rls_jarvis_memories$
begin
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'jarvis_memories') then
    execute 'alter table public.jarvis_memories enable row level security';
    execute 'alter table public.jarvis_memories force row level security';

    execute 'drop policy if exists "jarvis_memories_select" on public.jarvis_memories';
    execute 'drop policy if exists "jarvis_memories_insert" on public.jarvis_memories';
    execute 'drop policy if exists "jarvis_memories_update" on public.jarvis_memories';
    execute 'drop policy if exists "jarvis_memories_delete" on public.jarvis_memories';

    execute $POLICY$create policy "jarvis_memories_select" on public.jarvis_memories for select to authenticated using (household_id = public.current_household_id())$POLICY$;
    execute $POLICY$create policy "jarvis_memories_insert" on public.jarvis_memories for insert to authenticated with check (household_id = public.current_household_id())$POLICY$;
    execute $POLICY$create policy "jarvis_memories_update" on public.jarvis_memories for update to authenticated using (household_id = public.current_household_id()) with check (household_id = public.current_household_id())$POLICY$;
    execute $POLICY$create policy "jarvis_memories_delete" on public.jarvis_memories for delete to authenticated using (household_id = public.current_household_id())$POLICY$;
  end if;
end$rls_jarvis_memories$;

-- =====================================================================
-- FIM DA MIGRAÇÃO 0034
-- =====================================================================
-- NOTA (PO-FIX-1): as mesmas 4 policies existem TAMBÉM em
-- 0001_rls_policies.sql (DO-block `$rls_jarvis_memories$`), mas SÓ para o gate
-- estático `check:rls` as detectar (o parser lê apenas a 0001). A aplicação
-- REAL é a deste ficheiro. Em prod, `db:migrate` da 0034 cria tabela + policies
-- numa só operação — sem passo manual no Supabase SQL Editor.
-- =====================================================================
