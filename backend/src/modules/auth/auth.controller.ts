import { API_TAGS, ApiProblem, ApiResult } from '../../common/http/openapi.js';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { sessionProfileSchema, sessionResponseSchema } from '../registry.responses.js';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AnyAuthenticated, CurrentAuth, Public } from '../../common/auth/decorators.js';
import type { AuthContext } from '../../common/tenancy/request-context.js';
import {
  loginSchema,
  registerBarbershopSchema,
  type LoginInput,
  type RegisterBarbershopInput,
} from './auth.schemas.js';
import { AuthService, type SessionProfile } from './auth.service.js';
import {
  SessionCookieService,
  type SessionAudience,
  type SessionResponse,
} from './session-cookie.service.js';

const AUTH_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

@ApiTags(API_TAGS.auth[0])
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(SessionCookieService) private readonly cookies: SessionCookieService,
  ) {}

  @Public()
  @Throttle(AUTH_THROTTLE)
  @ApiResult(sessionResponseSchema, 201)
  @ApiOperation({ summary: 'Cadastra a barbearia com o dono e abre a sessão' })
  @ApiProblem(409, 'email-taken | slug-taken', 'E-mail ou endereço (slug) já em uso.')
  @Post('register-barbershop')
  async register(
    @Body({ schema: registerBarbershopSchema }) input: RegisterBarbershopInput,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionResponse> {
    return this.cookies.respond(await this.auth.registerBarbershop(input), response);
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @ApiResult(sessionResponseSchema)
  @ApiOperation({ summary: 'Entra no painel' })
  @Post('login')
  async login(
    @Body({ schema: loginSchema }) input: LoginInput,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionResponse> {
    return this.cookies.respond(await this.auth.login(input), response);
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @ApiResult(sessionResponseSchema)
  @ApiOperation({ summary: 'Renova o access token do painel usando o cookie de refresh' })
  @Post('refresh')
  refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<SessionResponse> {
    return this.renew(request, response, 'panel');
  }

  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Sai do painel e revoga a sessão' })
  @Post('logout')
  logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    return this.end(request, response, 'panel');
  }

  /** Sessão do agendamento online: cookie próprio, independente da sessão do painel. */
  @Public()
  @Throttle(AUTH_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @ApiResult(sessionResponseSchema)
  @ApiOperation({ summary: 'Renova o access token do cliente (agendamento online)' })
  @Post('client/refresh')
  refreshClient(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionResponse> {
    return this.renew(request, response, 'client');
  }

  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Sai do agendamento online e revoga a sessão do cliente' })
  @Post('client/logout')
  logoutClient(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    return this.end(request, response, 'client');
  }

  private async renew(request: Request, response: Response, audience: SessionAudience) {
    const token = this.cookies.read(request, audience);
    if (!token) throw new UnauthorizedException('Sessão expirada. Entre novamente.');
    try {
      return this.cookies.respond(await this.auth.refresh(token), response, audience);
    } catch (error) {
      this.cookies.clear(response, audience);
      throw error;
    }
  }

  private async end(request: Request, response: Response, audience: SessionAudience) {
    const token = this.cookies.read(request, audience);
    if (token) await this.auth.logout(token);
    this.cookies.clear(response, audience);
  }

  @AnyAuthenticated()
  @ApiResult(sessionProfileSchema)
  @ApiOperation({ summary: 'Perfil e permissões da sessão atual' })
  @Get('me')
  me(@CurrentAuth() auth: AuthContext): Promise<SessionProfile> {
    return this.auth.profile(auth);
  }
}
