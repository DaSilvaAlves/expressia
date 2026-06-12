'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { parseEuroInputToCents } from '@/lib/finance/money';
import { ACCOUNT_TYPES, type AccountCreateInput } from '@/lib/api-schemas/accounts';

/**
 * `<NewAccountModal>` — formulário de criação de conta (A2 make-it-work).
 * Substitui o botão `disabled` da vista `/financas/patrimonio` — o backend
 * `POST /api/financas/contas` (Story 4.2) já aceitava tudo isto; faltava a UI
 * (lacuna FUP-4.9.A — era o único fluxo sem workaround, nem via Jarvis).
 *
 * Campos: nome + tipo (enum `account_type`) + banco (opcional) + últimos 4
 * dígitos do IBAN (opcional) + saldo inicial (€, vírgula decimal PT-PT;
 * suportado pelo backend via `initial_balance_cents` — o saldo é computado
 * on-read `initial + income − expense`, W1). Pattern hand-rolled (zero deps)
 * seguindo `NewTransactionModal.tsx`: dialog overlay + Escape para fechar +
 * alerta inline PT-PT.
 */
export interface NewAccountModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

type AccountType = AccountCreateInput['account_type'];

/** Labels PT-PT — espelha `ACCOUNT_TYPE_LABEL` de `AccountBalanceCard.tsx`. */
const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  corrente: 'Conta corrente',
  poupanca: 'Poupança',
  credito_consignado: 'Crédito consignado',
  investimentos: 'Investimentos',
  dinheiro: 'Dinheiro',
  outro: 'Outra',
};

export function NewAccountModal({
  open,
  onClose,
}: NewAccountModalProps): React.ReactElement | null {
  const router = useRouter();
  const [name, setName] = useState('');
  const [accountType, setAccountType] = useState<AccountType>('corrente');
  const [bankName, setBankName] = useState('');
  const [ibanLast4, setIbanLast4] = useState('');
  const [initialBalance, setInitialBalance] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset ao abrir — começa sempre limpo.
  useEffect(() => {
    if (open) {
      setName('');
      setAccountType('corrente');
      setBankName('');
      setIbanLast4('');
      setInitialBalance('');
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    if (open) document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function handleCreate(): Promise<void> {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('O nome é obrigatório.');
      return;
    }
    const trimmedIban = ibanLast4.trim();
    if (trimmedIban && !/^[0-9]{4}$/.test(trimmedIban)) {
      setError('IBAN (últimos 4 dígitos) inválido — exactamente 4 dígitos.');
      return;
    }
    // Saldo inicial vazio = 0 € (default do schema). Negativos não suportados
    // pelo parser PT-PT — criar a 0 e registar a despesa correspondente.
    let initialBalanceCents = 0;
    if (initialBalance.trim()) {
      const parsed = parseEuroInputToCents(initialBalance);
      if (parsed === null) {
        setError('Saldo inicial inválido — usa por exemplo 100,00.');
        return;
      }
      initialBalanceCents = parsed;
    }

    setPending(true);
    setError(null);
    try {
      // Schema `.strict()` — só os campos presentes; opcionais omitidos quando vazios.
      const body: Record<string, unknown> = {
        name: trimmedName,
        account_type: accountType,
        initial_balance_cents: initialBalanceCents,
      };
      const trimmedBank = bankName.trim();
      if (trimmedBank) body.bank_name = trimmedBank;
      if (trimmedIban) body.iban_last4 = trimmedIban;

      const res = await fetch('/api/financas/contas', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const respBody = (await res.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        setError(respBody.error?.message ?? 'Erro ao criar conta. Tenta novamente.');
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
      aria-labelledby="new-account-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="new-account-title" className="text-lg font-semibold">
          Nova conta
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
              Nome <span className="text-red-600">*</span>
            </span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              autoFocus
              aria-label="Nome da conta"
              className={inputClass}
            />
          </label>

          <div className="flex gap-3">
            <label className="block flex-1">
              <span className="text-sm font-medium">Tipo</span>
              <select
                value={accountType}
                onChange={(e) => setAccountType(e.target.value as AccountType)}
                aria-label="Tipo de conta"
                className={inputClass}
              >
                {ACCOUNT_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {ACCOUNT_TYPE_LABELS[value]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block flex-1">
              <span className="text-sm font-medium">Saldo inicial (€)</span>
              <input
                type="text"
                inputMode="decimal"
                value={initialBalance}
                onChange={(e) => setInitialBalance(e.target.value)}
                placeholder="0,00"
                aria-label="Saldo inicial em euros"
                className={inputClass}
              />
            </label>
          </div>

          <div className="flex gap-3">
            <label className="block flex-1">
              <span className="text-sm font-medium">Banco</span>
              <input
                type="text"
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
                maxLength={120}
                aria-label="Banco"
                className={inputClass}
              />
            </label>
            <label className="block flex-1">
              <span className="text-sm font-medium">IBAN (últimos 4)</span>
              <input
                type="text"
                inputMode="numeric"
                value={ibanLast4}
                onChange={(e) => setIbanLast4(e.target.value)}
                maxLength={4}
                placeholder="0000"
                aria-label="IBAN (últimos 4 dígitos)"
                className={inputClass}
              />
            </label>
          </div>

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
              disabled={pending}
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
