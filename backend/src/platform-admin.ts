// Contas da administração da plataforma. Roda no servidor com o usuário dono das tabelas
// (a aplicação não consegue criar administradores):
//   node dist/platform-admin.js create --email voce@exemplo.com --name "Seu Nome"
//   node dist/platform-admin.js set-password --email voce@exemplo.com
// A senha é pedida no terminal, sem eco (ou vem de PLATFORM_ADMIN_PASSWORD, em automação).
// Em produção: `docker compose run --rm platform-admin create ...` (deploy/README.md).
import { parseArgs } from 'node:util';
import { PrismaPg } from '@prisma/adapter-pg';
import { z } from 'zod';
import { PrismaClient } from './generated/prisma/client.js';
import { createPlatformAdmin, setPlatformAdminPassword } from './modules/platform/platform-admins.js';

const ENTER = new Set(['\r', '\n']);
const CTRL_C = String.fromCharCode(3);
const BACKSPACE = new Set([String.fromCharCode(8), String.fromCharCode(127)]);

function readHidden(label: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    return Promise.reject(new Error('Sem terminal para pedir a senha: defina PLATFORM_ADMIN_PASSWORD.'));
  }
  process.stdout.write(label);
  return new Promise((resolve, reject) => {
    let value = '';
    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off('data', onData);
      process.stdout.write('\n');
    };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (ENTER.has(char)) {
          cleanup();
          resolve(value);
          return;
        }
        if (char === CTRL_C) {
          cleanup();
          reject(new Error('Cancelado.'));
          return;
        }
        value = BACKSPACE.has(char) ? value.slice(0, -1) : value + char;
      }
    };
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.resume();
    stdin.on('data', onData);
  });
}

async function askPassword(): Promise<string> {
  const fromEnv = process.env['PLATFORM_ADMIN_PASSWORD'];
  if (fromEnv) return fromEnv;
  const password = await readHidden('Senha (mínimo 12 caracteres): ');
  if ((await readHidden('Repita a senha: ')) !== password) throw new Error('As senhas não conferem.');
  return password;
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { email: { type: 'string' }, name: { type: 'string' } },
});
const [command] = positionals;
const url = process.env['DATABASE_MIGRATION_URL'];

if (!url || !values.email || !['create', 'set-password'].includes(command ?? '')) {
  console.error(
    'Uso: platform-admin create --email <e-mail> --name <nome> | set-password --email <e-mail>\n' +
      'Precisa de DATABASE_MIGRATION_URL (usuário dono das tabelas).',
  );
  process.exit(1);
}

const owner = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
try {
  if (command === 'create') {
    const admin = await createPlatformAdmin(owner, {
      email: values.email,
      name: values.name ?? '',
      password: await askPassword(),
    });
    console.log(`Administrador criado: ${admin.name} <${admin.email}>`);
  } else {
    await setPlatformAdminPassword(owner, values.email, await askPassword());
    console.log('Senha trocada. As sessões abertas desse administrador foram encerradas.');
  }
} catch (error) {
  console.error(
    error instanceof z.ZodError ? z.prettifyError(error) : error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
} finally {
  await owner.$disconnect();
}
