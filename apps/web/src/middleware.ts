/**
 * Middleware Next.js — auth gate + token refresh.
 *
 * Responsabilidades:
 *   1. Refrescar o JWT Supabase em cada request via `@supabase/ssr` cookies API.
 *      Sem isto, sessões expirariam após 1h sem possibilidade de recuperação
 *      (Architecture §5.1: JWT TTL 1h, refresh token 30d).
 *   2. Auth gate: rotas em `/(app)/**` (visão, tarefas, finanças, perfil…)
 *      requerem sessão válida. Se não houver, redirect para `/entrar`.
 *
 * Notas:
 *   - O cliente Supabase aqui é distinto do `@meu-jarvis/auth` server client:
 *     middleware corre em runtime Edge ou Node, mas SEM acesso a `next/headers`
 *     (cookies request-scoped vêm do `NextRequest`). Logo replicamos o
 *     `createServerClient` aqui in-line (padrão oficial Supabase SSR).
 *   - O matcher exclui `/(auth)/**` e estáticos para evitar ciclos de redirect.
 *
 * Trace: Architecture §7.2 (edge middleware), §5.1 (token refresh),
 *        Story 1.5 AC2, AC8.
 */
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const APP_PATH_PREFIX = '/visao'; // primeira rota do route group (app)/

export async function middleware(request: NextRequest): Promise<NextResponse> {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          // Pattern oficial Supabase: actualizar tanto o request (para chained
          // server clients dentro deste request) como a response (cookie no browser).
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANT: getUser() é o trigger do refresh — não usar getSession() aqui.
  // getSession() não revalida o token; getUser() faz round-trip ao Supabase.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Auth gate: bloquear rotas (app)/** se sem sessão.
  if (!user && request.nextUrl.pathname.startsWith(APP_PATH_PREFIX)) {
    const url = request.nextUrl.clone();
    url.pathname = '/entrar';
    url.searchParams.set('next', request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

/**
 * Matcher: corre o middleware em todas as rotas excepto:
 *   - `/_next/**` (assets Next.js)
 *   - `/favicon.ico`, imagens estáticas
 *   - `/(auth)/**` (entrar, registar, recuperar — não autenticadas)
 *   - `/api/billing/**` e `/api/cron/**` (recebem webhooks externos sem JWT)
 *
 * Architecture §7.2: matcher inclui `(app)` e api selectivamente.
 */
export const config = {
  matcher: [
    /*
     * Combinar todas as rotas excepto:
     *   _next/static (estáticos)
     *   _next/image (optimização imagem)
     *   favicon.ico
     *   ficheiros públicos com extensão (svg, png, jpg, jpeg, gif, webp)
     *   /api/billing/** e /api/cron/** (webhooks)
     */
    '/((?!_next/static|_next/image|favicon.ico|api/billing|api/cron|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
