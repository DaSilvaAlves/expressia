-- =====================================================================
-- meu-jarvis (Expressia) — Trigger SQL: guarda de FK cross-tenant em finanças
-- Migração: 0023_finance_cross_tenant_fk_guard.sql
-- Data: 2026-06-14
-- Autora: Dara (@data-engineer) — hardening NFR5 (defesa em profundidade, camada DB)
--
-- Contexto / causa-raiz:
--   A RLS de `transactions` (e irmãs) valida o `household_id` DA PRÓPRIA ROW
--   (WITH CHECK = current_household_id()), mas NÃO valida que o `account_id` /
--   `card_id` referenciado pertence ao MESMO household. O FK
--   `transactions.account_id -> accounts.id` aceita QUALQUER conta existente,
--   mesmo de outro agregado. Foi a origem das 3 transacções cross-tenant que o
--   B2 apagou (ver memória cross_tenant_legacy_transactions).
--
--   O CHECK `transactions_account_or_card` só garante "conta OU cartão
--   preenchido", NÃO a pertença ao household. Idem para `recurrences` e o seu
--   `recurrences_account_or_card`. Os `installments` apontam para um cartão
--   (`card_id NOT NULL`) e os `cards` apontam para uma conta
--   (`account_id NOT NULL`) — todos os mesmos vectores.
--
-- O que esta migração instala (camada DB, fecha o buraco para SEMPRE,
-- independente do caller — app-level, agente AI, script ou job):
--   1. Função `public.assert_finance_ref_same_household()` — trigger BEFORE
--      INSERT/UPDATE que, para cada referência preenchida (account_id / card_id),
--      confirma que o household_id da entidade referenciada == NEW.household_id.
--      Em violação faz `raise exception ... using errcode = '23P51'` (SQLSTATE
--      custom na classe 23 = integrity_constraint_violation; o app-level mapeia
--      para PT-PT accionável — ver secção "Contrato app-level" abaixo).
--   2. Triggers que invocam essa função em:
--        - transactions  (account_id, card_id)
--        - recurrences   (account_id, card_id)
--      e uma função análoga para a relação 1:1 obrigatória:
--        - cards         (account_id  -> mesmo household que o cartão)
--        - installments  (card_id     -> mesmo household que a parcela)
--
-- SECURITY DEFINER: a função lê `accounts`/`cards` ignorando RLS (segue o
--   padrão de `current_household_id()` / `is_household_member()` da 0000). Isto
--   é necessário e seguro: quando o INSERT corre sob role `authenticated` (RLS
--   activo), sem SECURITY DEFINER a função só "veria" linhas do household do
--   utilizador e devolveria uma mensagem confusa ("conta não existe") em vez de
--   "conta pertence a outro household". A função NÃO devolve dados ao caller —
--   só compara household_id e ou passa ou levanta excepção. Sem buracos novos.
--   `set search_path = public` previne shadowing malicioso de objectos.
--
-- Contrato app-level (para o @dev mapear a mensagem PT-PT):
--   SQLSTATE / ERRCODE = '23P51'  (custom, classe integrity_constraint_violation)
--   MESSAGE (PT-PT)    = 'A conta indicada não pertence ao agregado familiar.'
--                     ou 'O cartão indicado não pertence ao agregado familiar.'
--   Recomendação: o caller apanha SQLSTATE '23P51' e devolve um
--   ToolExecutionError PT-PT accionável (1.ª rede app-enforced, SEC-1).
--
-- NFR5 / RLS Coverage Gate: esta migração NÃO cria tabelas novas — só funções
--   e triggers. `scripts/check-rls-coverage.ts` analisa schema TS + 0001 e não
--   é afectado. Gate permanece verde.
--
-- Idempotência: `create or replace function` + `drop trigger if exists` antes
--   de `create trigger`. Re-aplicação segura.
--
-- Trace: NFR5 (defesa em profundidade), handoff
--   mj-handoff-smoke-pass-next-account-id-validation-20260614 (Fase 0, opção B),
--   memória cross_tenant_legacy_transactions; finance.ts (transactions, accounts,
--   cards, recurrences, installments).
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- 1. Função genérica: valida account_id / card_id de NEW contra NEW.household_id
--    Usada por `transactions` e `recurrences` (ambas têm account_id + card_id
--    opcionais, com CHECK "pelo menos um").
-- ─────────────────────────────────────────────────────────────────────

