'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { parseEuroInputToCents } from '@/lib/finance/money';
import { CARD_TYPES, type CardCreateInput } from '@/lib/api-schemas/cards';

/**
 * `<NewCardModal>` — formulário de criação de cartão (A3 make-it-work).
 * Substitui o botão `disabled` da vista `/financas/cartoes` — o backend
 * `POST /api/financas/cartoes` (Story 4.2) já aceitava tudo isto; faltava a UI
 * (espelho do A2 `NewAccountModal`).
 *
 * Campos: conta associada (obrigatória — carregada de `GET /api/financas/contas`
 * ao abrir, primeira pré-seleccionada) + nome + tipo (enum `card_type`) + últimos
 * 4 dígitos (opcional) + dias de fecho/pagamento (opcionais, 1-28) + limite de
 * crédito (€, vírgula decimal PT-PT — obrigatório quando tipo=crédito, espelha o
 * refinamento Zod e o CHECK `cards_credit_needs_limit`). Pattern hand-rolled
 * (zero deps) seguindo `NewAccountModal.tsx`: dialog overlay + Escape para
 * fechar + alerta inline PT-PT.
 */
export interface NewCardModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

type CardType = CardCreateInput['card_type'];

/** Labels PT-PT — espelha o badge de `CardStatementCard.tsx`. */
const CARD_TYPE_LABELS: Record<CardType, string> = {
  credit: 'Crédito',
  debit: 'Débito',
};

interface AccountOption {
  readonly id: string;
  readonly name: string;
  readonly bank_name: string | null;
}

/**
 * Valida um dia do mês opcional (CHECK `cards_closing_day_range`/`cards_due_day_range`).
 * Vazio → `undefined` (omitido do body); inválido → `null`; válido → 1-28.
 */
function parseDayOfMonth(value: string): number | undefined | null {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (!/^[0-9]{1,2}$/.test(trimmed)) return null;
  const day = Number(trimmed);
  if (day < 1 || day > 28) return null;
  return day;
}

