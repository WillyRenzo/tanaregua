import { Controller, Get, Inject, Module } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AnyAuthenticated } from '../../common/auth/decorators.js';
import { API_TAGS, ApiResult } from '../../common/http/openapi.js';
import { planSchema, type PlanSummary } from './subscriptions.responses.js';
import { SubscriptionsService } from './subscriptions.service.js';

@ApiTags(API_TAGS.subscription[0])
@Controller('plans')
export class PlansController {
  constructor(@Inject(SubscriptionsService) private readonly subscriptions: SubscriptionsService) {}

  /** Catálogo sem dado de tenant: o painel usa para dizer em qual plano está um recurso. */
  @AnyAuthenticated()
  @ApiResult(z.array(planSchema))
  @ApiOperation({ summary: 'Planos, do mais básico ao mais completo, com os recursos de cada um' })
  @Get()
  list(): Promise<PlanSummary[]> {
    return this.subscriptions.listPlans();
  }
}

@Module({
  controllers: [PlansController],
  providers: [SubscriptionsService],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
