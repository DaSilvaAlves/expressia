import { createServerSupabaseClient } from '@meu-jarvis/auth/server';

/**
 * Dummy "Visão" page — landing autenticada para Story 1.5.
 *
 * Cumpre dois propósitos:
 *   1. Smoke test do auth gate (middleware redirecciona aqui após login).
 *   2. Validar que o JWT contém `household_id` (mostra-o na UI para inspecção
 *      manual durante o smoke test do runbook supabase-auth-setup.md §6).
 *
 * UX completa de "Visão" (resumo diário do household) é Epic 6.
 *
 * Trace: Story 1.5 Task 7 (D13), AC2 (rota protegida funcional).
 */
export default async function VisaoPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // O middleware garante que só chegamos aqui com user válido. Mas se por
  // alguma razão o user vier null (ex: race entre sign-out e nav), evitamos
  // crash e mostramos placeholder.
  if (!user) {
    return (
      <div>
        <h1 className="text-2xl font-bold">Visão</h1>
        <p className="mt-2 text-sm text-muted-foreground">A sessão expirou.</p>
      </div>
    );
  }

  // O custom_access_token_hook (migration 0002) injecta `household_id` directamente
  // nos claims top-level do JWT — não em user_metadata/app_metadata. Para o ler,
  // decodificamos o payload do access_token. Smoke test Story 1.5 AC3.
  const {
    data: { session },
  } = await supabase.auth.getSession();

  let householdId = '(não disponível — hook não activo ou não retorna claim)';
  if (session?.access_token) {
    try {
      const payload = session.access_token.split('.')[1];
      if (payload) {
        const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as {
          household_id?: string;
        };
        if (decoded.household_id) {
          householdId = decoded.household_id;
        }
      }
    } catch {
      householdId = '(erro a decodificar JWT)';
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Visão</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Bem-vindo, {user.email}.
        </p>
      </div>

      <div className="rounded-lg border border-black/10 p-4 text-sm dark:border-white/10">
        <h2 className="mb-2 font-semibold">Sessão activa</h2>
        <dl className="grid grid-cols-[8rem_1fr] gap-y-1">
          <dt className="text-muted-foreground">User ID</dt>
          <dd className="font-mono text-xs">{user.id}</dd>
          <dt className="text-muted-foreground">Email</dt>
          <dd>{user.email}</dd>
          <dt className="text-muted-foreground">Household ID</dt>
          <dd className="font-mono text-xs">{householdId}</dd>
        </dl>
      </div>

      <p className="text-xs text-muted-foreground">
        Esta página é um placeholder Story 1.5. UX completa de Visão é Epic 6.
      </p>
    </div>
  );
}
