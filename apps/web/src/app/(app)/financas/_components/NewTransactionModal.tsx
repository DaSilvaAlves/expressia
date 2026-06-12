'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { parseEuroInputToCents } from '@/lib/finance/money';
import type { FinanceFilterOptions } from '@/lib/finance/list-variable-transactions';
import type { TransactionCreateInput } from '@/lib/api-schemas/transactions';

/**
 * `<NewTransactionModal>` — formulário de registo de transacção variável (A1
 * make-it-work). Substitui o botão `disabled` ("usa o Jarvis") da vista
 * `/financas/variaveis` — o backend `POST /api/financas/transacoes` (Story 4.3)
 * já aceitava tudo isto; faltava a UI.
 *
 * Campos: tipo + valor (€, vírgula decimal PT-PT) + descrição + data + "pagar
 * com" (conta OU cartão — o schema exige pelo menos um) + categoria + método.
 * Pattern hand-rolled (zero deps) seguindo `NewTaskModal.tsx`: dialog overlay +
 * Escape para fechar + alerta inline PT-PT.
 */
export interface NewTransactionModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** Contas/cartões/categorias do household — já carregados pela página RSC. */
  readonly options: FinanceFilterOptions;
}

type TransactionKind = TransactionCreateInput['kind'];
type PaymentMethod = TransactionCreateInput['payment_method'];

const KIND_LABELS: ReadonlyArray<{ value: TransactionKind; label: string }> = [
  { value: 'expense', label: 'Despesa' },
  { value: 'income', label: 'Receita' },
  { value: 'transfer', label: 'Transferência' },
];

const PAYMENT_METHOD_LABELS: ReadonlyArray<{ value: PaymentMethod; label: string }> = [
  { value: 'card', label: 'Cartão' },
  { value: 'cash', label: 'Numerário' },
  { value: 'transfer', label: 'Transferência' },
  { value: 'direct_debit', label: 'Débito directo' },
  { value: 'multibanco', label: 'Multibanco' },
  { value: 'mb_way', label: 'MB Way' },
  { value: 'other', label: 'Outro' },
];

/** Hoje no fuso local do utilizador — `en-CA` produz `YYYY-MM-DD`. */
function todayLocalIso(): string {
  return new Intl.DateTimeFormat('en-CA').format(new Date());
}

/** Valor do select "Pagar com" — codifica o tipo da fonte ("account:<id>"). */
function defaultSource(options: FinanceFilterOptions): string {
  const account = options.accounts[0];
  if (account) return `account:${account.id}`;
  const card = options.cards[0];
  if (card) return `card:${card.id}`;
  return '';
}

export function NewTransactionModal({
  open,
  onClose,
  options,
}: NewTransactionModalProps): React.ReactElement | null {
  const router = useRouter();
  const [kind, setKind] = useState<TransactionKind>('expense');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(todayLocalIso);
  const [source, setSource] = useState(() => defaultSource(options));
  const [categoryId, setCategoryId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('card');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasSource = options.accounts.length > 0 || options.cards.length > 0;

  // Reset ao abrir — começa sempre limpo, com a data de hoje.
  useEffect(() => {
    if (open) {
      setKind('expense');
      setAmount('');
      setDescription('');
      setDate(todayLocalIso());
      setSource(defaultSource(options));
      setCategoryId('');
      setPaymentMethod('card');
      setError(null);
    }
  }, [open, options]);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    if (open) document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function handleCreate(): Promise<void> {
    const amountCents = parseEuroInputToCents(amount);
    if (amountCents === null) {
      setError('Valor inválido — usa por exemplo 13,50.');
      return;
    }
    const trimmedDescription = description.trim();
    if (!trimmedDescription) {
      setError('A descrição é obrigatória.');
      return;
    }
    if (!date) {
      setError('A data é obrigatória.');
      return;
    }
    if (!source) {
      setError('Escolhe uma conta ou cartão.');
      return;
    }

    setPending(true);
    setError(null);
    try {
      // Schema `.strict()` — só os campos presentes; `account_id` XOR `card_id`.
      const body: Record<string, unknown> = {
        kind,
        amount_cents: amountCents,
        description: trimmedDescription,
        transaction_date: date,
        payment_method: paymentMethod,
      };
      const [sourceType, sourceId] = source.split(':');
      if (sourceType === 'card') body.card_id = sourceId;
      else body.account_id = sourceId;
      if (categoryId) body.category_id = categoryId;

      const res = await fetch('/api/financas/transacoes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const respBody = (await res.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        setError(respBody.error?.message ?? 'Erro ao registar transacção. Tenta novamente.');
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
      aria-labelledby="new-transaction-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="new-transaction-title" className="text-lg font-semibold">
          Nova transacção
        </h2>

        <form
          className="mt-4 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void handleCreate();
          }}
        >
          <div className="flex gap-3">
            <label className="block flex-1">
              <span className="text-sm font-medium">Tipo</span>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as TransactionKind)}
                aria-label="Tipo"
                className={inputClass}
              >
                {KIND_LABELS.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block flex-1">
              <span className="text-sm font-medium">
                Valor (€) <span className="text-red-600">*</span>
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0,00"
                autoFocus
                aria-label="Valor em euros"
                className={inputClass}
              />
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
              aria-label="Descrição"
              className={inputClass}
            />
          </label>

          <div className="flex gap-3">
            <label className="block flex-1">
              <span className="text-sm font-medium">
                Data <span className="text-red-600">*</span>
              </span>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                aria-label="Data"
                className={inputClass}
              />
            </label>
            <label className="block flex-1">
              <span className="text-sm font-medium">Método</span>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                aria-label="Método de pagamento"
                className={inputClass}
              >
                {PAYMENT_METHOD_LABELS.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="block">
            <span className="text-sm font-medium">
              Pagar com <span className="text-red-600">*</span>
            </span>
            <select
              value={source}
              onChange={(e) => setSource(e.target.value)}
              disabled={!hasSource}
              aria-label="Pagar com"
              className={`${inputClass} disabled:opacity-50`}
            >
              {options.accounts.length > 0 && (
                <optgroup label="Contas">
                  {options.accounts.map((a) => (
                    <option key={a.id} value={`account:${a.id}`}>
                      {a.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {options.cards.length > 0 && (
                <optgroup label="Cartões">
                  {options.cards.map((c) => (
                    <option key={c.id} value={`card:${c.id}`}>
                      {c.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>

          <label className="block">
            <span className="text-sm font-medium">Categoria</span>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              aria-label="Categoria"
              className={inputClass}
            >
              <option value="">Sem categoria</option>
              {options.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          {!hasSource && (
            <div
              role="alert"
              className="rounded-md bg-amber-50 px-3 py-1.5 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
            >
              Ainda não existem contas nem cartões — pede ao Jarvis para criar uma conta primeiro.
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
              disabled={pending || !hasSource}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {pending ? 'A registar...' : 'Registar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
