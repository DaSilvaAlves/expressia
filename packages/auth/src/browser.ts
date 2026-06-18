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

/**
 * Cria um cliente Supabase Auth para uso em Client Components.
 *
 * Singleton implícito: chamar várias vezes devolve clientes independentes —
 * isto é OK porque o `@supabase/ssr` partilha o storage de cookies. Para evitar
 * recriar a instância em cada render, o consumidor deve memoizar com `useMemo`
 * ou criar a instância fora do componente.
 *
 * IMPORTANTE — acesso ESTÁTICO às env vars (`process.env.NEXT_PUBLIC_X`):
 *   No bundle do browser o Next.js só substitui (inlines) referências
 *   ESTÁTICAS de `process.env.NEXT_PUBLIC_*` por literais em build-time. Um
 *   acesso DINÂMICO (`process.env[name]` com `name` variável) NÃO é substituído
 *   e resolve para `undefined` em runtime no browser — o cliente rebentava com
 *   "variável não definida" mesmo com as vars correctamente configuradas na
 *   Vercel, fazendo a página de recuperação de palavra-passe (único consumidor
 *   deste cliente) cair no error boundary global. O `server.ts` usa o mesmo
 *   padrão dinâmico mas funciona porque no servidor `process.env` é o objecto
 *   Node real. Aqui as referências TÊM de ser estáticas.
 */
export function createBrowserSupabaseClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      '[@meu-jarvis/auth] NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY ' +
        'não estão definidas. NEXT_PUBLIC_* têm de estar disponíveis no browser via Next.js.',
    );
  }

  return createBrowserClient(url, anonKey);
}
