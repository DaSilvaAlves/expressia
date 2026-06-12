'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { parseEuroInputToCents } from '@/lib/finance/money';
import type { FinanceRecurrenceFrequency } from '@/lib/finance/finance-recurrence-helpers';
import type { FinanceKind } from '@/lib/finance/month-summary';

import { frequencyLabel } from '@/app/(app)/financas/_components/RecurrenceFrequencyLabel';

/**
 * `<NewRecurrenceModal>` — formulário de criação de recorrência financeira
 * (A4 make-it-work). Substitui o botão `disabled` da vista
 * `/financas/recorrentes` — o backend `POST /api/financas/recorrencias`
 * (Story 4.4) já aceitava tudo isto; faltava a UI (espelho do A3 `NewCardModal`).
 *
 * Escopo MVP (D-A4): tipo + descrição + valor (€, vírgula decimal PT-PT) +
 * conta associada (carregada de `GET /api/financas/contas` ao abrir, primeira
 * pré-seleccionada — satisfaz o refinamento Zod "pelo menos um de
 * account_id/card_id") + frequência + data de início. A frequência
 * `custom` fica FORA do formulário MVP (exigiria `custom_rrule`); `interval`
 * (=1) e `payment_method` (='transfer') usam os defaults do schema; `card_id`,
 * `category_id` e `ends_on` ficam para refinamento via Jarvis. Pattern
 * hand-rolled (zero deps) seguindo `NewCardModal.tsx`.
 */
export interface NewRecurrenceModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

/** Labels PT-PT do tipo de recorrência — espelha `transaction_kind`. */
const KIND_LABELS: Record<FinanceKind, string> = {
  expense: 'Despesa',
  income: 'Receita',
  transfer: 'Transferência',
};

const KIND_VALUES: readonly FinanceKind[] = ['expense', 'income', 'transfer'];

/**
 * Frequências oferecidas no formulário MVP — exclui `custom` (evita o campo
 * `custom_rrule` obrigatório). Espelha `recurrenceFreqFinanceEnum` menos `custom`.
 */
const MVP_FREQUENCIES: readonly FinanceRecurrenceFrequency[] = [
  'daily',
  'weekly',
  'biweekly',
  'monthly',
  'quarterly',
  'yearly',
];

interface AccountOption {
  readonly id: string;
  readonly name: string;
  readonly bank_name: string | null;
}

export function NewRecurrenceModal({
  open,
  onClose,
}: NewRecurrenceModalProps): React.ReactElement | null {
  const router = useRouter();
  const [accounts, setAccounts] = useState<readonly AccountOption[] | null>(null);
  const [accountsFailed, setAccountsFailed] = useState(false);
  const [accountId, setAccountId] = useState('');
  const [kind, setKind] = useState<FinanceKind>('expense');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [frequency, setFrequency] = useState<FinanceRecurrenceFrequency>('monthly');
  const [startsOn, setStartsOn] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset ao abrir + carrega as contas activas (a recorrência exige `account_id`).
  useEffect(() => {
    if (!open) return;
    setAccounts(null);
    setAccountsFailed(false);
    setAccountId('');
    setKind('expense');
    setDescription('');
    setAmount('');
    setFrequency('monthly');
    setStartsOn('');
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
      setError('Escolhe a conta associada à recorrência.');
      return;
    }
    const trimmedDescription = description.trim();
    if (!trimmedDescription) {
      setError('A descrição é obrigatória.');
      return;
    }
    const amountCents = parseEuroInputToCents(amount);
    if (amountCents === null || amountCents <= 0) {
      setError('Valor inválido — usa por exemplo 700,00.');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startsOn) || Number.isNaN(Date.parse(startsOn))) {
      setError('Data de início inválida.');
      return;
    }

    setPending(true);
    setError(null);
    try {
      // Schema `.strict()` — só os campos do MVP; `interval` e `payment_method`
      // usam os defaults do schema (1 / 'transfer'); `next_run_on` é inicializado
      // pelo handler (= starts_on) — NÃO enviar.
      const body = {
        kind,
        description: trimmedDescription,
        amount_cents: amountCents,
        account_id: accountId,
        frequency,
        starts_on: startsOn,
      };

      const res = await fetch('/api/financas/recorrencias', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const respBody = (await res.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        setError(respBody.error?.message ?? 'Erro ao criar recorrência. Tenta novamente.');
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
      aria-labelledby="new-recurrence-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="new-recurrence-title" className="text-lg font-semibold">
          Nova recorrência
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

          <div className="flex gap-3">
            <label className="block flex-1">
              <span className="text-sm font-medium">Tipo</span>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as FinanceKind)}
                aria-label="Tipo de recorrência"
                className={inputClass}
              >
                {KIND_VALUES.map((value) => (
                  <option key={value} value={value}>
                    {KIND_LABELS[value]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block flex-1">
              <span className="text-sm font-medium">Frequência</span>
              <select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as FinanceRecurrenceFrequency)}
                aria-label="Frequência"
                className={inputClass}
              >
                {MVP_FREQUENCIES.map((value) => (
                  <option key={value} value={value}>
                    {frequencyLabel(value)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="block">
            <span className="text-sm font-medium">
              Descrição <span className="text-red-600">*</span>
            </span>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              autoFocus
              aria-label="Descrição"
              className={inputClass}
            />
          </label>

          <div className="flex gap-3">
            <label className="block flex-1">
              <span className="text-sm font-medium">
                Valor (€) <span className="text-red-600">*</span>
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="700,00"
                aria-label="Valor em euros"
                className={inputClass}
              />
            </label>
            <label className="block flex-1">
              <span className="text-sm font-medium">
                Início <span className="text-red-600">*</span>
              </span>
              <input
                type="date"
                value={startsOn}
                onChange={(e) => setStartsOn(e.target.value)}
                aria-label="Data de início"
                className={inputClass}
              />
            </label>
          </div>

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
