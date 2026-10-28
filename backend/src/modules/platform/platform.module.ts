import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Module,
  Param,
  Post,
  Put,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { CurrentPlatformAdmin, PlatformAdminOnly, Public } from '../../common/auth/decorators.js';
import { API_TAGS, ApiResult } from '../../common/http/openapi.js';
import { SessionCookieService } from '../auth/session-cookie.service.js';
import { planSchema, type PlanSummary } from '../subscriptions/subscriptions.responses.js';
import { setPlanPricesSchema, type SetPlanPricesInput } from '../subscriptions/subscriptions.schemas.js';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module.js';
import { SubscriptionsService } from '../subscriptions/subscriptions.service.js';
import {
  platformLoginSchema,
  platformProfileSchema,
  platformSessionSchema,
  type PlatformLoginInput,
  type PlatformProfile,
  type PlatformSessionResponse,
} from './platform.schemas.js';
import {
  PLATFORM_SESSION_TTL_MS,
  PlatformSessionService,
  type PlatformSession,
} from './platform-session.service.js';
import { PlatformTokenService, type PlatformAuth } from './platform-token.service.js';

/** Mais restrito que o login da equipe: é a porta para os preços de todas as barbearias. */
const PLATFORM_AUTH_THROTTLE = { default: { limit: 5, ttl: 60_000 } };

@ApiTags(API_TAGS.platform[0])
@Controller('platform')
export class PlatformController {
  constructor(
    @Inject(PlatformSessionService) private readonly sessions: PlatformSessionService,
    @Inject(SessionCookieService) private readonly cookies: SessionCookieService,
    @Inject(SubscriptionsService) private readonly subscriptions: SubscriptionsService,
  ) {}

  @Public()
  @Throttle(PLATFORM_AUTH_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @ApiResult(platformSessionSchema)
  @ApiOperation({ summary: 'Entra na administração da plataforma' })
  @Post('auth/login')
  async login(
    @Body({ schema: platformLoginSchema }) input: PlatformLoginInput,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PlatformSessionResponse> {
    return this.respond(await this.sessions.login(input), response);
  }

  @Public()
  @Throttle(PLATFORM_AUTH_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @ApiResult(platformSessionSchema)
  @ApiOperation({ summary: 'Renova o access token da administração usando o cookie de refresh' })
  @Post('auth/refresh')
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PlatformSessionResponse> {
    const token = this.cookies.read(request, 'platform');
    if (!token) throw new UnauthorizedException('Sessão expirada. Entre novamente.');
    try {
      return this.respond(await this.sessions.refresh(token), response);
    } catch (error) {
      this.cookies.clear(response, 'platform');
      throw error;
    }
  }

  @Public()
  @Throttle(PLATFORM_AUTH_THROTTLE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Sai da administração e revoga a sessão' })
  @Post('auth/logout')
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<void> {
    const token = this.cookies.read(request, 'platform');
    if (token) await this.sessions.logout(token);
    this.cookies.clear(response, 'platform');
  }

  @PlatformAdminOnly()
  @ApiResult(platformProfileSchema)
  @ApiOperation({ summary: 'Quem está na administração da plataforma' })
  @Get('auth/me')
  me(@CurrentPlatformAdmin() admin: PlatformAuth): Promise<PlatformProfile> {
    return this.sessions.profile(admin.adminId);
  }

  @PlatformAdminOnly()
  @ApiResult(z.array(planSchema))
  @ApiOperation({ summary: 'Planos com recursos e preços' })
  @Get('plans')
  plans(@CurrentPlatformAdmin() admin: PlatformAuth): Promise<PlanSummary[]> {
    return this.subscriptions.listPlansAsPlatform(admin.adminId);
  }

  @PlatformAdminOnly()
  @ApiResult(planSchema)
  @ApiOperation({
    summary: 'Define os preços mensal e anual de um plano',
    description:
      'Valores em centavos; `null` tira o plano de venda naquele ciclo. Vale para as próximas contratações: assinaturas já contratadas mantêm o valor.',
  })
  @Put('plans/:key/prices')
  setPrices(
    @CurrentPlatformAdmin() admin: PlatformAuth,
    @Param('key') key: string,
    @Body({ schema: setPlanPricesSchema }) input: SetPlanPricesInput,
  ): Promise<PlanSummary> {
    return this.subscriptions.setPlanPrices(admin.adminId, key, input);
  }

  private respond(session: PlatformSession, response: Response): PlatformSessionResponse {
    this.cookies.write(response, session.refreshToken, 'platform', PLATFORM_SESSION_TTL_MS);
    return { accessToken: session.accessToken, expiresIn: session.expiresIn, profile: session.profile };
  }
}

/**
 * Administração da plataforma TaNaRegua (business-rules §12): autenticação própria e sem
 * acesso aos dados das barbearias. Exporta o serviço de token para o AccessGuard.
 */
@Module({
  imports: [SubscriptionsModule],
  controllers: [PlatformController],
  providers: [PlatformTokenService, PlatformSessionService],
  exports: [PlatformTokenService],
})
export class PlatformModule {}
