# Imagem de produção do frontend (Next.js standalone). Ver architecture.md, "Deploy".
#
#   docker build --build-arg API_INTERNAL_URL=http://backend:3333 -t tanaregua-frontend .
#
# O contrato da API (src/lib/api/schema.d.ts) já está versionado: o build não precisa do
# backend no ar.

FROM node:26-alpine AS base
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json package-lock.json .npmrc ./
RUN npm ci

FROM deps AS build
# Os rewrites do next.config são congelados no build (standalone): este é o endereço da
# API na rede interna do compose de produção.
ARG API_INTERNAL_URL=http://backend:3333
ENV API_INTERNAL_URL=${API_INTERNAL_URL}
COPY . .
RUN npm run build

FROM base AS runtime
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/entrar > /dev/null || exit 1
CMD ["node", "server.js"]
