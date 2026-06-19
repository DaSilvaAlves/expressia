/**
 * Cliente Supabase service-role (Admin API) para o purge GDPR — Story 6.9.
 *
 * ⚠️ GUARD DE SEGURANÇA (espírito SEC-10): usa o `SUPABASE_SERVICE_ROLE_KEY` e
 * tem acesso de ADMIN à Auth (`auth.admin.deleteUser`) e ao Storage. Usar
 * EXCLUSIVAMENTE em código de servidor controlado sem JWT de utilizador — o job
 * Inngest `gdpr-purge` (categoria 1 do guard de `getServiceDb()`). NUNCA expor a
 * chave ao cliente.
 *
 * Singleton lazy: as env vars são lidas em runtime (testável via mock do módulo),
 * não no top-level. Precedente: `gdpr/storage.ts` (Story 6.8).
 *
 * Trace: Story 6.9 AC4 Step 3/Step 4; NFR11 (data residency UE);
 *        CLAUDE.md §Multi-tenancy (getServiceDb guard).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let _adminClient: SupabaseClient | null = null;

/**
 * Cliente Supabase service-role (singleton). Lê `NEXT_PUBLIC_SUPABASE_URL` +
 * `SUPABASE_SERVICE_ROLE_KEY`. Sem persistência de sessão (uso server-only).
 *
 * @throws se as env vars não estiverem definidas.
 */
export function getSupabaseAdminClient(): SupabaseClient {
  if (_adminClient) return _adminClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      '[gdpr/supabase-admin] NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não definidos.',
    );
  }

  _adminClient = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _adminClient;
}
