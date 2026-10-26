import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { HealthCheck, HealthCheckService, PrismaHealthIndicator } from '@nestjs/terminus';
import { Public } from '../common/auth/decorators.js';
import { API_TAGS } from '../common/http/openapi.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** Probes de liveness/readiness (fora do prefixo /v1). */
@Public()
@SkipThrottle()
@ApiTags(API_TAGS.health[0])
@Controller('health')
export class HealthController {
  constructor(
    @Inject(HealthCheckService) private readonly health: HealthCheckService,
    @Inject(PrismaHealthIndicator) private readonly prismaIndicator: PrismaHealthIndicator,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  @ApiOperation({ summary: 'Liveness: o processo está no ar' })
  @Get('live')
  live() {
    return { status: 'ok' };
  }

  @ApiOperation({ summary: 'Readiness: o banco está acessível' })
  @Get('ready')
  @HealthCheck()
  ready() {
    return this.health.check([
      () => this.prismaIndicator.pingCheck('database', this.prisma, { timeout: 2000 }),
    ]);
  }
}
