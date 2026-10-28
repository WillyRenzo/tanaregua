import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import type { Env } from '../../config/env.js';
import { AccessTokenService } from './access-token.service.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { RefreshTokenService } from './refresh-token.service.js';
import { SessionCookieService } from './session-cookie.service.js';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module.js';

/** Global porque o AccessGuard (APP_GUARD) precisa do AccessTokenService. */
@Global()
@Module({
  imports: [
    SubscriptionsModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_ACCESS_SECRET'),
        signOptions: { algorithm: 'HS256', expiresIn: config.get('JWT_ACCESS_TTL_SECONDS') },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AccessTokenService, RefreshTokenService, SessionCookieService],
  exports: [AuthService, AccessTokenService, SessionCookieService],
})
export class AuthModule {}
