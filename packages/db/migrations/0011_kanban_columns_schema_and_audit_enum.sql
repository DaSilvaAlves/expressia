-- =====================================================================
-- meu-jarvis (Expressia) — Kanban columns schema constraints + audit enum
-- Migração: 0011_kanban_columns_schema_and_audit_enum.sql
-- Data: 2026-05-17
-- Autor: Dara (@data-engineer) — Story 3.4 T10 (drafted from Aria G3.1-G3.3
--        ratify HIGH + 2 ressalvas Dara aplicadas)
--
-- Contexto:
--   Story 3.4 (Epic 3 — Vista Kanban com colunas configuráveis) requer 4
--   alterações consolidadas ao schema kanban_columns + audit_action enum:
--
--     (a-d) 4 novos values audit_action: kanban_column.{created, updated,
--           deleted, batch_updated} — para Story 3.4 batch endpoint AC10
--           audit trail. Já existem 21 baseline + 13 valores migration 0010
--           (Story 3.2) = 34 atuais; +4 desta migration = 38 total.
--     (e)   Conversão is_done_column TEXT ('true'/'false') → BOOLEAN —
--           schema actual usa text literals (tenancy.ts:165, 0000:238). Story
--           3.4 ColumnConfigSheet usa boolean toggle native.
--     (f)   Defensive check: aborta migration se data existente tem >1 done
--           column por household (cleanup manual obrigatório antes de re-aplicar).
--     (g)   Partial unique index: máx 1 done column por household
--           (invariant DP-3.4.6 server-side enforcement).
--     (h)   Trigger CHECK count ≤ 6 colunas por household (FR9 limite UI/UX).
--           Postgres não suporta subquery correlated em CHECK directo, daí
--           BEFORE INSERT OR UPDATE trigger.
--
-- Decisões @data-engineer (validação G3.1-G3.3 Aria + ressalvas próprias):
--
--   G3.1 confirmado: single consolidated migration viable. PG 12+ permite
--        ALTER TYPE ADD VALUE em transação desde que os novos values NÃO
--        sejam USED na mesma transação. Esta migration apenas adiciona
--        values (passos a-d, zero INSERT que referencie kanban_column.*) —
--        safe. Precedent 0010 fez 13 ALTER TYPE numa tx → PASS.
--
--   G3.2 confirmado: ordem (1) ALTER TYPE × 4 primeiro idempotent +
--        (2) text→boolean + (3) defensive check + (4) partial unique +
--        (5) trigger CHECK. PASS.
--
--   G3.2 RESSALVA-1 Dara (aplicada — pré-condition do (e)):
--        ALTER COLUMN ... TYPE boolean USING is_done_column::boolean PODE
--        FALHAR se o DEFAULT 'false' (text) não puder ser cast directamente.
--        Fix: DROP DEFAULT primeiro, ALTER TYPE depois, SET DEFAULT false
--        (boolean) por último. Data existente é cast via USING expression
--        ('true'/'false' text → t/f boolean — PG aceita literais SQL).
--
--   G3.2 RESSALVA-2 Dara (aplicada — pré-condition do (g)):
--        CREATE UNIQUE INDEX falha mid-tx se já existir data violation
--        (>1 done column por household), provocando rollback completo da
--        migration. Defensive DO block ANTES do index aborta cedo com mensagem
--        clara — operador faz cleanup manual ANTES de re-aplicar.
--
--   G3.3 confirmado: RLS policies (0001_rls_policies.sql:150-168) SAFE —
--        4 policies (select_member, insert_member, update_member,
--        delete_owner_admin) usam apenas is_household_member() e
--        is_household_owner_or_admin(). ZERO referências a is_done_column.
--        Conversão text→boolean preserva NFR5 (check:rls gate continua GREEN).
--
-- Convenções (consistentes com 0009/0010):
--   - Runner apply-migrations.ts envolve cada ficheiro em sql.begin() —
--     rollback automático em erro (atomicidade garantida).
--   - `set local check_function_bodies = off` aplicado pelo runner (suporta
--     forward references em CREATE FUNCTION).
--   - IF NOT EXISTS em ALTER TYPE (idempotente — re-run safe).
--   - CREATE OR REPLACE FUNCTION + CREATE UNIQUE INDEX IF NOT EXISTS.
--
-- Trace: Story 3.4 T10 (schema constraints + audit enum), AC10 (audit trail),
--        DP-3.4.6 (batch endpoint invariants), FR9 (vista Kanban configurável).
--        Schema reference: tenancy.ts:152-173 (kanban_columns) + audit.ts:28-72
--        (auditActionEnum) + 0001_rls_policies.sql:150-168 (RLS preserved).
--        Architect ratify: docs/qa/gates/3.4-architect-dps-ratify.md (G3.1-3.3).
--        Sync app-side: apps/web/src/lib/api-helpers/audit.ts (já preparado
--        com type union + feature flag KANBAN_AUDIT_ENABLED).
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- (a-d) ALTER TYPE audit_action ADD VALUE — 4 valores kanban_column.*
-- Idempotente via IF NOT EXISTS. Notação `.` consistente com migration 0010.
-- ─────────────────────────────────────────────────────────────────────

