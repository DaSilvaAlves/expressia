/**
 * Cliente Supabase Auth para Client Components.
 *
 * Diferenças em relação ao cliente server:
 *   - Não acede a `next/headers` (não disponível no browser).
 *   - Usa `createBrowserClient` que lê os cookies do `document.cookie` em runtime.
 *
 * Uso típico:
 *   ```tsx
 *   'use client'
 *   import { createBrowserSupabaseClient } from '@meu-jarvis/auth/browser'
 *
 *   const supabase = createBrowserSupabaseClient()
 *   await supabase.auth.signInWithPassword({ email, password })
 *   ```
 *
 * Trace: Architecture §5.1 (Supabase Auth pattern), Story 1.5 AC1.
 */
import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `[@meu-jarvis/auth] Variável de ambiente ${name} não está definida. ` +
        'NEXT_PUBLIC_* tem de estar disponível no browser via Next.js.',
    );
  }
  return value;
}

/**
 * Cria um cliente Supabase Auth para uso em Client Components.
 *
 * Singleton implícito: chamar várias vezes devolve clientes independentes —
 * isto é OK porque o `@supabase/ssr` partilha o storage de cookies. Para evitar
 * recriar a instância em cada render, o consumidor deve memoizar com `useMemo`
 * ou criar a instância fora do componente.
 */
export function createBrowserSupabaseClient(): SupabaseClient {
  return createBrowserClient(
    getEnv('NEXT_PUBLIC_SUPABASE_URL'),
    getEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  );
}
