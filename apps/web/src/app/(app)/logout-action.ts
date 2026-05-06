'use server';

/**
 * Server Action de logout.
 *
 * Decisão D15: logout é uma Server Action standalone (sem UI dedicada de
 * confirmação) integrada como `<form action={logoutAction}>` no header do
 * layout `(app)/`. Sem JavaScript funciona via submit nativo.
 *
 * Trace: Story 1.5 Task 7 (D15).
 */
import { redirect } from 'next/navigation';

import { createServerSupabaseClient } from '@meu-jarvis/auth/server';

export async function logoutAction(): Promise<void> {
  const supabase = await createServerSupabaseClient();
  await supabase.auth.signOut();
  redirect('/entrar');
}
