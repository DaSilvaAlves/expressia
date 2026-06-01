import { z } from 'zod';

/**
 * Schemas de validação para `/api/conta/household` (Story 6.x — gestão de
 * household + membros).
 *
 * Reutiliza enums espelho de `@meu-jarvis/db` (household_role, plan_tier) —
 * mantidos como `z.enum` / tuplo local (REQ-INLINE-1, evita import cross-package
 * no client bundle).
 *
 * Trace: Story 6.x AC1-AC4; db-schema §2.
 */

export const HOUSEHOLD_ROLES = ['owner', 'admin', 'member'] as const;
export const PLAN_TIERS = ['free', 'pessoal', 'familia', 'pro'] as const;

export type HouseholdRole = (typeof HOUSEHOLD_ROLES)[number];
export type PlanTier = (typeof PLAN_TIERS)[number];

/** PATCH body — renomear household. Só `name` por agora (Story 6.x AC2). */
export const HouseholdPatchSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'O nome não pode estar vazio.')
      .max(80, 'O nome é demasiado longo (máx. 80).'),
  })
  .strict();

export type HouseholdPatch = z.infer<typeof HouseholdPatchSchema>;

/**
 * Membro do household para a resposta GET.
 *
 * `email` só é preenchido para o próprio utilizador autenticado (a leitura de
 * `auth.users` de outros membros não está disponível via RLS); `fullName` vem
 * de `household_members.display_name` (pode ser null se nunca definido).
 */
export interface HouseholdMemberDTO {
  readonly id: string;
  readonly email: string | null;
  readonly fullName: string | null;
  readonly role: (typeof HOUSEHOLD_ROLES)[number];
  readonly createdAt: string;
}

/** Resposta GET /api/conta/household. */
export interface HouseholdResponse {
  readonly household: {
    readonly id: string;
    readonly name: string;
    readonly plan: (typeof PLAN_TIERS)[number];
  };
  readonly members: readonly HouseholdMemberDTO[];
  readonly myRole: (typeof HOUSEHOLD_ROLES)[number];
}

// ─────────────────────────────────────────────────────────────────────────────
// Convites (Story 6.7 — convite e remoção de membros)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Papéis que podem ser atribuídos num convite — `owner` é excluído (o owner é
 * definido na criação do household; convites criam `admin`/`member`).
 */
export const INVITABLE_ROLES = ['admin', 'member'] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

/**
 * Body do POST /api/conta/household/invites — criar convite.
 *
 * `role` opcional (default `member`). Email normalizado (trim + lowercase) para
 * casar com o unique parcial `household_invites_unique_pending` e com a
 * verificação de email da `accept_invite()`.
 */
export const InviteCreateSchema = z
  .object({
    email: z
      .string()
      .trim()
      .toLowerCase()
      .email('Email inválido.')
      .max(254, 'Email demasiado longo.'),
    role: z.enum(INVITABLE_ROLES).optional().default('member'),
  })
  .strict();

export type InviteCreate = z.infer<typeof InviteCreateSchema>;

/** Convite pendente para a resposta GET (token NUNCA exposto na listagem). */
export interface HouseholdInviteDTO {
  readonly id: string;
  readonly email: string;
  readonly role: InvitableRole;
  readonly expiresAt: string;
  readonly createdAt: string;
}

/** Resposta POST — inclui o link de aceitação (MVP sem Resend — link manual). */
export interface InviteCreatedResponse {
  readonly invite: HouseholdInviteDTO;
  /** Caminho relativo `/aceitar-convite/{token}` para o owner partilhar. */
  readonly acceptPath: string;
}

/** Resposta GET /api/conta/household/invites. */
export interface InvitesListResponse {
  readonly invites: readonly HouseholdInviteDTO[];
}
