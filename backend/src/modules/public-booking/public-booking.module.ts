import { z } from 'zod';
import { API_TAGS, ApiProblem, ApiResult, Idempotent } from '../../common/http/openapi.js';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { appointmentViewSchema } from '../appointments/appointments.responses.js';
import { serviceViewSchema, sessionResponseSchema } from '../registry.responses.js';
import {
  publicAvailabilityResultSchema,
  publicBarbershopSchema,
  publicProfessionalSchema,
} from './public-booking.responses.js';
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
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public, RequirePermissions } from '../../common/auth/decorators.js';
import { slugSchema } from '../auth/auth.schemas.js';
import { AppointmentsModule } from '../appointments/appointments.module.js';
import type { AvailabilityQuery } from '../appointments/appointments.schemas.js';
import { SessionCookieService, type SessionResponse } from '../auth/session-cookie.service.js';
import { BarbershopsModule } from '../barbershops/barbershops.module.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { ClientsModule } from '../clients/clients.module.js';
import { StaffModule } from '../staff/staff.module.js';
import {
  publicAvailabilitySchema,
  publicBookingSchema,
  publicLoginSchema,
  publicRegisterSchema,
  type PublicBookingInput,
  type PublicLoginInput,
  type PublicRegisterInput,
} from './public-booking.schemas.js';
import { PublicBookingService } from './public-booking.service.js';

const BROWSE_THROTTLE = { default: { limit: 60, ttl: 60_000 } };
const AUTH_THROTTLE = { default: { limit: 10, ttl: 60_000 } };
const BOOKING_THROTTLE = { default: { limit: 20, ttl: 60_000 } };

/** Rotas da página pública de cada barbearia: /v1/public/:slug/... */
@ApiTags(API_TAGS.publicBooking[0])
@Controller('public/:slug')
export class PublicBookingController {
  constructor(
    @Inject(PublicBookingService) private readonly booking: PublicBookingService,
    @Inject(SessionCookieService) private readonly cookies: SessionCookieService,
  ) {}

  @Public()
  @Throttle(BROWSE_THROTTLE)
  @ApiResult(publicBarbershopSchema)
  @ApiOperation({ summary: 'Dados públicos da barbearia' })
  @Get()
  info(@Param('slug', { schema: slugSchema }) slug: string) {
    return this.booking.info(slug);
  }

  @Public()
  @Throttle(BROWSE_THROTTLE)
  @ApiResult(z.array(serviceViewSchema))
  @ApiOperation({ summary: 'Serviços disponíveis' })
  @Get('services')
  services(@Param('slug', { schema: slugSchema }) slug: string) {
    return this.booking.services(slug);
  }

  @Public()
  @Throttle(BROWSE_THROTTLE)
  @ApiResult(z.array(publicProfessionalSchema))
  @ApiOperation({ summary: 'Profissionais que atendem' })
  @Get('professionals')
  professionals(@Param('slug', { schema: slugSchema }) slug: string) {
    return this.booking.professionals(slug);
  }

  @Public()
  @Throttle(BROWSE_THROTTLE)
  @ApiResult(publicAvailabilityResultSchema)
  @ApiOperation({ summary: 'Horários livres (sem professionalId = qualquer profissional)' })
  @Get('availability')
  availability(
    @Param('slug', { schema: slugSchema }) slug: string,
    @Query({ schema: publicAvailabilitySchema }) query: AvailabilityQuery,
  ) {
    return this.booking.availability(slug, query);
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @ApiResult(sessionResponseSchema, 201)
  @ApiOperation({ summary: 'Cria conta de cliente nesta barbearia' })
  @ApiProblem(409, 'email-taken', 'Já existe conta com o e-mail: use o login.')
  @Post('auth/register')
  async register(
    @Param('slug', { schema: slugSchema }) slug: string,
    @Body({ schema: publicRegisterSchema }) input: PublicRegisterInput,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionResponse> {
    return this.cookies.respond(await this.booking.register(slug, input), response);
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @ApiResult(sessionResponseSchema)
  @ApiOperation({ summary: 'Entra como cliente (vincula a conta a esta barbearia)' })
  @Post('auth/login')
  async login(
    @Param('slug', { schema: slugSchema }) slug: string,
    @Body({ schema: publicLoginSchema }) input: PublicLoginInput,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionResponse> {
    return this.cookies.respond(await this.booking.login(slug, input), response);
  }

  @RequirePermissions('bookings:self')
  @ApiResult(z.array(appointmentViewSchema))
  @ApiOperation({ summary: 'Meus agendamentos' })
  @Get('me/appointments')
  myAppointments(@Param('slug', { schema: slugSchema }) slug: string) {
    return this.booking.myAppointments(slug);
  }

  @RequirePermissions('bookings:self')
  @Throttle(BOOKING_THROTTLE)
  @Idempotent()
  @ApiResult(appointmentViewSchema, 201)
  @ApiOperation({ summary: 'Reserva horário' })
  @ApiProblem(409, 'slot-unavailable', 'O horário não está mais disponível.')
  @Post('bookings')
  book(
    @Param('slug', { schema: slugSchema }) slug: string,
    @Body({ schema: publicBookingSchema }) input: PublicBookingInput,
  ) {
    return this.booking.book(slug, input);
  }

  @RequirePermissions('bookings:self')
  @HttpCode(HttpStatus.OK)
  @ApiResult(appointmentViewSchema)
  @ApiOperation({ summary: 'Cancela meu agendamento' })
  @ApiProblem(422, 'cancellation-window-closed', 'Fora do prazo de cancelamento online.')
  @Post('me/appointments/:id/cancel')
  cancel(@Param('slug', { schema: slugSchema }) slug: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.booking.cancel(slug, id);
  }
}

@Module({
  imports: [AppointmentsModule, BarbershopsModule, CatalogModule, ClientsModule, StaffModule],
  controllers: [PublicBookingController],
  providers: [PublicBookingService],
})
export class PublicBookingModule {}
