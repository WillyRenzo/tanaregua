import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { AuthContext } from '../../common/tenancy/request-context.js';
import { isPermission } from './permissions.js';

/** Payload mínimo e legível por qualquer um: nada sensível aqui. */
interface AccessTokenPayload {
  sub: string;
  bid: string;
  mid: string;
  perms: string[];
}

@Injectable()
export class AccessTokenService {
  constructor(@Inject(JwtService) private readonly jwt: JwtService) {}

  sign(auth: AuthContext): Promise<string> {
    const payload: AccessTokenPayload = {
      sub: auth.userId,
      bid: auth.barbershopId,
      mid: auth.membershipId,
      perms: [...auth.permissions],
    };
    return this.jwt.signAsync(payload);
  }

  async verify(token: string): Promise<AuthContext> {
    const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
      algorithms: ['HS256'],
    });
    return {
      userId: payload.sub,
      barbershopId: payload.bid,
      membershipId: payload.mid,
      // Permissões removidas do catálogo deixam de valer mesmo em tokens antigos.
      permissions: payload.perms.filter(isPermission),
    };
  }
}
