import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { conflict, notFound, unprocessable } from '../../common/http/domain-error.js';
import { TenantDb } from '../../common/tenancy/tenant-db.service.js';
import { PrismaService, setDbContext, type Tx } from '../../prisma/prisma.service.js';
import type { AvailabilityQuery } from '../appointments/appointments.schemas.js';
import { AppointmentsService, type AppointmentView } from '../appointments/appointments.service.js';
import { AuthService, type Session } from '../auth/auth.service.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { DEFAULT_ROLES } from '../auth/permissions.js';
import { BarbershopsService, type BarbershopSettings } from '../barbershops/barbershops.module.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { ClientsService } from '../clients/clients.service.js';
import { StaffService } from '../staff/staff.service.js';
import type { PublicBookingInput, PublicLoginInput, PublicRegisterInput } from './public-booking.schemas.js';

/**
 * Agendamento online. EXCEÇÃO documentada à regra "tenant vem do token"
 * (business-rules §1): nas rotas abertas o tenant é resolvido pelo slug, no servidor.
 * Nas rotas autenticadas do cliente, o tenant do token precisa bater com o slug.
 */
@Injectable()
export class PublicBookingService {
  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BarbershopsService) private readonly barbershops: BarbershopsService,
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(StaffService) private readonly staff: StaffService,
    @Inject(ClientsService) private readonly clients: ClientsService,
    @Inject(AppointmentsService) private readonly appointments: AppointmentsService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  async info(slug: string) {
    const shop = await this.barbershops.findBySlug(slug);
    return {
      name: shop.name,
      slug: shop.slug,
      timezone: shop.timezone,
      cancellationMinNoticeMinutes: shop.cancellationMinNoticeMinutes,
    };
  }

  async services(slug: string) {
    const shop = await this.barbershops.findBySlug(slug);
    return this.db.runAs(shop.id, (tx) => this.catalog.activeServices(tx, shop.id));
  }

  async professionals(slug: string) {
    const shop = await this.barbershops.findBySlug(slug);
    const rows = await this.db.runAs(shop.id, (tx) => this.staff.listProfessionals(tx, shop.id));
    return rows.map((row) => ({ id: row.id, name: row.user.name }));
  }

  async availability(slug: string, query: AvailabilityQuery) {
    const shop = await this.barbershops.findBySlug(slug);
    const result = await this.db.runAs(shop.id, (tx) =>
      this.appointments.computeAvailability(
        tx,
        shop.id,
        query.date,
        query.serviceIds,
        query.professionalId ? [query.professionalId] : undefined,
      ),
    );
    return {
      date: result.date,
      timezone: result.timezone,
      durationMinutes: result.durationMinutes,
      professionals: result.professionals.map((professional) => ({
        id: professional.professionalId,
        name: professional.name,
        starts: professional.starts,
      })),
    };
  }

  async register(slug: string, input: PublicRegisterInput): Promise<Session> {
    const shop = await this.barbershops.findBySlug(slug);
    const passwordHash = await hashPassword(input.password);

    const { userId, membershipId } = await this.prisma.$transaction(async (tx) => {
      if (await tx.user.findUnique({ where: { email: input.email }, select: { id: true } })) {
        throw conflict('email-taken', 'Já existe uma conta com este e-mail. Entre com sua senha.');
      }
      const user = await tx.user.create({
        data: { email: input.email, name: input.name, passwordHash },
      });
      await setDbContext(tx, { barbershopId: shop.id, userId: user.id });
      const membershipId = await this.joinAsClient(tx, shop.id, user, input.phone);
      return { userId: user.id, membershipId };
    });
    return this.auth.openSession(userId, membershipId);
  }

  /**
   * Uma conta serve para várias barbearias: quem já tem conta (em qualquer barbearia)
   * entra e passa a ter um cadastro de cliente também nesta.
   */
  async login(slug: string, input: PublicLoginInput): Promise<Session> {
    const shop = await this.barbershops.findBySlug(slug);
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (!(await verifyPassword(user?.passwordHash, input.password)) || !user) {
      throw new UnauthorizedException('E-mail ou senha inválidos.');
    }

    const membershipId = await this.prisma.withContext(
      { barbershopId: shop.id, userId: user.id },
      async (tx) => {
        const membership = await tx.membership.findUnique({
          where: { barbershopId_userId: { barbershopId: shop.id, userId: user.id } },
          select: { id: true, active: true },
        });
        if (membership && !membership.active) {
          throw new UnauthorizedException('E-mail ou senha inválidos.');
        }
        return membership?.id ?? (await this.joinAsClient(tx, shop.id, user));
      },
    );
    return this.auth.openSession(user.id, membershipId);
  }

  async myAppointments(slug: string): Promise<AppointmentView[]> {
    const shop = await this.assertTokenMatches(slug);
    return this.db.run(async (tx, auth) => {
      const clientId = await this.clients.findIdForUser(tx, shop.id, auth.userId);
      return this.appointments.listForClient(tx, shop.id, clientId);
    });
  }

  async book(slug: string, input: PublicBookingInput): Promise<AppointmentView> {
    const shop = await this.assertTokenMatches(slug);
    return this.db.run(async (tx, auth) => {
      const clientId = await this.clients.findIdForUser(tx, shop.id, auth.userId);
      const professionalId = input.professionalId ?? (await this.pickFreeProfessional(tx, shop, input));
      return this.appointments.book(tx, shop.id, {
        professionalId,
        clientId,
        serviceIds: input.serviceIds,
        startsAt: input.startsAt,
        source: 'ONLINE',
        createdByUserId: auth.userId,
      });
    });
  }

  /** Política de cancelamento (business-rules §2): até N minutos antes, configurável. */
  async cancel(slug: string, appointmentId: string): Promise<AppointmentView> {
    const shop = await this.assertTokenMatches(slug);
    return this.db.run(async (tx, auth) => {
      const clientId = await this.clients.findIdForUser(tx, shop.id, auth.userId);
      const appointment = await this.appointments.getInTx(tx, shop.id, appointmentId);
      if (appointment.client.id !== clientId) throw notFound('Agendamento');

      const deadline = appointment.startsAt.getTime() - shop.cancellationMinNoticeMinutes * 60_000;
      if (Date.now() > deadline) {
        throw unprocessable(
          'cancellation-window-closed',
          `Cancelamentos online só até ${formatNotice(shop.cancellationMinNoticeMinutes)} antes do horário. Fale com a barbearia.`,
        );
      }
      return this.appointments.cancelByClient(tx, shop.id, appointmentId);
    });
  }

  private async joinAsClient(
    tx: Tx,
    barbershopId: string,
    user: { id: string; name: string; email: string },
    phone?: string,
  ): Promise<string> {
    const role = await tx.role.findUniqueOrThrow({
      where: { barbershopId_key: { barbershopId, key: DEFAULT_ROLES.client.key } },
      select: { id: true },
    });
    const membership = await tx.membership.create({
      data: { barbershopId, userId: user.id, roleId: role.id },
      select: { id: true },
    });
    await this.clients.ensureForUser(tx, barbershopId, user, phone);
    return membership.id;
  }

  /** "Qualquer profissional": o primeiro (ordem da equipe) que tem o horário livre. */
  private async pickFreeProfessional(tx: Tx, shop: BarbershopSettings, input: PublicBookingInput) {
    const local = new Intl.DateTimeFormat('en-CA', { timeZone: shop.timezone }).format(input.startsAt);
    const availability = await this.appointments.computeAvailability(tx, shop.id, local, input.serviceIds);
    const free = availability.professionals.find((professional) =>
      professional.starts.some((start) => start.getTime() === input.startsAt.getTime()),
    );
    if (!free) throw conflict('slot-unavailable', 'Este horário não está mais disponível. Escolha outro.');
    return free.professionalId;
  }

  /** O token do cliente precisa ser desta barbearia; senão, para ele, ela "não existe". */
  private async assertTokenMatches(slug: string): Promise<BarbershopSettings> {
    const shop = await this.barbershops.findBySlug(slug);
    if (this.db.barbershopId !== shop.id) throw notFound('Barbearia');
    return shop;
  }
}

function formatNotice(minutes: number): string {
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? '1 hora' : `${hours} horas`;
  }
  return `${minutes} minutos`;
}
