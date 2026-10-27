import { API_TAGS, ApiResult } from '../../common/http/openapi.js';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { reportSummarySchema } from '../finance/finance.responses.js';
import { Controller, Get, Inject, Injectable, Module, Query } from '@nestjs/common';
import { RequirePermissions } from '../../common/auth/decorators.js';
import { TenantDb } from '../../common/tenancy/tenant-db.service.js';
import { AppointmentsModule } from '../appointments/appointments.module.js';
import { AppointmentsService } from '../appointments/appointments.service.js';
import { BarbershopsModule, BarbershopsService } from '../barbershops/barbershops.module.js';
import { FinanceModule } from '../finance/finance.module.js';
import {
  FinanceService,
  periodBounds,
  periodQuerySchema,
  type PeriodQuery,
} from '../finance/finance.service.js';
import { OrdersModule } from '../orders/orders.module.js';
import { OrdersService } from '../orders/orders.service.js';
import { StaffModule } from '../staff/staff.module.js';
import { StaffService } from '../staff/staff.service.js';

/**
 * Relatórios básicos (B6). Financeiro deriva de comandas fechadas e lançamentos,
 * nunca de agendamentos (business-rules §4); agendamentos só entram na taxa de no-show.
 */
@Injectable()
export class ReportsService {
  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(BarbershopsService) private readonly barbershops: BarbershopsService,
    @Inject(FinanceService) private readonly finance: FinanceService,
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(AppointmentsService) private readonly appointments: AppointmentsService,
    @Inject(StaffService) private readonly staff: StaffService,
  ) {}

  summary(period: PeriodQuery) {
    return this.db.run(async (tx, auth) => {
      const settings = await this.barbershops.settings(tx, auth.barbershopId);
      const { from, to } = periodBounds(period, settings.timezone);

      const revenueByDay = await this.finance.revenueByDay(tx, auth.barbershopId, settings.timezone, period);
      const byProfessional = await this.orders.revenueByProfessional(tx, auth.barbershopId, from, to);
      const topServices = await this.orders.topServices(tx, auth.barbershopId, from, to);
      const topProducts = await this.orders.topProducts(tx, auth.barbershopId, from, to);
      const statuses = await this.appointments.statusCounts(tx, auth.barbershopId, from, to);
      const names = await this.staff.names(
        tx,
        auth.barbershopId,
        byProfessional.map((row) => row.professionalId),
      );

      const attended = statuses.COMPLETED ?? 0;
      const noShows = statuses.NO_SHOW ?? 0;
      return {
        from: period.from,
        to: period.to,
        timezone: settings.timezone,
        revenue: {
          netCents: revenueByDay.reduce((sum, day) => sum + day.netCents, 0),
          byDay: revenueByDay,
        },
        professionals: byProfessional.map((row) => ({ ...row, name: names.get(row.professionalId) ?? '—' })),
        topServices,
        topProducts,
        appointments: {
          byStatus: statuses,
          // Taxa sobre atendimentos que deveriam ter acontecido (concluídos + faltas).
          noShowRate: attended + noShows === 0 ? 0 : noShows / (attended + noShows),
        },
      };
    });
  }
}

@ApiTags(API_TAGS.reports[0])
@Controller('reports')
export class ReportsController {
  constructor(@Inject(ReportsService) private readonly reports: ReportsService) {}

  @RequirePermissions('reports:read')
  @ApiResult(reportSummarySchema)
  @ApiOperation({ summary: 'Resumo do período: faturamento, profissionais, serviços e faltas' })
  @Get('summary')
  summary(@Query({ schema: periodQuerySchema }) query: PeriodQuery) {
    return this.reports.summary(query);
  }
}

@Module({
  imports: [BarbershopsModule, FinanceModule, OrdersModule, AppointmentsModule, StaffModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