create or replace function public.assert_finance_ref_same_household()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ref_household_id uuid;
begin
  -- 1. Validar a conta referenciada, se houver.
  if new.account_id is not null then
    select a.household_id into ref_household_id
    from public.accounts a
    where a.id = new.account_id;

    -- FK garante que a conta existe; este ramo é defensivo (race / FK em falta).
    if ref_household_id is null then
      raise exception
        'A conta indicada não existe (account_id=%).', new.account_id
        using errcode = '23P51';
    end if;

    if ref_household_id <> new.household_id then
      raise exception
        'A conta indicada não pertence ao agregado familiar (account_id=% pertence a household %, esperado %).',
        new.account_id, ref_household_id, new.household_id
        using errcode = '23P51';
    end if;
  end if;

  -- 2. Validar o cartão referenciado, se houver.
  if new.card_id is not null then
    select c.household_id into ref_household_id
    from public.cards c
    where c.id = new.card_id;

    if ref_household_id is null then
      raise exception
        'O cartão indicado não existe (card_id=%).', new.card_id
        using errcode = '23P51';
    end if;

    if ref_household_id <> new.household_id then
      raise exception
        'O cartão indicado não pertence ao agregado familiar (card_id=% pertence a household %, esperado %).',
        new.card_id, ref_household_id, new.household_id
        using errcode = '23P51';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.assert_finance_ref_same_household() is
  'Trigger BEFORE INSERT/UPDATE (transactions, recurrences): garante que account_id/card_id referenciados pertencem ao MESMO household da row. Levanta SQLSTATE 23P51 em violação cross-tenant. SECURITY DEFINER para ler accounts/cards ignorando RLS. NFR5 defesa em profundidade.';

-- ─────────────────────────────────────────────────────────────────────
-- 2. Função: valida cards.account_id contra cards.household_id
--    (cartão aponta SEMPRE para uma conta — account_id NOT NULL).
-- ─────────────────────────────────────────────────────────────────────

create or replace function public.assert_card_account_same_household()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  acc_household_id uuid;
begin
  -- account_id é NOT NULL no schema; ramo defensivo na mesma.
  if new.account_id is not null then
    select a.household_id into acc_household_id
    from public.accounts a
    where a.id = new.account_id;

    if acc_household_id is null then
      raise exception
        'A conta associada ao cartão não existe (account_id=%).', new.account_id
        using errcode = '23P51';
    end if;

    if acc_household_id <> new.household_id then
      raise exception
        'A conta associada ao cartão não pertence ao agregado familiar (account_id=% pertence a household %, esperado %).',
        new.account_id, acc_household_id, new.household_id
        using errcode = '23P51';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.assert_card_account_same_household() is
  'Trigger BEFORE INSERT/UPDATE (cards): garante que cards.account_id pertence ao MESMO household que o cartão. Levanta SQLSTATE 23P51 em violação cross-tenant. SECURITY DEFINER. NFR5.';

-- ─────────────────────────────────────────────────────────────────────
-- 3. Função: valida installments.card_id contra installments.household_id
--    (parcela aponta SEMPRE para um cartão — card_id NOT NULL).
-- ─────────────────────────────────────────────────────────────────────

create or replace function public.assert_installment_card_same_household()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  card_household_id uuid;
begin
  if new.card_id is not null then
    select c.household_id into card_household_id
    from public.cards c
    where c.id = new.card_id;

    if card_household_id is null then
      raise exception
        'O cartão da compra parcelada não existe (card_id=%).', new.card_id
        using errcode = '23P51';
    end if;

    if card_household_id <> new.household_id then
      raise exception
        'O cartão da compra parcelada não pertence ao agregado familiar (card_id=% pertence a household %, esperado %).',
        new.card_id, card_household_id, new.household_id
        using errcode = '23P51';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.assert_installment_card_same_household() is
  'Trigger BEFORE INSERT/UPDATE (installments): garante que installments.card_id pertence ao MESMO household que a parcela. Levanta SQLSTATE 23P51 em violação cross-tenant. SECURITY DEFINER. NFR5.';

-- ─────────────────────────────────────────────────────────────────────
-- 4. Triggers — BEFORE INSERT OR UPDATE em cada tabela.
--    UPDATE incluído porque mudar account_id/card_id/household_id depois do
--    INSERT reabriria o buraco. drop-if-exists garante idempotência.
-- ─────────────────────────────────────────────────────────────────────

drop trigger if exists trg_transactions_ref_same_household on public.transactions;
create trigger trg_transactions_ref_same_household
  before insert or update on public.transactions
  for each row
  execute function public.assert_finance_ref_same_household();

drop trigger if exists trg_recurrences_ref_same_household on public.recurrences;
create trigger trg_recurrences_ref_same_household
  before insert or update on public.recurrences
  for each row
  execute function public.assert_finance_ref_same_household();

drop trigger if exists trg_cards_account_same_household on public.cards;
create trigger trg_cards_account_same_household
  before insert or update on public.cards
  for each row
  execute function public.assert_card_account_same_household();

drop trigger if exists trg_installments_card_same_household on public.installments;
create trigger trg_installments_card_same_household
  before insert or update on public.installments
  for each row
  execute function public.assert_installment_card_same_household();
