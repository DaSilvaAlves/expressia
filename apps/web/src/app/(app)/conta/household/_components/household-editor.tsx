'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, useTransition } from 'react';

import {
  INVITABLE_ROLES,
  type HouseholdInviteDTO,
  type HouseholdMemberDTO,
  type HouseholdResponse,
  type InvitableRole,
  type InviteCreatedResponse,
  type InvitesListResponse,
} from '@/lib/api-schemas/households';

/**
 * Editor de household + gestão de membros e convites (Story 6.7 AC8).
 *
 * Client Component. Renomear faz PATCH a `/api/conta/household`. A gestão de
 * convites/membros (só visível a `owner`/`admin`):
 *   - convidar por email (mostra o link gerado para partilhar — MVP sem Resend);
 *   - listar e revogar convites pendentes;
 *   - remover membros (excepto o owner).
 *
 * Trace: Story 6.7 AC8; AC2-AC6.
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

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  const detail = (await res.json().catch(() => null)) as {
    error?: { message?: string };
    message?: string;
  } | null;
  return detail?.error?.message ?? detail?.message ?? fallback;
}

export function HouseholdEditor({
  initial,
}: HouseholdEditorProps): React.JSX.Element {
  const router = useRouter();
  const canEdit = initial.myRole === 'owner' || initial.myRole === 'admin';

  // ── Nome do household ──────────────────────────────────────────────────────
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
        if (!res.ok) throw new Error(await readErrorMessage(res, `Falha ao guardar (${res.status}).`));
        setSavedName(trimmed);
        setName(trimmed);
        setOk(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro ao guardar.');
      }
    });
  }

  // ── Convites ───────────────────────────────────────────────────────────────
  const [invites, setInvites] = useState<readonly HouseholdInviteDTO[]>([]);
  const [invitesLoaded, setInvitesLoaded] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<InvitableRole>('member');
  const [invitePending, startInviteTransition] = useTransition();
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [lastLink, setLastLink] = useState<string | null>(null);

  const loadInvites = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch('/api/conta/household/invites', { cache: 'no-store' });
      if (res.ok) {
        const data = (await res.json()) as InvitesListResponse;
        setInvites(data.invites);
      }
    } catch {
      // Não-fatal — a lista fica vazia.
    } finally {
      setInvitesLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (canEdit) void loadInvites();
  }, [canEdit, loadInvites]);

  function handleInvite(): void {
    const email = inviteEmail.trim();
    if (!email) return;
    setInviteError(null);
    setLastLink(null);
    startInviteTransition(async () => {
      try {
        const res = await fetch('/api/conta/household/invites', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, role: inviteRole }),
        });
        if (!res.ok) throw new Error(await readErrorMessage(res, `Falha ao convidar (${res.status}).`));
        const data = (await res.json()) as InviteCreatedResponse;
        const url = `${window.location.origin}${data.acceptPath}`;
        setLastLink(url);
        setInviteEmail('');
        await loadInvites();
      } catch (err) {
        setInviteError(err instanceof Error ? err.message : 'Erro ao convidar.');
      }
    });
  }

  function handleRevoke(inviteId: string): void {
    setInviteError(null);
    startInviteTransition(async () => {
      try {
        const res = await fetch(`/api/conta/household/invites/${inviteId}`, { method: 'DELETE' });
        if (!res.ok) throw new Error(await readErrorMessage(res, `Falha ao revogar (${res.status}).`));
        await loadInvites();
      } catch (err) {
        setInviteError(err instanceof Error ? err.message : 'Erro ao revogar.');
      }
    });
  }

  // ── Remover membro ───────────────────────────────────────────────────────────
  const [memberPending, startMemberTransition] = useTransition();
  const [memberError, setMemberError] = useState<string | null>(null);

  function handleRemoveMember(member: HouseholdMemberDTO): void {
    if (member.role === 'owner') return;
    if (!window.confirm(`Remover ${displayNameFor(member)} desta família?`)) return;
    setMemberError(null);
    startMemberTransition(async () => {
      try {
        const res = await fetch(`/api/conta/household/members/${member.id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error(await readErrorMessage(res, `Falha ao remover (${res.status}).`));
        router.refresh();
      } catch (err) {
        setMemberError(err instanceof Error ? err.message : 'Erro ao remover o membro.');
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
            <span className="text-muted-foreground">({initial.members.length})</span>
          </h2>
          <p className="text-xs text-muted-foreground">Quem faz parte desta família.</p>
        </div>

        <ul className="divide-y divide-border rounded-lg border border-border">
          {initial.members.map((member) => {
            const isSelf = member.email !== null;
            const canRemove = canEdit && member.role !== 'owner' && !isSelf;
            return (
              <li key={member.id} className="flex items-center gap-3 px-3 py-2.5">
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold"
                  aria-hidden="true"
                >
                  {initialsFor(member)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{displayNameFor(member)}</p>
                  {member.fullName?.trim() && member.email && (
                    <p className="truncate text-xs text-muted-foreground">{member.email}</p>
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
                {canRemove && (
                  <button
                    type="button"
                    onClick={() => handleRemoveMember(member)}
                    disabled={memberPending}
                    className="shrink-0 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-destructive hover:text-destructive disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Remover
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        {memberError && <p className="text-xs text-destructive">{memberError}</p>}
      </section>

      {/* Convites (só owner/admin) */}
      {canEdit && (
        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-medium">Convidar para a família</h2>
            <p className="text-xs text-muted-foreground">
              Envia o link gerado à pessoa. O convite expira em 7 dias.
            </p>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1">
              <label htmlFor="invite-email" className="sr-only">
                Email do convidado
              </label>
              <input
                id="invite-email"
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                disabled={invitePending}
                placeholder="email@exemplo.pt"
                className="w-full max-w-xs rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-60"
              />
            </div>
            <div>
              <label htmlFor="invite-role" className="sr-only">
                Papel do convidado
              </label>
              <select
                id="invite-role"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as InvitableRole)}
                disabled={invitePending}
                className="rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {INVITABLE_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={handleInvite}
              disabled={invitePending || inviteEmail.trim().length === 0}
              className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {invitePending ? 'A convidar…' : 'Convidar'}
            </button>
          </div>

          {inviteError && <p className="text-xs text-destructive">{inviteError}</p>}

          {lastLink && (
            <div className="space-y-1 rounded-md border border-border bg-background p-3">
              <p className="text-xs text-muted-foreground">
                Link de convite — copia e envia à pessoa:
              </p>
              <input
                type="text"
                readOnly
                value={lastLink}
                onFocus={(e) => e.currentTarget.select()}
                aria-label="Link de convite"
                className="w-full rounded border border-border bg-muted px-2 py-1 font-mono text-xs"
              />
            </div>
          )}

          {/* Convites pendentes */}
          {invitesLoaded && invites.length > 0 && (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {invites.map((invite) => (
                <li key={invite.id} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{invite.email}</p>
                    <p className="text-xs text-muted-foreground">
                      {ROLE_LABELS[invite.role]} · pendente
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRevoke(invite.id)}
                    disabled={invitePending}
                    className="shrink-0 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-destructive hover:text-destructive disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Revogar
                  </button>
                </li>
              ))}
            </ul>
          )}
          {invitesLoaded && invites.length === 0 && !lastLink && (
            <p className="text-xs text-muted-foreground">Sem convites pendentes.</p>
          )}
        </section>
      )}
    </div>
  );
}
