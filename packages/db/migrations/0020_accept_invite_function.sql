-- =====================================================================
-- meu-jarvis (Expressia) — SQL function: accept_invite()
-- Migração: 0020_accept_invite_function.sql
-- Data: 2026-06-01
-- Autor: Dex (@dev) — Story 6.7 (Convite e remoção de membros + limites por plano)
--
-- Contexto:
--   A tabela `household_invites` (0000) + as 4 RLS policies (0001) já existem.
--   FALTAVA a função `accept_invite()` — referida nos comentários de 0000:209,
--   0001:141 e tenancy.ts:113 ("limites enforced em SQL function accept_invite()
--   SECURITY DEFINER"), mas nunca implementada. Esta migração cria-a.
--
--   `accept_invite(p_token)` é chamada pela rota /aceitar-convite/{token} (via
--   getDb(), role authenticated). Corre SECURITY DEFINER para poder:
--     - ler `auth.users` (validar o email do convidado vs auth.uid());
--     - inserir membership cross-household de forma CONTROLADA (a RLS de
--       household_members permite self-insert — 0001:87-92 — mas a validação de
--       token+limite+email tem de ser atómica e fora do alcance da UI).
--
--   Limites de membros por plano (FR27, epic-6 §2/§5):
--     Pessoal=1 · Família=4 · Pro=10 · Free=1.
--   [DEV-DECISION D-6.7.1] Free=1: o epic-6/FR27 só lista os 3 planos pagos;
--     Free=1 é o limite single-user coerente (architecture §6.4 — trial dá
--     'familia', logo o caso Free só ocorre após downgrade, fora desta story).
--   [DEV-DECISION D-6.7.2] email-match: exige invite.email == email(auth.uid())
--     (convite nominal — segurança). Erro tipado INVITE_EMAIL_MISMATCH com
--     mensagem PT-PT clara na app.
--
--   Concorrência (R-6.5): a contagem de membros corre com `for update` no
--   household (lock) dentro da mesma transação do insert → dois aceites
--   simultâneos não excedem o limite (defesa em profundidade vs UI).
--
--   Erros tipados (raise exception '<CODE>') mapeados para PT-PT na app:
--     INVITE_NOT_FOUND · INVITE_ALREADY_ACCEPTED · INVITE_EXPIRED ·
--     AUTH_REQUIRED · INVITE_EMAIL_MISMATCH · ALREADY_MEMBER · MEMBER_LIMIT_REACHED.
--
-- Idempotência: `create or replace function` — re-aplicação segura. Segunda
--   chamada com o mesmo token (já aceite) falha com INVITE_ALREADY_ACCEPTED.
--
-- Trace: Story 6.7 AC1; FR27; architecture §5.3/§6.4; R-6.5; tenancy.ts:113;
--        audit_action enum (0000:157-163 — household_invite_accepted já existe).
-- =====================================================================

create or replace function public.accept_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.household_invites%rowtype;
  v_user_id uuid;
  v_user_email text;
  v_user_name text;
  v_plan public.plan_tier;
  v_limit integer;
  v_count integer;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  -- 1. Localizar o convite e bloquear a row (evita dupla aceitação concorrente).
  select * into v_invite
  from public.household_invites
  where token = p_token
  for update;

  if not found then
    raise exception 'INVITE_NOT_FOUND';
  end if;

  -- 2. Estado do convite.
  if v_invite.accepted_at is not null then
    raise exception 'INVITE_ALREADY_ACCEPTED';
  end if;
  if v_invite.expires_at <= now() then
    raise exception 'INVITE_EXPIRED';
  end if;

  -- 3. Email do convite tem de corresponder ao do utilizador autenticado (D-6.7.2).
  select email, nullif(trim(raw_user_meta_data->>'name'), '')
    into v_user_email, v_user_name
  from auth.users
  where id = v_user_id;

  if v_user_email is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if lower(v_invite.email) <> lower(v_user_email) then
    raise exception 'INVITE_EMAIL_MISMATCH';
  end if;

  -- 4. Já é membro deste household? (evita violar a PK composta.)
  if exists (
    select 1 from public.household_members
    where household_id = v_invite.household_id
      and user_id = v_user_id
  ) then
    raise exception 'ALREADY_MEMBER';
  end if;

  -- 5. Limite de membros por plano — lock no household (R-6.5, defesa em profundidade).
  select plan into v_plan
  from public.households
  where id = v_invite.household_id
  for update;

  v_limit := case v_plan
    when 'pessoal' then 1
    when 'familia' then 4
    when 'pro' then 10
    else 1 -- 'free' (D-6.7.1)
  end;

  select count(*) into v_count
  from public.household_members
  where household_id = v_invite.household_id;

  if v_count >= v_limit then
    raise exception 'MEMBER_LIMIT_REACHED';
  end if;

  -- 6. Inserir membership (display_name herda o nome do signup, se houver).
  insert into public.household_members (household_id, user_id, role, display_name)
  values (v_invite.household_id, v_user_id, v_invite.role, v_user_name);

  -- 7. Marcar o convite como aceite.
  update public.household_invites
  set accepted_at = now(),
      accepted_by_user_id = v_user_id
  where id = v_invite.id;

  -- 8. Auditoria (NFR9) — household_invite_accepted já existe no enum (0000).
  insert into public.audit_log (
    household_id, user_id, action, entity_table, entity_id, after_state
  )
  values (
    v_invite.household_id, v_user_id, 'household_invite_accepted',
    'household_invites', v_invite.id,
    jsonb_build_object(
      'invite_id', v_invite.id,
      'email', v_invite.email,
      'role', v_invite.role,
      'accepted_via', 'accept_invite() SECURITY DEFINER'
    )
  );

  return v_invite.household_id;
end;
$$;

comment on function public.accept_invite(text) is
  'Aceita um convite por token: valida estado/expiração/email/limite-de-plano e cria household_members(auth.uid()) atomicamente (lock vs R-6.5). SECURITY DEFINER. Story 6.7 (FR27). Erros tipados: INVITE_NOT_FOUND/ALREADY_ACCEPTED/EXPIRED/EMAIL_MISMATCH/ALREADY_MEMBER, MEMBER_LIMIT_REACHED, AUTH_REQUIRED.';

-- A função é invocada via getDb() (role authenticated) — sem este GRANT a
-- chamada falha com "permission denied for function accept_invite".
grant execute on function public.accept_invite(text) to authenticated;
