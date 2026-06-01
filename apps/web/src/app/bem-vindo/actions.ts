'use server';

/**
 * Server Actions do tour de onboarding `/bem-vindo` (Story 6.2).
 *
 * `completeOnboarding` é invocada tanto no "Começar a usar" (Passo 2) como no
 * "Saltar tudo" (Passo 1) — em ambos os casos marca o onboarding como visto e
 * redirecciona para `/visao?welcome=1` (FR31: saltar mantém o trial; AC6/AC7).
 *
 * Marcação idempotente (AC7): UPSERT `INSERT ... ON CONFLICT (user_id) DO UPDATE`
 * em `user_prefs.onboarding_completed_at`. Para utilizadores novos a row de
 * `user_prefs` ainda não existe (lazy-init — o trigger 0019 cria household/
 * membership/conta/subscription, mas NÃO `user_prefs`), por isso o INSERT
 * fornece `household_id` (NOT NULL) resolvido do membership — mesmo padrão de
 * `/api/conta/preferencias` (D32).
 *
 * RLS (NFR5): escrita via `getDb()` (role authenticated, RLS por JWT) — NUNCA
 * `getServiceDb()`. REQ-INLINE-1: `sql` vem de `drizzle-orm` (não de
 * `@meu-jarvis/db`); o cliente vem do shim `@/lib/agent/db-shim`.
 *
 * Trace: Story 6.2 AC6/AC7; FR30/FR31; precedente `/api/conta/preferencias` D32.
 */
import { sql } from 'drizzle-orm';
import { redirect } from 'next/navigation';

import { createServerSupabaseClient } from '@meu-jarvis/auth/server';

import { getDb } from '@/lib/agent/db-shim';

/**
 * Resolve o `household_id` activo do user (primeiro household do membership).
 * Mesma lógica de `/api/conta/preferencias` e `/api/agent/prompt`.
 */
async function resolveHouseholdId(userId: string): Promise<string | null> {
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
 * Marca o onboarding como completado/saltado e redirecciona para a `/visao`.
 *
 * NÃO toca em `subscriptions` — o trial já está activo (trigger 0019). O param
 * `?welcome=1` sinaliza à `/visao` para mostrar o toast de boas-vindas (AC8).
 */
export async function completeOnboarding(): Promise<void> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/entrar');

  const householdId = await resolveHouseholdId(user.id);
  // Defensivo: sem household o registo não terminou (não deveria acontecer —
  // trigger 0019 cria-o atomicamente). Devolve ao fluxo de auth sem crashar.
  if (!householdId) redirect('/entrar');

  const db = getDb();
  await db.execute(sql`
    insert into public.user_prefs (user_id, household_id, onboarding_completed_at)
    values (${user.id}::uuid, ${householdId}::uuid, now())
    on conflict (user_id) do update set onboarding_completed_at = now()
  `);

  // redirect() lança internamente (NEXT_REDIRECT) — deve ficar fora de try/catch.
  redirect('/visao?welcome=1');
}
