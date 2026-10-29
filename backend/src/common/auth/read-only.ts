import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
  SetMetadata,
  applyDecorators,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiExtension } from '@nestjs/swagger';
import type { Request } from 'express';
import { SubscriptionsService } from '../../modules/subscriptions/subscriptions.service.js';
import { DomainError } from '../http/domain-error.js';
import type { AuthContext } from '../tenancy/request-context.js';

export const ALLOWED_WHEN_READ_ONLY = 'plan:allowedWhenReadOnly';

/**
 * Escrita que continua liberada no modo só leitura (business-rules §12): assinar, encerrar a
 * sessão e a página pública de agendamento, que segue funcionando para os clientes.
 */
export const AllowedWhenReadOnly = () =>
  applyDecorators(SetMetadata(ALLOWED_WHEN_READ_ONLY, true), ApiExtension('x-allowed-when-read-only', true));

const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const subscriptionInactive = () =>
  new DomainError(
    'subscription-inactive',
    'Payment Required',
    'O painel está só para consulta: o teste grátis terminou ou a assinatura não está em dia. Assine um plano em Configurações.',
    HttpStatus.PAYMENT_REQUIRED,
  );

/**
 * Guard global, depois do AccessGuard. Teste vencido, carência esgotada ou assinatura
 * cancelada depois do período pago: a barbearia consulta tudo, mas não cria nem altera nada.
 * A situação é lida a cada escrita (muda com a data e com o pagamento, sem o token saber).
 */
@Injectable()
export class ReadOnlyGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(SubscriptionsService) private readonly subscriptions: SubscriptionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { auth?: AuthContext }>();
    // Sem tenant autenticado (rota pública, administração da plataforma): nada a conferir.
    if (!request.auth || READS.has(request.method)) return true;
    const allowed = this.reflector.getAllAndOverride<boolean>(ALLOWED_WHEN_READ_ONLY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowed) return true;
    if ((await this.subscriptions.currentAccess()).state === 'read-only') throw subscriptionInactive();
    return true;
  }
}
