import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import type { Request } from 'express';
import type { Permission } from '../../modules/auth/permissions.js';
import { AccessTokenService } from '../../modules/auth/access-token.service.js';
import type { AuthContext, RequestContext } from '../tenancy/request-context.js';
import { ANY_AUTHENTICATED, IS_PUBLIC, REQUIRED_PERMISSIONS } from './decorators.js';

/**
 * Guard global único: autentica (Bearer JWT) e autoriza (permissões).
 * Deny by default: rota sem @Public, @AnyAuthenticated ou @RequirePermissions é negada,
 * para que esquecer o decorator nunca deixe uma rota aberta.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AccessTokenService) private readonly tokens: AccessTokenService,
    @Inject(ClsService) private readonly cls: ClsService<RequestContext>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request & { auth?: AuthContext }>();
    const auth = await this.authenticate(request);
    request.auth = auth;
    this.cls.set('auth', auth);

    if (this.reflector.getAllAndOverride<boolean>(ANY_AUTHENTICATED, targets)) {
      return true;
    }

    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(
      REQUIRED_PERMISSIONS,
      targets,
    );
    if (!required?.some((permission) => auth.permissions.includes(permission))) {
      throw new ForbiddenException('Você não tem permissão para esta ação.');
    }
    return true;
  }

  private async authenticate(request: Request): Promise<AuthContext> {
    const [scheme, token] = request.headers.authorization?.split(' ') ?? [];
    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('Autenticação necessária.');
    }
    try {
      return await this.tokens.verify(token);
    } catch {
      throw new UnauthorizedException('Sessão expirada ou inválida.');
    }
  }
}
