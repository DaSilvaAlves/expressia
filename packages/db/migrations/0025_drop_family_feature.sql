-- =====================================================================
-- meu-jarvis (Expressia) — Remoção da feature visível "Família" (partilha
--   multi-membro: convites + aceitação de convite).
-- Migração: 0025_drop_family_feature.sql
-- Data: 2026-06-19
-- Autor: Dex (@dev) — directiva do dono (Eurico): remover por completo a
--        funcionalidade visível de "Família"/partilha da app.
--
-- ÂMBITO (fronteira absoluta):
--   Esta migração remove APENAS os objectos de base de dados EXCLUSIVOS da
--   feature de partilha multi-membro:
--     - função SQL `public.accept_invite(...)` (aceitação de convite);
--     - tabela `public.household_invites` (+ as suas policies/índices, via
--       `cascade`).
--
--   NÃO toca — por desenho — em nada que sustente o multi-tenancy silencioso:
--     - `public.households` (agregado raiz / tenant) — INTACTA;
--     - `public.household_members` (pertença do utilizador ao seu household) —
--       INTACTA;
--     - a coluna `household_id` em qualquer tabela de domínio — INTACTA;
--     - as RLS policies de todas as outras tabelas — INTACTAS;
--     - o trigger `handle_new_user` (cria 1 household por utilizador no registo)
--       — INTACTO.
--
--   Cada utilizador continua com o seu household único como tenant invisível.
--   Tarefas, Finanças, Visão, Agente e o export RGPD continuam a funcionar
--   exactamente como antes.
--
-- IDEMPOTÊNCIA: usa `drop ... if exists` — re-correr é seguro (no-op).
-- =====================================================================

-- 1) Função de aceitação de convite. Existiu em duas assinaturas ao longo das
--    migrações 0020 (text) e 0022 (text, uuid). Removemos ambas por segurança.
drop function if exists public.accept_invite(text, uuid);
drop function if exists public.accept_invite(text);

-- 2) Tabela de convites. `cascade` remove as 4 policies RLS
--    (household_invites_select_household_or_invited / _insert_owner_admin /
--    _update_owner_admin / _delete_owner_admin), os índices
--    (household_invites_household_idx / _email_idx / _token_idx) e a constraint
--    unique parcial (household_invites_unique_pending). Nenhuma outra tabela
--    referencia `household_invites` por FK, logo o cascade não alastra a dados
--    de domínio.
drop table if exists public.household_invites cascade;
