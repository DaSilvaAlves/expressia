import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Region: fra1 (configurado em vercel.json — Frankfurt para residência UE)
  experimental: {
    // RSC + Server Actions são default no App Router do Next.js 15.
    // Ativar typedRoutes para type-safe href em <Link>.
    typedRoutes: true,
  },
  // Permitir importar dos workspace packages sem transpile boilerplate.
  transpilePackages: ['@meu-jarvis/db', '@meu-jarvis/auth'],
  // i18n PT-PT: desactivado o sistema legacy do Next; usaremos middleware/route segments quando aplicável.
};

export default nextConfig;
