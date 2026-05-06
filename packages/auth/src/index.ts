/**
 * Entry-point público do pacote `@meu-jarvis/auth`.
 *
 * Exporta clientes Supabase Auth para os dois ambientes do Next.js 15:
 *   - `createServerSupabaseClient()` — Server Components, Route Handlers, Server Actions.
 *   - `createBrowserSupabaseClient()` — Client Components.
 *
 * O middleware de auth fica em `apps/web/src/middleware.ts` e usa directamente
 * `@supabase/ssr` para criar um cliente request-scoped (não usa estes barris
 * porque tem de manipular `NextRequest` cookies que diferem do `next/headers`).
 *
 * Trace: Architecture §5.1, Story 1.5 AC1.
 */
export { createServerSupabaseClient } from '@/server';
export { createBrowserSupabaseClient } from '@/browser';
