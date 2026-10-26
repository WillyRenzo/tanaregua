import { applyDecorators, createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { ApiExtension } from '@nestjs/swagger';
import type { Request } from 'express';
import type { Permission } from '../../modules/auth/permissions.js';
import type { AuthContext } from '../tenancy/request-context.js';

export const IS_PUBLIC = 'auth:isPublic';
export const REQUIRED_PERMISSIONS = 'auth:requiredPermissions';
export const ANY_AUTHENTICATED = 'auth:anyAuthenticated';

/**
 * As extensões `x-*` abaixo são lidas pela geração do OpenAPI (app.setup.ts): rota
 * pública sai sem cadeado no Swagger e as permissões aparecem na descrição. Assim a
 * documentação de acesso nunca diverge do que o guard realmente aplica.
 */

/** Rota aberta. Exige rate limit explícito (@Throttle) por convenção. */
export const Public = () => applyDecorators(SetMetadata(IS_PUBLIC, true), ApiExtension('x-public', true));

/**
 * Basta UMA das permissões listadas. O escopo (`:own` vs `:any`) é aplicado
 * pelo service, que recebe o AuthContext. Rotas sem este decorator, sem
 * @Public() e sem @AnyAuthenticated() são negadas (deny by default).
 */
export const RequirePermissions = (...permissions: [Permission, ...Permission[]]) =>
  applyDecorators(
    SetMetadata(REQUIRED_PERMISSIONS, permissions),
    ApiExtension('x-required-permissions', permissions),
  );

/** Qualquer usuário autenticado (ex.: /auth/me, logout). */
export const AnyAuthenticated = () => SetMetadata(ANY_AUTHENTICATED, true);

export const CurrentAuth = createParamDecorator((_data: unknown, context: ExecutionContext): AuthContext => {
  const request = context.switchToHttp().getRequest<Request & { auth?: AuthContext }>();
  if (!request.auth) throw new Error('CurrentAuth usado em rota sem autenticação');
  return request.auth;
});
