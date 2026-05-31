'use client';

import { useState, useTransition } from 'react';

import type {
  HouseholdMemberDTO,
  HouseholdResponse,
} from '@/lib/api-schemas/households';

/**
 * Editor de household + lista de membros (Story 6.x AC2-AC4).
 *
 * Client Component. Renomear faz PATCH a `/api/conta/household` (só visível
 * para `owner`/`admin`; o servidor aplica a mesma regra com 403). A lista de
 * membros é read-only nesta fase (convites/remoção ficam para story futura).
 *
 * Trace: Story 6.x AC2-AC4.
 */

interface HouseholdEditorProps {
  readonly initial: HouseholdResponse;
}

const PLAN_LABELS: Record<HouseholdResponse['household']['plan'], string> = {
  free: 'Grátis',
  pessoal: 'Pessoal',
  familia: 'Família',
  pro: 'Pro',
};

const ROLE_LABELS: Record<HouseholdMemberDTO['role'], string> = {
  owner: 'Dono',
  admin: 'Admin',
  member: 'Membro',
};

/** Iniciais para o avatar de fallback (display name → email → '?'). */
function initialsFor(member: HouseholdMemberDTO): string {
  const source = member.fullName?.trim() || member.email || '?';
  const parts = source.split(/[\s@.]+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '?';
  const second = parts[1]?.[0] ?? '';
  return (first + second).toUpperCase();
}

/** Nome a apresentar: display name → email → fallback genérico. */
function displayNameFor(member: HouseholdMemberDTO): string {
  return member.fullName?.trim() || member.email || 'Membro da família';
}

export function HouseholdEditor({
  initial,
}: HouseholdEditorProps): React.JSX.Element {
  const canEdit = initial.myRole === 'owner' || initial.myRole === 'admin';

  const [name, setName] = useState(initial.household.name);
  const [savedName, setSavedName] = useState(initial.household.name);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const trimmed = name.trim();
  const dirty = trimmed !== savedName && trimmed.length > 0;

  function handleSave(): void {
    if (!dirty || !canEdit) return;
    setError(null);
    setOk(false);

    startTransition(async () => {
      try {
        const res = await fetch('/api/conta/household', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: trimmed }),
        });
        if (!res.ok) {
          const detail = (await res.json().catch(() => null)) as {
            error?: { message?: string };
            message?: string;
          } | null;
          throw new Error(
            detail?.error?.message ??
              detail?.message ??
              `Falha ao guardar (${res.status}).`,
          );
        }
        setSavedName(trimmed);
        setName(trimmed);
        setOk(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro ao guardar.');
      }
    });
  }

  return (
    <div className="space-y-8">
      {/* Nome + plano */}
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium">Nome da família</h2>
          <p className="text-xs text-muted-foreground">
            {canEdit
              ? 'É assim que a tua família aparece na app.'
              : 'Só o dono ou um admin podem alterar o nome.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setOk(false);
            }}
            disabled={!canEdit || isPending}
            maxLength={80}
            aria-label="Nome da família"
            className="w-full max-w-xs rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-60"
          />
          {canEdit && (
            <button
              type="button"
              onClick={handleSave}
              disabled={!dirty || isPending}
              className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                dirty && !isPending
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                  : 'cursor-not-allowed bg-muted text-muted-foreground'
              }`}
            >
              {isPending ? 'A guardar…' : 'Guardar'}
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Plano:</span>
          <span className="rounded-full border border-border px-2 py-0.5 font-medium">
            {PLAN_LABELS[initial.household.plan]}
          </span>
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}
        {ok && !error && <p className="text-xs text-primary">Nome actualizado.</p>}
      </section>

      {/* Membros */}
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium">
            Membros{' '}
            <span className="text-muted-foreground">
              ({initial.members.length})
            </span>
          </h2>
          <p className="text-xs text-muted-foreground">
            Quem faz parte desta família.
          </p>
        </div>

        <ul className="divide-y divide-border rounded-lg border border-border">
          {initial.members.map((member) => (
            <li key={member.id} className="flex items-center gap-3 px-3 py-2.5">
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold"
                aria-hidden="true"
              >
                {initialsFor(member)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {displayNameFor(member)}
                </p>
                {member.fullName?.trim() && member.email && (
                  <p className="truncate text-xs text-muted-foreground">
                    {member.email}
                  </p>
                )}
              </div>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                  member.role === 'owner'
                    ? 'bg-primary/10 text-primary'
                    : 'border border-border text-muted-foreground'
                }`}
              >
                {ROLE_LABELS[member.role]}
              </span>
            </li>
          ))}
        </ul>

        <p className="text-xs text-muted-foreground">
          Convidar e remover membros chega numa próxima atualização.
        </p>
      </section>
    </div>
  );
}
