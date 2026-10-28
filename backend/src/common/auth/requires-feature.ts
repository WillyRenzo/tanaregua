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
import type { Feature } from '../../modules/subscriptions/features.js';
import { SubscriptionsService } from '../../modules/subscriptions/subscriptions.service.js';
import { DomainError } from '../http/domain-error.js';

export const REQUIRED_FEATURE = 'plan:requiredFeature';

/**
 * Rota que depende do plano (business-rules §12). Soma-se às permissões: acesso efetivo =
 * permissão do papel E recurso do plano. Só em rota autenticada (o tenant vem do token).
 * A extensão `x-required-feature` vai para a descrição do OpenAPI (app.setup.ts).
 */
export const RequiresFeature = (feature: Feature) =>
  applyDecorators(SetMetadata(REQUIRED_FEATURE, feature), ApiExtension('x-required-feature', feature));

/**
 * Guard global, depois do AccessGuard. O plano não vai no JWT (muda com o pagamento a
 * qualquer momento): os recursos são lidos da assinatura a cada rota que exige um.
 */
@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(SubscriptionsService) private readonly subscriptions: SubscriptionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const feature = this.reflector.getAllAndOverride<Feature | undefined>(REQUIRED_FEATURE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!feature) return true;
    if (!(await this.subscriptions.currentFeatures()).includes(feature)) {
      throw new DomainError(
        'plan-upgrade-required',
        'Forbidden',
        'Este recurso não está disponível no plano da sua barbearia.',
        HttpStatus.FORBIDDEN,
      );
    }
    return true;
  }
}
