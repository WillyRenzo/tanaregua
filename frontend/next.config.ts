import type { NextConfig } from 'next';

// URL da API vista pelo servidor do Next (no Docker: http://backend:3333).
const apiInternalUrl = process.env.API_INTERNAL_URL ?? 'http://localhost:3333';

const nextConfig: NextConfig = {
  // Imagem de produção enxuta: `server.js` + só os node_modules rastreados (frontend/Dockerfile).
  // A config (inclusive os rewrites abaixo) é congelada no build: API_INTERNAL_URL entra como
  // argumento do build da imagem.
  output: 'standalone',
  // Não anuncia a stack em cada resposta (security.md, hardening).
  poweredByHeader: false,
  cacheComponents: true,
  partialPrefetching: true,
  // Só afeta `next dev`: o Playwright (container `e2e`) acessa como http://frontend:3000,
  // e o dev server bloqueia /_next/* para origens que não sejam localhost.
  allowedDevOrigins: ['frontend'],
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
  // O browser fala com a API pelo MESMO domínio (/api/...): o cookie de refresh fica
  // first-party e pode ser SameSite=Strict, sem CORS no caminho (security.md).
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiInternalUrl}/:path*` }];
  },
};

export default nextConfig;
