import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { conflict, notFound, unprocessable } from '../../common/http/domain-error.js';
import type { AuthContext } from '../../common/tenancy/request-context.js';
import { TenantDb } from '../../common/tenancy/tenant-db.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { Tx } from '../../prisma/prisma.service.js';
import type { Permission } from '../auth/permissions.js';
import { BarbershopsService, type BarbershopSettings } from '../barbershops/barbershops.module.js';
import { CatalogService, type ServiceView } from '../catalog/catalog.service.js';
import { ClientsService } from '../clients/clients.service.js';
import { OutboxService } from '../notifications/outbox.service.js';
import { StaffService } from '../staff/staff.service.js';
import {
  assertTransition,
  BLOCKING_STATUSES,
  isReschedulable,
  type AppointmentStatus,
} from './appointment-status.js';
import type { AppointmentView } from './appointments.responses.js';
import type {
  AvailabilityQuery,
  ChangeStatusInput,
  CreateAppointmentInput,
  DayQuery,
  RangeQuery,
  UpdateAppointmentInput,
} from './appointments.schemas.js';
import {
  availableSlots,
  dayBounds,
  formatLocalTime,
  instantToLocal,
  weekdayOf,
  type ProfessionalSlots,
} from './availability.js';

const SLOT_STEP_MINUTES = 15;

const appointmentInclude = {
  professional: { select: { id: true, user: { select: { name: true } } } },
  client: { select: { id: true, name: true, phone: true } },
  items: {
    orderBy: { position: 'asc' },
    select: { serviceId: true, name: true, priceCents: true, durationMinutes: true },
  },
} as const satisfies Prisma.AppointmentInclude;

type AppointmentRow = Prisma.AppointmentGetPayload<{ include: typeof appointmentInclude }>;

export type { AppointmentView };

export const toAppointmentView = (row: AppointmentRow): AppointmentView => ({
  id: row.id,
  status: row.status,
  source: row.source,
  startsAt: row.startsAt,
  endsAt: row.endsAt,
  notes: row.notes,
  cancellationReason: row.cancellationReason,
  professional: { id: row.professional.id, name: row.professional.user.name },
  client: row.client,
  items: row.items,
  totalCents: row.items.reduce((total, item) => total + item.priceCents, 0),
});

export interface BookingRequest {
  professionalId: string;
  clientId: string;
  serviceIds: string[];
  startsAt: Date;
  notes?: string;
  source: 'PANEL' | 'ONLINE';
  createdByUserId: string;
}

const hasPermission = (auth: AuthContext, permission: Permission) => auth.permissions.includes(permission);

