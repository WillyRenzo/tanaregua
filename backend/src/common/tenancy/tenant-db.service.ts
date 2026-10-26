import { Inject, Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { PrismaService, type Tx } from '../../prisma/prisma.service.js';
import type { AuthContext, RequestContext } from './request-context.js';

/**
 * Porta de entrada para dados com tenant. O barbershopId vem SEMPRE do token
 * (via CLS), nunca do input. Os services ainda filtram por `barbershopId`
 * explicitamente (camada 1); o RLS do Postgres é a garantia final (camada 2).
 */
@Injectable()
export class TenantDb {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ClsService) private readonly cls: ClsService<RequestContext>,
  ) {}

  get auth(): AuthContext {
    const auth = this.cls.get('auth');
    if (!auth) {
      // Bug de programação: rota com tenant sem autenticação. Nunca deve chegar ao cliente.
      throw new Error('TenantDb usado fora de uma requisição autenticada');
    }
    return auth;
  }

  get barbershopId(): string {
    return this.auth.barbershopId;
  }

  run<T>(fn: (tx: Tx, auth: AuthContext) => Promise<T>): Promise<T> {
    const auth = this.auth;
    return this.prisma.withContext({ barbershopId: auth.barbershopId, userId: auth.userId }, (tx) =>
      fn(tx, auth),
    );
  }

  /** Para rotas públicas, onde o tenant é resolvido pelo slug no servidor. */
  runAs<T>(barbershopId: string, fn: (tx: Tx) => Promise<T>, userId?: string): Promise<T> {
    return this.prisma.withContext({ barbershopId, userId }, fn);
  }
}
