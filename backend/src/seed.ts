// Seed de desenvolvimento: `npm run db:seed`. Cria a "Barbearia Demo" com uma conta por
// papel e a conta da administração da plataforma. Idempotente: se a demo já existir, só
// acrescenta os módulos que faltam (criados depois da demo) e mostra as credenciais.
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { DEMO_ACCOUNTS, DEMO_PASSWORD, DEMO_SLUG, NEIGHBOR_SLUG, seedDemo } from './seed/demo-seed.js';
import { PLATFORM_ADMIN_EMAIL, seedPlatform } from './seed/platform-seed.js';

if (process.env['NODE_ENV'] === 'production') {
  console.error('O seed de demonstração não roda em produção.');
  process.exit(1);
}

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
try {
  const result = await seedDemo(app);
  console.log(
    result.created
      ? '\nDados de demonstração criados.'
      : result.added.length > 0
        ? `\nA barbearia "${DEMO_SLUG}" já existia; acrescentei: ${result.added.join(', ')}.`
        : `\nA barbearia "${DEMO_SLUG}" já existe e está completa: nada foi alterado. Para recriar do zero (com datas atuais), apague o banco local (docker compose down -v).`,
  );
  const platform = await seedPlatform(app);
  if (!platform.available) {
    console.log('\nSem DATABASE_MIGRATION_URL: a conta da administração da plataforma não foi criada.');
  } else if (platform.added.length > 0) {
    console.log(`Administração da plataforma: acrescentei ${platform.added.join(', ')}.`);
  }

  console.log(`\nSenha de todas as contas: ${DEMO_PASSWORD}\n`);
  console.table([
    ...Object.values(DEMO_ACCOUNTS).map((account) => ({ papel: account.role, 'e-mail': account.email })),
    ...(platform.available ? [{ papel: 'administração da plataforma', 'e-mail': PLATFORM_ADMIN_EMAIL }] : []),
  ]);
  console.log(`\nPainel:          http://localhost:3000/entrar`);
  console.log(`Página pública:  http://localhost:3000/${DEMO_SLUG}`);
  console.log(`Outra barbearia: http://localhost:3000/${NEIGHBOR_SLUG}`);
  if (platform.available) console.log(`Plataforma:      http://localhost:3000/admin`);
  console.log('');
} finally {
  await app.close();
}
