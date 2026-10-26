import { z } from 'zod';
import { API_TAGS, ApiProblem, ApiResult, Idempotent } from '../../common/http/openapi.js';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { appointmentViewSchema, availabilitySchema, dayAgendaSchema } from './appointments.responses.js';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { RequirePermissions } from '../../common/auth/decorators.js';
import { BarbershopsModule } from '../barbershops/barbershops.module.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { ClientsModule } from '../clients/clients.module.js';
import { StaffModule } from '../staff/staff.module.js';
import {
  availabilityQuerySchema,
  changeStatusSchema,
  createAppointmentSchema,
  dayQuerySchema,
  rangeQuerySchema,
  updateAppointmentSchema,
  type AvailabilityQuery,
  type ChangeStatusInput,
  type CreateAppointmentInput,
  type DayQuery,
  type RangeQuery,
  type UpdateAppointmentInput,
} from './appointments.schemas.js';
import { AppointmentsService } from './appointments.service.js';

@ApiTags(API_TAGS.agenda[0])
@Controller()
export class AppointmentsController {
  constructor(@Inject(AppointmentsService) private readonly appointments: AppointmentsService) {}

  /** Agenda integrada do dia: profissionais × expediente × folgas × atendimentos. */
  @RequirePermissions('appointments:read:any', 'appointments:read:own')
  @ApiResult(dayAgendaSchema)
  @ApiOperation({ summary: 'Agenda integrada do dia (profissionais × atendimentos)' })
  @Get('agenda/day')
  day(@Query({ schema: dayQuerySchema }) query: DayQuery) {
    return this.appointments.dayAgenda(query);
  }

  @RequirePermissions('appointments:read:any', 'appointments:read:own')
  @ApiResult(availabilitySchema)
  @ApiOperation({ summary: 'Horários livres para os serviços escolhidos' })
  @Get('availability')
  availability(@Query({ schema: availabilityQuerySchema }) query: AvailabilityQuery) {
    return this.appointments.availability(query);
  }

  @RequirePermissions('appointments:read:any', 'appointments:read:own')
  @ApiResult(z.array(appointmentViewSchema))
  @ApiOperation({ summary: 'Agendamentos no período (máx. 31 dias)' })
  @Get('appointments')
  list(@Query({ schema: rangeQuerySchema }) query: RangeQuery) {
    return this.appointments.list(query);
  }

  @RequirePermissions('appointments:read:any', 'appointments:read:own')
  @ApiResult(appointmentViewSchema)
  @ApiOperation({ summary: 'Detalhe do agendamento' })
  @Get('appointments/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.appointments.get(id);
  }

  @RequirePermissions('appointments:write:any', 'appointments:write:own')
  @Idempotent()
  @ApiResult(appointmentViewSchema, 201)
  @ApiOperation({ summary: 'Cria agendamento' })
  @ApiProblem(409, 'appointment-conflict', 'O profissional já tem atendimento sobreposto.')
  @ApiProblem(
    422,
    'professional-unavailable | invalid-professional | invalid-service',
    'Profissional de folga/inválido ou serviço inativo.',
  )
  @Post('appointments')
  create(@Body({ schema: createAppointmentSchema }) input: CreateAppointmentInput) {
    return this.appointments.create(input);
  }

  @RequirePermissions('appointments:write:any', 'appointments:write:own')
  @ApiResult(appointmentViewSchema)
  @ApiOperation({ summary: 'Reagenda ou altera serviços' })
  @ApiProblem(409, 'appointment-conflict', 'O novo horário conflita com outro atendimento.')
  @ApiProblem(422, 'not-reschedulable', 'Só é possível alterar antes do atendimento começar.')
  @Patch('appointments/:id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: updateAppointmentSchema }) input: UpdateAppointmentInput,
  ) {
    return this.appointments.update(id, input);
  }

  @RequirePermissions('appointments:write:any', 'appointments:write:own')
  @HttpCode(HttpStatus.OK)
  @ApiResult(appointmentViewSchema)
  @ApiOperation({ summary: 'Muda o status (confirmar, iniciar, faltou, cancelar)' })
  @ApiProblem(422, 'invalid-status-transition', 'Transição de status não permitida.')
  @Post('appointments/:id/status')
  changeStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: changeStatusSchema }) input: ChangeStatusInput,
  ) {
    return this.appointments.changeStatus(id, input);
  }
}

@Module({
  imports: [BarbershopsModule, StaffModule, ClientsModule, CatalogModule],
  controllers: [AppointmentsController],
  providers: [AppointmentsService],
  exports: [AppointmentsService],
})
export class AppointmentsModule {}
