import { withSentryConfig } from '@sentry/nextjs';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Region: fra1 (configurado em vercel.json — Frankfurt para residência UE)
  experimental: {
    // RSC + Server Actions são default no App Router do Next.js 15.
    // Ativar typedRoutes para type-safe href em <Link>.
    typedRoutes: true,
    // Nota Story 1.7 AC2: o handoff devops 2026-05-07 e a story v1.2 indicavam
    // `instrumentationHook: true` como obrigatório. Em Next.js 15.x esse flag
    // foi removido — `instrumentation.ts` é estável e activo por default desde
    // 15.0 (ver https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation).
    // Manter o flag aqui causa typecheck error (TS2353). O comportamento
    // pretendido — `apps/web/instrumentation.ts` invocado em cada cold-start —
    // está preservado pela default behaviour do Next 15.
  },
  // Permitir importar dos workspace packages sem transpile boilerplate.
  transpilePackages: ['@meu-jarvis/db', '@meu-jarvis/auth', '@meu-jarvis/observability', '@meu-jarvis/agent', '@meu-jarvis/tools', '@meu-jarvis/classifier'],
  // i18n PT-PT: desactivado o sistema legacy do Next; usaremos middleware/route segments quando aplicável.
};

/**
 * Wrap com Sentry para sourcemap upload + auto-instrumentação de erros.
 *
 * - `org`/`project`: identificam a aplicação na org Sentry EU `eurico-xw`.
 * - `authToken`: necessário no build CI/Vercel para upload de sourcemaps.
 *   Sem este token, o plugin emite warning não-bloqueante e stack traces
 *   ficam minificadas no Sentry — debug mais difícil mas o build não falha.
 * - `silent: !process.env.CI`: silencia logs verbosos do plugin em dev local.
 *
 * Trace: Story 1.7 AC3, Architecture §9.1.
 */
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  // Não fazer upload de sourcemaps de chunks de telemetria do próprio Sentry
  widenClientFileUpload: true,
  // Esconder o source-map debug ID do utilizador final (não afecta o upload)
  hideSourceMaps: true,
  // Desactivar o tunneling automático do Sentry — não precisamos para EU DSN
  disableLogger: true,
});
