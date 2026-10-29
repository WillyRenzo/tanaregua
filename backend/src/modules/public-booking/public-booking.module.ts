import { z } from 'zod';
import { API_TAGS, ApiProblem, ApiResult, Idempotent } from '../../common/http/openapi.js';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { clientAppointmentViewSchema } from '../appointments/appointments.responses.js';
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
  StreamableFile,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { AllowedWhenReadOnly } from '../../common/auth/read-only.js';
import { Public, RequirePermissions } from '../../common/auth/decorators.js';
import { slugSchema } from '../auth/auth.schemas.js';
import { AppointmentsModule } from '../appointments/appointments.module.js';
import {
  clientRescheduleSchema,
  type AvailabilityQuery,
  type ClientRescheduleInput,
} from '../appointments/appointments.schemas.js';
import { SessionCookieService, type SessionResponse } from '../auth/session-cookie.service.js';
import { BarbershopsModule, BarbershopsService } from '../barbershops/barbershops.module.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { ClientsModule } from '../clients/clients.module.js';
import { PackagesModule } from '../packages/packages.module.js';
import { myPackageSchema } from '../packages/packages.responses.js';
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
// A página pública segue funcionando no modo só leitura do painel (business-rules §12).
@AllowedWhenReadOnly()
@Controller('public/:slug')
export class PublicBookingController {
  constructor(
    @Inject(PublicBookingService) private readonly booking: PublicBookingService,
    @Inject(SessionCookieService) private readonly cookies: SessionCookieService,
    @Inject(BarbershopsService) private readonly barbershops: BarbershopsService,
  ) {}

  @Public()
  @Throttle(BROWSE_THROTTLE)
  @ApiResult(publicBarbershopSchema)
  @ApiOperation({ summary: 'Dados públicos da barbearia' })
  @Get()
  info(@Param('slug', { schema: slugSchema }) slug: string) {
    return this.booking.info(slug);
  }

  /**
   * Logo da barbearia, sempre WebP reprocessado no upload. O frontend põe a versão do
   * logo na URL (?v=), então a imagem pode ficar em cache por um dia.
   */
  @Public()
  @Throttle(BROWSE_THROTTLE)
  @ApiOkResponse({
    description: 'Imagem do logo (WebP)',
    content: { 'image/webp': { schema: { type: 'string', format: 'binary' } } },
  })
  @ApiOperation({ summary: 'Logo da barbearia' })
  @Get('logo')
  async logo(
    @Param('slug', { schema: slugSchema }) slug: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const logo = await this.barbershops.logo(slug);
    response.setHeader('Cache-Control', 'public, max-age=86400');
    return new StreamableFile(logo.body, { type: logo.contentType, length: logo.body.length });
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
    return this.cookies.respond(await this.booking.register(slug, input), response, 'client');
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
    return this.cookies.respond(await this.booking.login(slug, input), response, 'client');
  }

  @RequirePermissions('bookings:self')
  @ApiResult(z.array(clientAppointmentViewSchema))
  @ApiOperation({ summary: 'Meus agendamentos' })
  @Get('me/appointments')
  myAppointments(@Param('slug', { schema: slugSchema }) slug: string) {
    return this.booking.myAppointments(slug);
  }

  @RequirePermissions('bookings:self')
  @ApiResult(z.array(myPackageSchema))
  @ApiOperation({ summary: 'Meus pacotes (saldo e validade)' })
  @Get('me/packages')
  myPackages(@Param('slug', { schema: slugSchema }) slug: string) {
    return this.booking.myPackages(slug);
  }

  @RequirePermissions('bookings:self')
  @Throttle(BOOKING_THROTTLE)
  @Idempotent()
  @ApiResult(clientAppointmentViewSchema, 201)
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
  @ApiResult(clientAppointmentViewSchema)
  @ApiOperation({ summary: 'Cancela meu agendamento' })
  @ApiProblem(422, 'cancellation-window-closed', 'Fora do prazo de cancelamento online.')
  @Post('me/appointments/:id/cancel')
  cancel(@Param('slug', { schema: slugSchema }) slug: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.booking.cancel(slug, id);
  }

  @RequirePermissions('bookings:self')
  @Throttle(BOOKING_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @ApiResult(clientAppointmentViewSchema)
  @ApiOperation({ summary: 'Reagenda meu agendamento' })
  @ApiProblem(
    422,
    'reschedule-window-closed | not-reschedulable',
    'Fora do prazo de reagendamento online, ou o atendimento já começou, terminou ou foi cancelado.',
  )
  @ApiProblem(409, 'slot-unavailable', 'O novo horário não está disponível.')
  @Post('me/appointments/:id/reschedule')
  reschedule(
    @Param('slug', { schema: slugSchema }) slug: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: clientRescheduleSchema }) input: ClientRescheduleInput,
  ) {
    return this.booking.reschedule(slug, id, input);
  }
}

@Module({
  imports: [AppointmentsModule, BarbershopsModule, CatalogModule, ClientsModule, StaffModule, PackagesModule],
  controllers: [PublicBookingController],
  providers: [PublicBookingService],
})
export class PublicBookingModule {}