@Injectable()
export class AppointmentsService {
  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(BarbershopsService) private readonly barbershops: BarbershopsService,
    @Inject(StaffService) private readonly staff: StaffService,
    @Inject(ClientsService) private readonly clients: ClientsService,
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
  ) {}

  // ───────────── Leitura ─────────────

  dayAgenda(query: DayQuery) {
    return this.db.run(async (tx, auth) => {
      const settings = await this.barbershops.settings(tx, auth.barbershopId);
      const { from, to } = dayBounds(query.date, settings.timezone);
      const professionals = (await this.staff.listProfessionals(tx, auth.barbershopId)).filter(
        (professional) => this.canRead(auth, professional.id),
      );
      const ids = professionals.map((professional) => professional.id);
      const weekday = weekdayOf(query.date);

      // Sequencial de propósito: numa transação todas as queries usam a mesma conexão.
      const intervals = await this.staff.workIntervals(tx, auth.barbershopId, ids);
      const timeOffs = await this.staff.timeOffsBetween(tx, auth.barbershopId, ids, from, to);
      const appointments = await tx.appointment.findMany({
        where: {
          barbershopId: auth.barbershopId,
          professionalId: { in: ids },
          startsAt: { lt: to },
          endsAt: { gt: from },
          status: { not: 'CANCELLED' },
        },
        include: appointmentInclude,
        orderBy: { startsAt: 'asc' },
      });

      return {
        date: query.date,
        timezone: settings.timezone,
        professionals: professionals.map((professional) => ({
          id: professional.id,
          name: professional.user.name,
          workIntervals: intervals
            .filter((interval) => interval.membershipId === professional.id && interval.weekday === weekday)
            .sort((a, b) => a.startMinute - b.startMinute)
            .map(({ startMinute, endMinute }) => ({ startMinute, endMinute })),
          timeOffs: timeOffs.filter((timeOff) => timeOff.membershipId === professional.id),
          appointments: appointments
            .filter((appointment) => appointment.professionalId === professional.id)
            .map(toAppointmentView),
        })),
      };
    });
  }

  list(query: RangeQuery): Promise<AppointmentView[]> {
    return this.db.run(async (tx, auth) => {
      const professionalId = hasPermission(auth, 'appointments:read:any')
        ? query.professionalId
        : auth.membershipId;
      if (query.professionalId && professionalId !== query.professionalId) {
        throw new ForbiddenException('Você só pode ver a própria agenda.');
      }
      const rows = await tx.appointment.findMany({
        where: {
          barbershopId: auth.barbershopId,
          ...(professionalId ? { professionalId } : {}),
          startsAt: { lt: query.to },
          endsAt: { gt: query.from },
        },
        include: appointmentInclude,
        orderBy: { startsAt: 'asc' },
      });
      return rows.map(toAppointmentView);
    });
  }

  get(appointmentId: string): Promise<AppointmentView> {
    return this.db.run(async (tx, auth) => {
      const row = await this.find(tx, auth.barbershopId, appointmentId);
      if (!this.canRead(auth, row.professionalId)) throw notFound('Agendamento');
      return toAppointmentView(row);
    });
  }

  availability(query: AvailabilityQuery) {
    return this.db.run(async (tx, auth) => {
      if (query.professionalId && !this.canRead(auth, query.professionalId)) {
        throw new ForbiddenException('Você só pode ver a própria agenda.');
      }
      const professionalIds = query.professionalId
        ? [query.professionalId]
        : hasPermission(auth, 'appointments:read:any')
          ? undefined
          : [auth.membershipId];
      return this.computeAvailability(tx, auth.barbershopId, query.date, query.serviceIds, professionalIds);
    });
  }

  /** Também usado pelo agendamento online (rotas públicas). */
  async computeAvailability(
    tx: Tx,
    barbershopId: string,
    date: string,
    serviceIds: string[],
    professionalIds?: string[],
  ): Promise<{
    date: string;
    timezone: string;
    durationMinutes: number;
    professionals: (ProfessionalSlots & { name: string })[];
  }> {
    const settings = await this.barbershops.settings(tx, barbershopId);
    const services = await this.catalog.servicesForBooking(tx, barbershopId, serviceIds);
    const durationMinutes = totalDuration(services);
    const { from, to } = dayBounds(date, settings.timezone);

    const professionals = (await this.staff.listProfessionals(tx, barbershopId)).filter(
      (professional) => !professionalIds || professionalIds.includes(professional.id),
    );
    const ids = professionals.map((professional) => professional.id);
    const weekday = weekdayOf(date);

    const intervals = await this.staff.workIntervals(tx, barbershopId, ids);
    const timeOffs = await this.staff.timeOffsBetween(tx, barbershopId, ids, from, to);
    // Busca desde o dia anterior: um atendimento das 23h com buffer pode invadir este dia.
    const appointments = await this.blockingAppointments(
      tx,
      barbershopId,
      ids,
      new Date(from.getTime() - 24 * 3600_000),
      to,
    );

    const slots = availableSlots({
      date,
      timezone: settings.timezone,
      durationMinutes,
      bufferMinutes: settings.bufferMinutes,
      stepMinutes: SLOT_STEP_MINUTES,
      notBefore: new Date(),
      professionals: professionals.map((professional) => ({
        id: professional.id,
        intervals: intervals.filter(
          (interval) => interval.membershipId === professional.id && interval.weekday === weekday,
        ),
      })),
      busy: [
        ...timeOffs.map((timeOff) => ({
          professionalId: timeOff.membershipId,
          start: timeOff.startsAt,
          end: timeOff.endsAt,
        })),
        ...appointments.map((appointment) => ({
          professionalId: appointment.professionalId,
          start: appointment.startsAt,
          end: appointment.blockedUntil,
        })),
      ],
    });

    const names = new Map(professionals.map((professional) => [professional.id, professional.user.name]));
    return {
      date,
      timezone: settings.timezone,
      durationMinutes,
      professionals: slots.map((slot) => ({ ...slot, name: names.get(slot.professionalId)! })),
    };
  }

  // ───────────── Escrita ─────────────

  create(input: CreateAppointmentInput): Promise<AppointmentView> {
    return this.db.run(async (tx, auth) => {
      this.assertCanWrite(auth, input.professionalId);
      return this.book(tx, auth.barbershopId, {
        ...input,
        source: 'PANEL',
        createdByUserId: auth.userId,
      });
    });
  }

  /**
   * Cria o agendamento dentro de uma transação já com tenant definido.
   * Painel: aceita encaixe fora do expediente, mas nunca em folga nem sobreposto.
   * Online: só aceita um horário que esteja na grade de disponibilidade.
   */
  async book(tx: Tx, barbershopId: string, request: BookingRequest): Promise<AppointmentView> {
    const settings = await this.barbershops.settings(tx, barbershopId);
    await this.staff.assertProfessional(tx, barbershopId, request.professionalId);
    await this.clients.assertExists(tx, barbershopId, request.clientId);
    const services = await this.catalog.servicesForBooking(tx, barbershopId, request.serviceIds);

    const window = bookingWindow(request.startsAt, totalDuration(services), settings.bufferMinutes);

    if (request.source === 'ONLINE') {
      await this.assertSlotOffered(tx, barbershopId, request, settings);
    } else {
      await this.assertNoTimeOff(tx, barbershopId, request.professionalId, window);
    }
    await this.assertNoConflict(tx, barbershopId, request.professionalId, window, settings);

    const appointment = await tx.appointment.create({
      data: {
        barbershopId,
        professionalId: request.professionalId,
        clientId: request.clientId,
        startsAt: window.startsAt,
        endsAt: window.endsAt,
        blockedUntil: window.blockedUntil,
        source: request.source,
        notes: request.notes,
        createdByUserId: request.createdByUserId,
      },
    });
    await this.replaceItems(tx, barbershopId, appointment.id, services);
    await this.outbox.publish(tx, barbershopId, {
      type: 'AppointmentBooked',
      payload: { appointmentId: appointment.id },
    });
    return toAppointmentView(await this.find(tx, barbershopId, appointment.id));
  }

  update(appointmentId: string, input: UpdateAppointmentInput): Promise<AppointmentView> {
    return this.db.run(async (tx, auth) => {
      const current = await this.find(tx, auth.barbershopId, appointmentId);
      this.assertCanWrite(auth, current.professionalId);
      if (input.professionalId) this.assertCanWrite(auth, input.professionalId);
      if (!isReschedulable(current.status)) {
        throw unprocessable(
          'not-reschedulable',
          'Só é possível alterar agendamentos que ainda não começaram.',
        );
      }

      const settings = await this.barbershops.settings(tx, auth.barbershopId);
      const professionalId = input.professionalId ?? current.professionalId;
      if (input.professionalId) {
        await this.staff.assertProfessional(tx, auth.barbershopId, professionalId);
      }
      const services = input.serviceIds
        ? await this.catalog.servicesForBooking(tx, auth.barbershopId, input.serviceIds)
        : undefined;
      const durationMinutes = services ? totalDuration(services) : totalDuration(current.items);
      const window = bookingWindow(
        input.startsAt ?? current.startsAt,
        durationMinutes,
        settings.bufferMinutes,
      );

      await this.assertNoTimeOff(tx, auth.barbershopId, professionalId, window);
      await this.assertNoConflict(tx, auth.barbershopId, professionalId, window, settings, appointmentId);

      await tx.appointment.update({
        where: { id: appointmentId },
        data: {
          professionalId,
          startsAt: window.startsAt,
          endsAt: window.endsAt,
          blockedUntil: window.blockedUntil,
          notes: input.notes,
        },
      });
      if (services) await this.replaceItems(tx, auth.barbershopId, appointmentId, services);
      return toAppointmentView(await this.find(tx, auth.barbershopId, appointmentId));
    });
  }

  changeStatus(appointmentId: string, input: ChangeStatusInput): Promise<AppointmentView> {
    return this.db.run(async (tx, auth) => {
      const current = await this.find(tx, auth.barbershopId, appointmentId);
      this.assertCanWrite(auth, current.professionalId);
      assertTransition(current.status, input.status);
      return this.setStatus(tx, auth.barbershopId, appointmentId, input.status, input.reason);
    });
  }

  /** Cancelamento pelo próprio cliente (agendamento online), já validado pela política. */
  async cancelByClient(tx: Tx, barbershopId: string, appointmentId: string): Promise<AppointmentView> {
    const current = await this.find(tx, barbershopId, appointmentId);
    assertTransition(current.status, 'CANCELLED');
    return this.setStatus(tx, barbershopId, appointmentId, 'CANCELLED', 'Cancelado pelo cliente');
  }

  /**
   * Chamado pelo fechamento da comanda. Aceita concluir direto de SCHEDULED/CONFIRMED
   * porque na prática a recepção nem sempre marca "em atendimento".
   */
  async completeFromOrder(tx: Tx, barbershopId: string, appointmentId: string): Promise<void> {
    const current = await this.find(tx, barbershopId, appointmentId);
    if (!['SCHEDULED', 'CONFIRMED', 'IN_SERVICE'].includes(current.status)) {
      throw unprocessable('invalid-status-transition', 'Este agendamento não pode ser concluído.');
    }
    await tx.appointment.update({ where: { id: appointmentId }, data: { status: 'COMPLETED' } });
  }

  /** Contagem por status no período (relatório de no-show). Cancelados ficam de fora da taxa. */
  async statusCounts(tx: Tx, barbershopId: string, from: Date, to: Date) {
    const groups = await tx.appointment.groupBy({
      by: ['status'],
      where: { barbershopId, startsAt: { gte: from, lt: to } },
      _count: { _all: true },
    });
    return Object.fromEntries(groups.map((group) => [group.status, group._count._all])) as Partial<
      Record<AppointmentStatus, number>
    >;
  }

  /** Histórico do cliente (área "Meus agendamentos" do agendamento online). */
  async listForClient(tx: Tx, barbershopId: string, clientId: string): Promise<AppointmentView[]> {
    const rows = await tx.appointment.findMany({
      where: { barbershopId, clientId },
      include: appointmentInclude,
      orderBy: { startsAt: 'desc' },
      take: 50,
    });
    return rows.map(toAppointmentView);
  }

  /** Para outros módulos (comanda, notificações), dentro da transação deles. */
  async getInTx(tx: Tx, barbershopId: string, appointmentId: string): Promise<AppointmentView> {
    return toAppointmentView(await this.find(tx, barbershopId, appointmentId));
  }

  // ───────────── Regras internas ─────────────

  private async setStatus(
    tx: Tx,
    barbershopId: string,
    appointmentId: string,
    status: AppointmentStatus,
    reason?: string,
  ): Promise<AppointmentView> {
    await tx.appointment.update({
      where: { id: appointmentId },
      data: { status, ...(status === 'CANCELLED' ? { cancellationReason: reason ?? null } : {}) },
    });
    if (status === 'CANCELLED') {
      await this.outbox.publish(tx, barbershopId, {
        type: 'AppointmentCancelled',
        payload: { appointmentId },
      });
    }
    return toAppointmentView(await this.find(tx, barbershopId, appointmentId));
  }

  private blockingAppointments(
    tx: Tx,
    barbershopId: string,
    professionalIds: string[],
    from: Date,
    to: Date,
  ) {
    return tx.appointment.findMany({
      where: {
        barbershopId,
        professionalId: { in: professionalIds },
        status: { in: [...BLOCKING_STATUSES] },
        startsAt: { lt: to },
        blockedUntil: { gt: from },
      },
      select: { id: true, professionalId: true, startsAt: true, blockedUntil: true },
    });
  }

  /**
   * Pré-checagem só para dar uma mensagem amigável. A garantia real é a exclusion
   * constraint: se duas requisições passarem juntas por aqui, o banco barra a segunda.
   */
  private async assertNoConflict(
    tx: Tx,
    barbershopId: string,
    professionalId: string,
    window: BookingWindow,
    settings: BarbershopSettings,
    ignoreAppointmentId?: string,
  ): Promise<void> {
    const clash = (
      await this.blockingAppointments(
        tx,
        barbershopId,
        [professionalId],
        window.startsAt,
        window.blockedUntil,
      )
    ).find((appointment) => appointment.id !== ignoreAppointmentId);
    if (clash) {
      throw conflict(
        'appointment-conflict',
        `O profissional já tem um atendimento às ${formatLocalTime(clash.startsAt, settings.timezone)}.`,
      );
    }
  }

  private async assertNoTimeOff(tx: Tx, barbershopId: string, professionalId: string, window: BookingWindow) {
    const timeOffs = await this.staff.timeOffsBetween(
      tx,
      barbershopId,
      [professionalId],
      window.startsAt,
      window.endsAt,
    );
    if (timeOffs.length > 0) {
      throw unprocessable(
        'professional-unavailable',
        'O profissional está de folga ou bloqueado nesse horário.',
      );
    }
  }

  private async assertSlotOffered(
    tx: Tx,
    barbershopId: string,
    request: BookingRequest,
    settings: BarbershopSettings,
  ): Promise<void> {
    const { date } = instantToLocal(request.startsAt, settings.timezone);
    const availability = await this.computeAvailability(tx, barbershopId, date, request.serviceIds, [
      request.professionalId,
    ]);
    const offered = availability.professionals[0]?.starts.some(
      (start) => start.getTime() === request.startsAt.getTime(),
    );
    if (!offered) {
      throw conflict('slot-unavailable', 'Este horário não está mais disponível. Escolha outro.');
    }
  }

  private async replaceItems(tx: Tx, barbershopId: string, appointmentId: string, services: ServiceView[]) {
    await tx.appointmentItem.deleteMany({ where: { barbershopId, appointmentId } });
    await tx.appointmentItem.createMany({
      data: services.map((service, position) => ({
        barbershopId,
        appointmentId,
        serviceId: service.id,
        position,
        name: service.name,
        priceCents: service.priceCents,
        durationMinutes: service.durationMinutes,
      })),
    });
  }

  private async find(tx: Tx, barbershopId: string, appointmentId: string): Promise<AppointmentRow> {
    const row = await tx.appointment.findFirst({
      where: { id: appointmentId, barbershopId },
      include: appointmentInclude,
    });
    if (!row) throw notFound('Agendamento');
    return row;
  }

  private canRead(auth: AuthContext, professionalId: string): boolean {
    return hasPermission(auth, 'appointments:read:any') || professionalId === auth.membershipId;
  }

  private assertCanWrite(auth: AuthContext, professionalId: string): void {
    if (!hasPermission(auth, 'appointments:write:any') && professionalId !== auth.membershipId) {
      throw new ForbiddenException('Você só pode alterar a própria agenda.');
    }
  }
}

interface BookingWindow {
  startsAt: Date;
  endsAt: Date;
  blockedUntil: Date;
}

function totalDuration(services: { durationMinutes: number }[]): number {
  return services.reduce((total, service) => total + service.durationMinutes, 0);
}

function bookingWindow(startsAt: Date, durationMinutes: number, bufferMinutes: number): BookingWindow {
  const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);
  return { startsAt, endsAt, blockedUntil: new Date(endsAt.getTime() + bufferMinutes * 60_000) };
}
