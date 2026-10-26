import { API_TAGS, ApiResult } from '../../common/http/openapi.js';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { cashDaySchema, commissionsSummarySchema } from './finance.responses.js';
import { Controller, Get, Inject, Module, Query } from '@nestjs/common';
import { RequirePermissions } from '../../common/auth/decorators.js';
import { BarbershopsModule } from '../barbershops/barbershops.module.js';
import {
  cashDayQuerySchema,
  FinanceService,
  periodQuerySchema,
  type CashDayQuery,
  type PeriodQuery,
} from './finance.service.js';

@ApiTags(API_TAGS.finance[0])
@Controller()
export class FinanceController {
  constructor(@Inject(FinanceService) private readonly finance: FinanceService) {}

  @RequirePermissions('cash:read')
  @ApiResult(cashDaySchema)
  @ApiOperation({ summary: 'Caixa do dia por forma de pagamento' })
  @Get('cash/day')
  cashDay(@Query({ schema: cashDayQuerySchema }) query: CashDayQuery) {
    return this.finance.cashDay(query);
  }

  @RequirePermissions('commissions:read:any', 'commissions:read:own')
  @ApiResult(commissionsSummarySchema)
  @ApiOperation({ summary: 'Comissões por profissional no período' })
  @Get('commissions')
  commissions(@Query({ schema: periodQuerySchema }) query: PeriodQuery) {
    return this.finance.commissions(query);
  }
}

@Module({
  imports: [BarbershopsModule],
  controllers: [FinanceController],
  providers: [FinanceService],
  exports: [FinanceService],
})
export class FinanceModule {}
