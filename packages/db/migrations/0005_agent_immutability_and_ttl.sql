-- =====================================================================
-- 0005_agent_immutability_and_ttl.sql
-- =====================================================================
-- Hardening do schema agent (Story 2.1):
--   1. Trigger BEFORE UPDATE em `agent_runs` que bloqueia mutação após
--      estado terminal (success/reverted/failed) — NFR9 audit imutável.
--      Excepção: role `service_role` continua a poder fazer UPDATE
--      (necessário para job Inngest de purge mensal e para o caller que
--      marca `reverted_at` ao executar undo via service-side).
--   2. DEFAULT em `agent_reverse_ops.expires_at` = now() + interval
--      '30 seconds' (FR6 — janela de undo). Camada de segurança extra:
--      o caller (pipeline executor da Story 2.5) já passa o valor
--      explicitamente, mas o DEFAULT garante que uma omissão acidental
--      não corrompe a invariante.
--
-- IMPORTANTE: esta migration NÃO altera schema (zero novas colunas/tabelas)
-- — apenas adiciona enforcement. RLS coverage gate (NFR5) mantém-se em
-- 26 tabelas / 104 policies.
--
-- Trace: PRD FR6, NFR9; architecture §4.1 (audit imutável), §4.5 (undo TTL).
-- =====================================================================

-- ─── 1. agent_reverse_ops.expires_at DEFAULT (FR6) ───────────────────

alter table public.agent_reverse_ops
  alter column expires_at set default now() + interval '30 seconds';

comment on column public.agent_reverse_ops.expires_at is
  'TTL absoluto da janela de undo (FR6 — 30s). DEFAULT now() + interval ''30 seconds''. O caller pode override mas é fortemente desaconselhado.';

-- ─── 2. Trigger immutability em agent_runs (NFR9) ────────────────────
--
-- Estados terminais (post-execução): success, reverted, failed.
-- Após qualquer destes, o row é audit imutável e não pode ser modificado
-- excepto via service_role (purge job + reverted_at setter Inngest).
--
-- Pattern: BEFORE UPDATE FOR EACH ROW WHEN (OLD.status IN (...)) →
-- raise exception se current_user <> 'service_role'.
--
-- Nota técnica: `current_user` em Postgres devolve o role efectivo da
-- sessão. No Supabase JWT flow, é `authenticated` (set via SET LOCAL ROLE
-- pelo postgrest/Supavisor). Em jobs Inngest é `service_role`. Em
-- migrations / DBA ops é `postgres` (superuser).
--
-- Estratégia: bloquear APENAS o role aplicacional (`authenticated` + `anon`).
-- Tudo o resto (service_role, postgres superuser, supabase_auth_admin) é
-- permitido — service_role para o purge job NFR9 e setter de reverted_at,
-- postgres para migrations e DBA ops manuais (correcção de dados, retention).

create or replace function public.prevent_update_terminal_agent_runs()
returns trigger
language plpgsql
security invoker
as $$
begin
  -- Apenas roles aplicacionais (authenticated + anon) são bloqueados.
  -- service_role (bypassrls), postgres (superuser) e outros roles privilegiados
  -- podem actualizar mesmo após terminal — necessário para purge NFR9 e
  -- correcções operacionais.
  if current_user in ('authenticated', 'anon') then
    raise exception 'agent_run % imutável após estado terminal (status=%). NFR9 audit imutável — utilizadores aplicacionais não podem mutar audit log.',
      old.id, old.status
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.prevent_update_terminal_agent_runs() is
  'Trigger function: bloqueia UPDATE em agent_runs com status terminal (success/reverted/failed) excepto via service_role. NFR9 audit imutável.';

-- Drop + create trigger (idempotente em re-runs do migration runner).
drop trigger if exists trg_agent_runs_immutability on public.agent_runs;

create trigger trg_agent_runs_immutability
  before update on public.agent_runs
  for each row
  when (old.status in ('success', 'reverted', 'failed'))
  execute function public.prevent_update_terminal_agent_runs();

comment on trigger trg_agent_runs_immutability on public.agent_runs is
  'NFR9: bloqueia mutação de agent_runs após estado terminal. service_role bypassa para purge + setters internos.';

-- =====================================================================
-- Notas de design (para futuros maintainers):
-- =====================================================================
-- Q: Porquê trigger e não policy RLS column-level?
-- A: Postgres não suporta column-level RLS nativo. Para enforçar "só
--    podes mudar status/response_summary/reverted_at quando OLD.status
--    não é terminal", trigger é a única opção declarativa.
--
-- Q: Porquê não bloquear TODOS os UPDATEs e exigir service_role sempre?
-- A: O fluxo normal do pipeline (Story 2.5) actualiza status: classifying
--    → pending_preview → confirmed → executing → success. Esses UPDATEs
--    pré-terminais correm via authenticated (utilizador real). Só após
--    chegar a terminal é que a row fica congelada.
--
-- Q: Porquê não usar agent_tool_calls como tabela separada?
-- A: O schema actual (Story 1.3) usa coluna JSONB tool_calls em
--    agent_runs. Manter coerente com Article IV (No Invention) — não
--    inventar tabelas que não existem.
-- =====================================================================
