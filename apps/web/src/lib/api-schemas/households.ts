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