export function NewCardModal({ open, onClose }: NewCardModalProps): React.ReactElement | null {
  const router = useRouter();
  const [accounts, setAccounts] = useState<readonly AccountOption[] | null>(null);
  const [accountsFailed, setAccountsFailed] = useState(false);
  const [accountId, setAccountId] = useState('');
  const [name, setName] = useState('');
  const [cardType, setCardType] = useState<CardType>('credit');
  const [last4, setLast4] = useState('');
  const [closingDay, setClosingDay] = useState('');
  const [dueDay, setDueDay] = useState('');
  const [creditLimit, setCreditLimit] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset ao abrir + carrega as contas activas (o cartão exige `account_id`).
  useEffect(() => {
    if (!open) return;
    setAccounts(null);
    setAccountsFailed(false);
    setAccountId('');
    setName('');
    setCardType('credit');
    setLast4('');
    setClosingDay('');
    setDueDay('');
    setCreditLimit('');
    setError(null);

    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/financas/contas');
        if (!res.ok) throw new Error(`GET contas ${res.status}`);
        const data = (await res.json()) as { accounts: AccountOption[] };
        if (cancelled) return;
        setAccounts(data.accounts);
        setAccountId(data.accounts[0]?.id ?? '');
      } catch {
        if (!cancelled) setAccountsFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    if (open) document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const noAccounts = accounts !== null && accounts.length === 0;
  const canSubmit = !pending && !accountsFailed && !noAccounts;

  async function handleCreate(): Promise<void> {
    if (!accountId) {
      setError('Escolhe a conta associada ao cartão.');
      return;
    }
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('O nome é obrigatório.');
      return;
    }
    const trimmedLast4 = last4.trim();
    if (trimmedLast4 && !/^[0-9]{4}$/.test(trimmedLast4)) {
      setError('Últimos 4 dígitos inválidos — exactamente 4 dígitos.');
      return;
    }
    const parsedClosingDay = parseDayOfMonth(closingDay);
    if (parsedClosingDay === null) {
      setError('Dia de fecho inválido — deve estar entre 1 e 28.');
      return;
    }
    const parsedDueDay = parseDayOfMonth(dueDay);
    if (parsedDueDay === null) {
      setError('Dia de pagamento inválido — deve estar entre 1 e 28.');
      return;
    }
    // Refinamento do schema: cartão de crédito requer limite (CHECK no DB idem).
    let creditLimitCents: number | undefined;
    if (cardType === 'credit') {
      if (!creditLimit.trim()) {
        setError('Cartão de crédito requer limite de crédito.');
        return;
      }
      const parsed = parseEuroInputToCents(creditLimit);
      if (parsed === null) {
        setError('Limite de crédito inválido — usa por exemplo 1.500,00.');
        return;
      }
      creditLimitCents = parsed;
    }

    setPending(true);
    setError(null);
    try {
      // Schema `.strict()` — só os campos presentes; opcionais omitidos quando vazios.
      const body: Record<string, unknown> = {
        account_id: accountId,
        name: trimmedName,
        card_type: cardType,
      };
      if (trimmedLast4) body.last4 = trimmedLast4;
      if (parsedClosingDay !== undefined) body.closing_day = parsedClosingDay;
      if (parsedDueDay !== undefined) body.due_day = parsedDueDay;
      if (creditLimitCents !== undefined) body.credit_limit_cents = creditLimitCents;

      const res = await fetch('/api/financas/cartoes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const respBody = (await res.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        setError(respBody.error?.message ?? 'Erro ao criar cartão. Tenta novamente.');
        return;
      }
      router.refresh();
      onClose();
    } catch {
      setError('Erro temporário. Tenta novamente.');
    } finally {
      setPending(false);
    }
  }

  const inputClass =
    'mt-1 block w-full rounded-md border border-black/15 bg-white px-2 py-1 text-sm dark:border-white/15 dark:bg-neutral-800';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-card-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="new-card-title" className="text-lg font-semibold">
          Novo cartão
        </h2>

        <form
          className="mt-4 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void handleCreate();
          }}
        >
          <label className="block">
            <span className="text-sm font-medium">
              Conta <span className="text-red-600">*</span>
            </span>
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              disabled={accounts === null || noAccounts || accountsFailed}
              aria-label="Conta associada"
              className={inputClass}
            >
              {accounts === null && <option value="">A carregar contas...</option>}
              {(accounts ?? []).map((account) => (
                <option key={account.id} value={account.id}>
                  {account.bank_name ? `${account.name} — ${account.bank_name}` : account.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-sm font-medium">
              Nome <span className="text-red-600">*</span>
            </span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              autoFocus
              aria-label="Nome do cartão"
              className={inputClass}
            />
          </label>

          <div className="flex gap-3">
            <label className="block flex-1">
              <span className="text-sm font-medium">Tipo</span>
              <select
                value={cardType}
                onChange={(e) => setCardType(e.target.value as CardType)}
                aria-label="Tipo de cartão"
                className={inputClass}
              >
                {CARD_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {CARD_TYPE_LABELS[value]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block flex-1">
              <span className="text-sm font-medium">Últimos 4 dígitos</span>
              <input
                type="text"
                inputMode="numeric"
                value={last4}
                onChange={(e) => setLast4(e.target.value)}
                maxLength={4}
                placeholder="0000"
                aria-label="Últimos 4 dígitos"
                className={inputClass}
              />
            </label>
          </div>

          <div className="flex gap-3">
            <label className="block flex-1">
              <span className="text-sm font-medium">Dia de fecho</span>
              <input
                type="text"
                inputMode="numeric"
                value={closingDay}
                onChange={(e) => setClosingDay(e.target.value)}
                maxLength={2}
                placeholder="1-28"
                aria-label="Dia de fecho"
                className={inputClass}
              />
            </label>
            <label className="block flex-1">
              <span className="text-sm font-medium">Dia de pagamento</span>
              <input
                type="text"
                inputMode="numeric"
                value={dueDay}
                onChange={(e) => setDueDay(e.target.value)}
                maxLength={2}
                placeholder="1-28"
                aria-label="Dia de pagamento"
                className={inputClass}
              />
            </label>
          </div>

          {cardType === 'credit' && (
            <label className="block">
              <span className="text-sm font-medium">
                Limite de crédito (€) <span className="text-red-600">*</span>
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={creditLimit}
                onChange={(e) => setCreditLimit(e.target.value)}
                placeholder="1.500,00"
                aria-label="Limite de crédito em euros"
                className={inputClass}
              />
            </label>
          )}

          {accountsFailed && (
            <div
              role="alert"
              className="rounded-md bg-red-50 px-3 py-1.5 text-xs text-red-800 dark:bg-red-950/30 dark:text-red-200"
            >
              Erro ao carregar as contas. Fecha e tenta novamente.
            </div>
          )}

          {noAccounts && (
            <div
              role="alert"
              className="rounded-md bg-amber-50 px-3 py-1.5 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
            >
              Ainda não há contas — cria primeiro uma conta em Património.
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="rounded-md bg-red-50 px-3 py-1.5 text-xs text-red-800 dark:bg-red-950/30 dark:text-red-200"
            >
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="rounded-md border border-black/15 bg-white px-3 py-1.5 text-sm font-medium hover:bg-neutral-50 disabled:opacity-50 dark:border-white/15 dark:bg-neutral-800 dark:hover:bg-neutral-700"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {pending ? 'A criar...' : 'Criar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
