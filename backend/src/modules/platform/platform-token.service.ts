import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Env } from '../../config/env.js';

/** Identidade de quem administra a plataforma. Não tem tenant nem permissões de barbearia. */
export interface PlatformAuth {
  adminId: string;
}

const AUDIENCE = 'tanaregua-platform';

/**
 * Access token da administração da plataforma: segredo próprio (PLATFORM_JWT_SECRET) e
 * audiência própria. O token de uma barbearia não passa aqui, e este não passa no
 * AccessGuard das barbearias, porque cada um é assinado com um segredo diferente.
 * Sem o segredo configurado, a administração não existe (404).
 */
@Injectable()
export class PlatformTokenService {
  private readonly jwt: JwtService | null;
  readonly ttlSeconds: number;

  constructor(@Inject(ConfigService) config: ConfigService<Env, true>) {
    this.ttlSeconds = config.get('JWT_ACCESS_TTL_SECONDS');
    const secret = config.get('PLATFORM_JWT_SECRET', { infer: true });
    this.jwt = secret
      ? new JwtService({
          secret,
          signOptions: { algorithm: 'HS256', expiresIn: this.ttlSeconds, audience: AUDIENCE },
        })
      : null;
  }

  /** Lança 404 com a administração desligada: a rota se comporta como se não existisse. */
  assertEnabled(): JwtService {
    if (!this.jwt) throw new NotFoundException();
    return this.jwt;
  }

  async sign(auth: PlatformAuth): Promise<string> {
    return this.assertEnabled().signAsync({ sub: auth.adminId });
  }

  async verify(token: string): Promise<PlatformAuth> {
    const payload = await this.assertEnabled().verifyAsync<{ sub: string }>(token, {
      algorithms: ['HS256'],
      audience: AUDIENCE,
    });
    return { adminId: payload.sub };
  }
}
