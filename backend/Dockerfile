# Imagens de produção da API (architecture.md, "Deploy"). Nada específico de provedor:
# toda configuração entra por variável de ambiente, validada na inicialização.
#
#   docker build --target runtime -t tanaregua-backend .   # API
#   docker build --target migrate -t tanaregua-migrate .   # prisma migrate deploy
#
# O .npmrc (ignore-scripts, min-release-age) vale aqui também: argon2 e sharp usam
# binários pré-compilados, sem install script.

FROM node:24-alpine AS base
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false

# Dependências completas (build e CLI do Prisma).
FROM base AS deps
COPY package.json package-lock.json .npmrc ./
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build

# Só dependências de produção para a imagem final.
FROM base AS prod-deps
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev

# Migrations: roda uma vez por deploy, com o usuário dono das tabelas
# (DATABASE_MIGRATION_URL), nunca com o usuário da aplicação.
FROM deps AS migrate
COPY prisma ./prisma
COPY prisma.config.ts ./
# Com ignore-scripts o install não baixa o schema engine; baixa aqui, no build, e não no
# deploy (a imagem roda sem permissão de escrita em node_modules).
RUN npx prisma version > /dev/null
USER node
CMD ["npx", "prisma", "migrate", "deploy"]

FROM base AS runtime
ENV NODE_ENV=production PORT=3333 STORAGE_LOCAL_DIR=/app/storage
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
# Volume dos logos (ObjectStorage local); precisa pertencer ao usuário sem privilégio.
RUN mkdir -p /app/storage && chown node:node /app/storage
USER node
EXPOSE 3333
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3333/health/live > /dev/null || exit 1
CMD ["node", "--enable-source-maps", "--import", "./dist/telemetry.js", "dist/main.js"]
