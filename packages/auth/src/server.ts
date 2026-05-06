/**
 * Cliente Supabase Auth para Server Components, Route Handlers e Server Actions.
 *
 * Padrão SSR oficial Supabase (`@supabase/ssr`):
 *   - Lê e escreve cookies através do `cookies()` API do Next.js.
 *   - Os cookies guardam o JWT de acesso + refresh token; o middleware refresca-os
 *     via `updateSession()` em cada request.
 *
 * Multi-tenancy:
 *   - Quando o utilizador faz login, o Supabase Auth Hook
 *     `public.custom_access_token_hook` (migration 0002_auth_hook.sql) injecta
 *     `household_id` nas claims do JWT.
 *   - As policies RLS em `0001_rls_policies.sql` lêem essa claim via
 *     `public.current_household_id()` — isto significa que qualquer query feita
 *     através deste cliente fica automaticamente filtrada pelo household activo.
 *
 * Uso:
 *   ```ts
 *   import { createServerSupabaseClient } from '@meu-jarvis/auth/server'
 *
 *   export default async function Page() {
 *     const supabase = await createServerSupabaseClient()
 *     const { data: { user } } = await supabase.auth.getUser()
 *     // ...
 *   }
 *   ```
 *
 * Trace: Architecture §5.1 (Supabase Auth, ADR-002), §5.2 (custom_access_token_hook),
 *        Story 1.5 AC1.
 */
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `[@meu-jarvis/auth] Variável de ambiente ${name} não está definida. ` +
        'Configure em apps/web/.env.local ou nas Vercel env vars.',
    );
  }
  return value;
}

/**
 * Cria um cliente Supabase Auth ligado aos cookies da request actual.
 *
 * Em Next.js 15, `cookies()` é assíncrono — esta função reflecte isso devolvendo
 * uma `Promise<SupabaseClient>`. As Server Actions e Route Handlers conseguem
 * escrever cookies (refresh tokens), Server Components apenas ler.
 *
 * @returns Cliente Supabase tipado.
 */
export async function createServerSupabaseClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();

  return createServerClient(
    getEnv('NEXT_PUBLIC_SUPABASE_URL'),
    getEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // O `setAll` pode ser chamado a partir de um Server Component
            // onde escrita de cookies não é permitida. Nesse caso o middleware
            // garante o refresh — basta ignorar a falha aqui.
          }
        },
      },
    },
  );
}
