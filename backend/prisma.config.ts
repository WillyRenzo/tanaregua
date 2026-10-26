import { defineConfig } from 'prisma/config';

// O CLI do Prisma (migrate, studio) conecta como dono das tabelas.
// A aplicação usa DATABASE_URL, com um usuário sem ownership, para que o RLS se aplique.
// As variáveis chegam pelo env_file do docker-compose; não usamos dotenv.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env['DATABASE_MIGRATION_URL'],
  },
});
