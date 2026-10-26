import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import type { Env } from '../config/env.js';
import { Prisma, PrismaClient } from '../generated/prisma/client.js';

export type Tx = Prisma.TransactionClient;

export interface DbContext {
  barbershopId?: string;
  userId?: string;
}

/**
 * Define o contexto do RLS na transação corrente. O `true` do set_config limita o
 * valor à transação: com pool de conexões, um SET de sessão vazaria o tenant para a
 * próxima requisição que reutilizar a conexão. Pode ser chamado de novo na mesma
 * transação para trocar o tenant (ex.: login, depois de escolher o vínculo).
 */
export async function setDbContext(tx: Tx, context: DbContext): Promise<void> {
  await tx.$executeRaw`SELECT
    set_config('app.current_tenant', ${context.barbershopId ?? ''}, true),
    set_config('app.current_user', ${context.userId ?? ''}, true)`;
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(ConfigService) config: ConfigService<Env, true>) {
    super({ adapter: new PrismaPg({ connectionString: config.get('DATABASE_URL') }) });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** Executa `fn` numa transação com o contexto do RLS já definido. */
  withContext<T>(context: DbContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.$transaction(async (tx) => {
      await setDbContext(tx, context);
      return fn(tx);
    });
  }
}