alter type public.audit_action add value if not exists 'kanban_column.created';
alter type public.audit_action add value if not exists 'kanban_column.updated';
alter type public.audit_action add value if not exists 'kanban_column.deleted';
alter type public.audit_action add value if not exists 'kanban_column.batch_updated';

-- ─────────────────────────────────────────────────────────────────────
-- (e) Conversão is_done_column TEXT → BOOLEAN
-- Ressalva G3.2-1: drop default primeiro (cast text→boolean do default 'false'
-- pode falhar dependendo da versão PG / configuração), depois set default false.
-- Data existente: USING is_done_column::boolean — PG aceita literais 'true'/'false'.
-- ─────────────────────────────────────────────────────────────────────

alter table public.kanban_columns alter column is_done_column drop default;
alter table public.kanban_columns
  alter column is_done_column type boolean using is_done_column::boolean;
alter table public.kanban_columns alter column is_done_column set default false;

-- ─────────────────────────────────────────────────────────────────────
-- (f) Defensive check ANTES do partial unique index
-- Ressalva G3.2-2: aborta migration se algum household tiver >1 done column.
-- Evita create index fail mid-tx (que provocaria rollback completo + ruído).
-- Operador deve fazer cleanup manual (UPDATE para isolar 1 done column por
-- household) ANTES de re-aplicar a migration.
-- ─────────────────────────────────────────────────────────────────────

do $$
begin
  if exists (
    select 1
    from public.kanban_columns
    where is_done_column = true
    group by household_id
    having count(*) > 1
  ) then
    raise exception 'Migration 0011: data violation — household com múltiplas done columns. '
      'Cleanup manual obrigatório antes de re-aplicar (UPDATE kanban_columns para isolar '
      '1 done column por household).';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- (g) Partial unique index — máx 1 done column por household
-- DP-3.4.6: invariant server-side enforcement. Batch endpoint /api/kanban-columns/batch
-- valida pré-commit; este índice é a defesa em profundidade da DB (NFR5 pattern).
-- IF NOT EXISTS torna idempotente (re-run safe).
-- ─────────────────────────────────────────────────────────────────────

create unique index if not exists kanban_columns_done_unique
  on public.kanban_columns (household_id)
  where is_done_column = true;

comment on index public.kanban_columns_done_unique is
  'DP-3.4.6 invariant: máx 1 coluna is_done_column=true por household. Partial unique. Story 3.4.';

-- ─────────────────────────────────────────────────────────────────────
-- (h) Trigger CHECK count ≤ 6 colunas por household
-- FR9 limite UI/UX. Postgres não suporta subquery correlated em CHECK directo,
-- daí BEFORE INSERT OR UPDATE trigger function.
-- Mensagem PT-PT (consistente com error copy app — mapErrorToCopy).
-- ─────────────────────────────────────────────────────────────────────

create or replace function public.check_kanban_columns_max_per_household()
returns trigger
language plpgsql
as $$
begin
  if (
    select count(*)
    from public.kanban_columns
    where household_id = new.household_id
  ) > 6 then
    raise exception 'Limite de 6 colunas Kanban por household atingido (household_id: %).',
      new.household_id;
  end if;
  return new;
end;
$$;

comment on function public.check_kanban_columns_max_per_household() is
  'Trigger function: enforce máx 6 kanban_columns por household (FR9). Story 3.4.';

drop trigger if exists kanban_columns_max_check on public.kanban_columns;

create trigger kanban_columns_max_check
  before insert or update of household_id on public.kanban_columns
  for each row
  execute function public.check_kanban_columns_max_per_household();

comment on trigger kanban_columns_max_check on public.kanban_columns is
  'BEFORE INSERT/UPDATE: rejeita se household já tem 6 colunas Kanban (FR9 limite). Story 3.4.';
