import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Request, Response } from 'express';
import type { Env } from '../../config/env.js';
import type { Session } from './auth.service.js';
import type { SessionResponse } from '../registry.responses.js';
import { RefreshTokenService } from './refresh-token.service.js';

/**
 * Painel e agendamento online são sessões independentes, cada uma no seu cookie: entrar
 * como cliente na página pública não pode sobrescrever a sessão do painel (e vice-versa)
 * no mesmo navegador.
 */
export type SessionAudience = 'panel' | 'client';

export const REFRESH_COOKIES: Record<SessionAudience, string> = {
  panel: 'tnr_refresh',
  client: 'tnr_client_refresh',
};

export type { SessionResponse };

/** Entrega a sessão: refresh token só em cookie httpOnly, access token no corpo. */
@Injectable()
export class SessionCookieService {
  private readonly options: CookieOptions;

  constructor(
    @Inject(RefreshTokenService) refreshTokens: RefreshTokenService,
    @Inject(ConfigService) config: ConfigService<Env, true>,
  ) {
    this.options = {
      httpOnly: true,
      secure: config.get('NODE_ENV') === 'production',
      // O frontend chama a API pelo mesmo domínio (rewrite /api do Next), então strict funciona.
      sameSite: 'strict',
      // Path "/" porque o browser enxerga /api/v1/auth/... (rewrite), não /v1/auth/...
      path: '/',
      maxAge: refreshTokens.maxAgeMs,
    };
  }

  respond(session: Session, response: Response, audience: SessionAudience = 'panel'): SessionResponse {
    response.cookie(REFRESH_COOKIES[audience], session.refreshToken, this.options);
    return { accessToken: session.accessToken, expiresIn: session.expiresIn, profile: session.profile };
  }

  clear(response: Response, audience: SessionAudience = 'panel'): void {
    response.clearCookie(REFRESH_COOKIES[audience], { ...this.options, maxAge: undefined });
  }

  read(request: Request, audience: SessionAudience = 'panel'): string | undefined {
    const cookies = request.cookies as Record<string, string | undefined> | undefined;
    return cookies?.[REFRESH_COOKIES[audience]];
  }
}
