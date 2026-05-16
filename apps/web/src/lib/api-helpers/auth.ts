/**
 * Auth helpers partilhados pelos route handlers Story 3.2 (api/{tasks,tags,recurrences}/).
 *
 * Extracted from canonical pattern Story 2.7 (`/api/conta/preferencias/route.ts:47-60`)
 * para DRY across 9 NEW route handlers (DEV-DECISION D-3.2.1).
 */
import type { Span } from '@opentelemetry/api';
import type { NextResponse } from 'next/server';

import { createServerSupabaseClient } from '@meu-jarvis/auth/server';
import { annotateSpan } from '@meu-jarvis/observability';

import { apiError } from '@/lib/errors';

export interface AuthContext {
  readonly userId: string;
  readonly householdId: string;
}

/**
 * Resolve household_id activo do user (primeiro household do membership).
 * Mesma lógica de `/api/conta/preferencias/route.ts:47-60` (Story 2.7).
 */
export async function resolveHouseholdId(userId: string): Promise<string | null> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from('household_members')
    .select('household_id')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle<{ household_id: string }>();

  if (error || !data) return null;
  return data.household_id;
}

/**
 * Resolve role do user no household (member/admin/owner) — usado em endpoints
 * que verificam variant `*_delete_owner_admin` (AC3 tags DELETE).
 */
export async function resolveHouseholdRole(
  userId: string,
  householdId: string,
): Promise<'owner' | 'admin' | 'member' | null> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from('household_members')
    .select('role')
    .eq('user_id', userId)
    .eq('household_id', householdId)
    .limit(1)
    .maybeSingle<{ role: 'owner' | 'admin' | 'member' }>();

  if (error || !data) return null;
  return data.role;
}

/**
 * Auth check standard — retorna {userId, householdId} ou Response error.
 *
 * Pattern: const auth = await requireAuth(span); if (auth instanceof NextResponse) return auth;
 */
export async function requireAuth(span: Span): Promise<AuthContext | NextResponse> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    annotateSpan(span, { statusCode: 401 });
    return apiError(
      'AUTH_REQUIRED',
      'Sessão inválida ou expirada. Por favor inicie sessão novamente.',
      401,
    );
  }

  annotateSpan(span, { userId: user.id });

  const householdId = await resolveHouseholdId(user.id);
  if (!householdId) {
    annotateSpan(span, { statusCode: 404 });
    return apiError(
      'HOUSEHOLD_NOT_FOUND',
      'Household não encontrado. Por favor complete o registo.',
      404,
    );
  }

  annotateSpan(span, { householdId });
  return { userId: user.id, householdId };
}
