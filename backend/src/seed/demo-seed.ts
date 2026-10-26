import type { INestApplicationContext } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type { AuthContext, RequestContext } from '../common/tenancy/request-context.js';
import { localTimeToInstant, nextDate } from '../modules/appointments/availability.js';
import { AppointmentsService } from '../modules/appointments/appointments.service.js';
import { AuthService, type Session } from '../modules/auth/auth.service.js';
import { isPermission } from '../modules/auth/permissions.js';
import { CatalogService } from '../modules/catalog/catalog.service.js';
import { ClientsService } from '../modules/clients/clients.service.js';
import { OrdersService } from '../modules/orders/orders.service.js';
import { PublicBookingService } from '../modules/public-booking/public-booking.service.js';
import { StaffService } from '../modules/staff/staff.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Seed de desenvolvimento: uma barbearia de demonstração com uma conta para cada papel,
 * agenda de ontem/hoje/amanhã em todos os status, comandas fechadas/abertas/estornadas
 * e uma segunda barbearia para testar o isolamento entre tenants.
 *
 * Tudo passa pelos services de domínio (não por SQL): snapshots de preço, comissões,
 * conflito de horário e outbox seguem as regras reais.
 */

export const DEMO_PASSWORD = 'senha-forte-123';
export const DEMO_SLUG = 'barbearia-demo';
export const NEIGHBOR_SLUG = 'barbearia-vizinha';
const TIMEZONE = 'America/Sao_Paulo';

export const DEMO_ACCOUNTS = {
  owner: { email: 'dono@demo.tanaregua.test', name: 'José Ribeiro', role: 'Dono (também atende)' },
  receptionist: { email: 'recepcao@demo.tanaregua.test', name: 'Carla Mendes', role: 'Recepcionista' },
  professional: { email: 'bia@demo.tanaregua.test', name: 'Bia Santos', role: 'Profissional' },
  professional2: { email: 'rafa@demo.tanaregua.test', name: 'Rafa Lima', role: 'Profissional' },
  client: { email: 'cliente@demo.tanaregua.test', name: 'Paula Costa', role: 'Cliente (agendamento online)' },
  neighborOwner: {
    email: 'dono@vizinha.tanaregua.test',
    name: 'Marta Alves',
    role: 'Dona de outra barbearia (teste de isolamento)',
  },
} as const;

export interface SeedResult {
  created: boolean;
  slugs: string[];
}

type Clock = `${number}:${number}`;

const minutes = (clock: Clock) => {
  const [hours, mins] = clock.split(':').map(Number);
  return hours! * 60 + mins!;
};

export async function seedDemo(app: INestApplicationContext): Promise<SeedResult> {
  const prisma = app.get(PrismaService);
  if (await prisma.barbershop.findUnique({ where: { slug: DEMO_SLUG }, select: { id: true } })) {
    return { created: false, slugs: [DEMO_SLUG, NEIGHBOR_SLUG] };
  }

  const cls = app.get<ClsService<RequestContext>>(ClsService);
  const auth = app.get(AuthService);
  const staff = app.get(StaffService);
  const catalog = app.get(CatalogService);
  const clients = app.get(ClientsService);
  const appointments = app.get(AppointmentsService);
  const orders = app.get(OrdersService);
  const publicBooking = app.get(PublicBookingService);

  /** Executa `fn` como se fosse uma requisição autenticada desta sessão. */
  const as = <T>(session: Session, fn: () => Promise<T>) =>
    cls.run(() => {
      cls.set('auth', toAuth(session));
      return fn();
    });

  const today = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(new Date());
  const yesterday = shiftDate(today, -1);
  const tomorrow = nextDate(today);
  const at = (date: string, clock: Clock) => localTimeToInstant(date, minutes(clock), TIMEZONE);

  // ───────────── Barbearia de demonstração e equipe ─────────────

  const owner = await auth.registerBarbershop({
    barbershopName: 'Barbearia Demo',
    slug: DEMO_SLUG,
    ownerName: DEMO_ACCOUNTS.owner.name,
    email: DEMO_ACCOUNTS.owner.email,
    password: DEMO_PASSWORD,
    ownerIsProfessional: true,
  });

  return as(owner, async () => {
    await staff.create({
      name: DEMO_ACCOUNTS.receptionist.name,
      email: DEMO_ACCOUNTS.receptionist.email,
      password: DEMO_PASSWORD,
      roleKey: 'receptionist',
      isProfessional: false,
    });
    const bia = await staff.create({
      name: DEMO_ACCOUNTS.professional.name,
      email: DEMO_ACCOUNTS.professional.email,
      password: DEMO_PASSWORD,
      roleKey: 'professional',
      isProfessional: true,
    });
    const rafa = await staff.create({
      name: DEMO_ACCOUNTS.professional2.name,
      email: DEMO_ACCOUNTS.professional2.email,
      password: DEMO_PASSWORD,
      roleKey: 'professional',
      isProfessional: true,
    });
    const ze = owner.profile.membership.id;

    // Todos atendem todos os dias, para a demo funcionar em qualquer dia da semana.
    const everyDay = (ranges: [Clock, Clock][]) => ({
      intervals: [0, 1, 2, 3, 4, 5, 6].flatMap((weekday) =>
        ranges.map(([start, end]) => ({ weekday, start: minutes(start), end: minutes(end) })),
      ),
    });
    await staff.replaceSchedule(ze, everyDay([['09:00', '18:00']]));
    await staff.replaceSchedule(
      bia.id,
      everyDay([
        ['09:00', '12:00'],
        ['13:00', '19:00'],
      ]),
    );
    await staff.replaceSchedule(rafa.id, everyDay([['09:00', '18:00']]));
    await staff.createTimeOff(bia.id, {
      startsAt: at(tomorrow, '15:00'),
      endsAt: at(tomorrow, '17:00'),
      reason: 'Dentista',
    });

    // ───────────── Serviços e comissões ─────────────

    const corte = await catalog.createService({
      name: 'Corte masculino',
      priceCents: 5000,
      durationMinutes: 30,
    });
    const barba = await catalog.createService({ name: 'Barba', priceCents: 3500, durationMinutes: 20 });
    const sobrancelha = await catalog.createService({
      name: 'Sobrancelha',
      priceCents: 1500,
      durationMinutes: 10,
    });
    const pigmentacao = await catalog.createService({
      name: 'Pigmentação',
      description: 'Inclui lavagem',
      priceCents: 6000,
      durationMinutes: 45,
    });
    const navalhado = await catalog.createService({
      name: 'Navalhado (desativado)',
      priceCents: 4000,
      durationMinutes: 30,
    });
    await catalog.updateService(navalhado.id, { active: false });

    // Precedência: profissional+serviço > serviço > padrão do profissional.
    await catalog.upsertCommissionRule({
      membershipId: null,
      serviceId: corte.id,
      type: 'PERCENT',
      value: 4000,
    });
    await catalog.upsertCommissionRule({
      membershipId: bia.id,
      serviceId: null,
      type: 'PERCENT',
      value: 3500,
    });
    await catalog.upsertCommissionRule({
      membershipId: bia.id,
      serviceId: barba.id,
      type: 'FIXED',
      value: 1500,
    });
    await catalog.upsertCommissionRule({
      membershipId: rafa.id,
      serviceId: null,
      type: 'PERCENT',
      value: 3000,
    });

    // ───────────── Clientes ─────────────

    const birthdayThisMonth = `1992-${today.slice(5, 7)}-${today.slice(8, 10)}`;
    const clientSpecs: [string, string, boolean][] = [
      ['Carlos Souza', '11988887777', true],
      ['Marcos Oliveira', '11977776666', false],
      ['Pedro Henrique', '11966665555', false],
      ['Lucas Ferreira', '11955554444', true],
      ['André Martins', '11944443333', false],
      ['João Pereira', '11933332222', false],
      ['Rafael Gomes', '11922221111', true],
      ['Gustavo Rocha', '11911110000', false],
      ['Felipe Araújo', '11990001111', false],
      ['Thiago Barbosa', '11980002222', false],
      ['Diego Cardoso', '11970003333', true],
      ['Bruno Teixeira', '11960004444', false],
    ];
    const client: Record<string, string> = {};
    for (const [index, [name, phone, consent]] of clientSpecs.entries()) {
      const created = await clients.create({
        name,
        phone,
        email: `${name.split(' ')[0]!.toLowerCase()}@exemplo.test`,
        birthDate: index === 0 ? new Date(`${birthdayThisMonth}T00:00:00Z`) : undefined,
        marketingConsent: consent ? { channel: 'whatsapp' } : undefined,
      });
      client[name.split(' ')[0]!] = created.id;
    }

    // ───────────── Agenda: ontem, hoje e amanhã ─────────────

    const book = (
      professionalId: string,
      clientId: string,
      serviceIds: string[],
      startsAt: Date,
      notes?: string,
    ) => appointments.create({ professionalId, clientId, serviceIds, startsAt, notes });
    const closeWith = async (
      appointmentId: string,
      paymentMethod: 'PIX' | 'CASH' | 'CARD_DEBIT' | 'CARD_CREDIT',
    ) => {
      const order = await orders.open({ appointmentId });
      return orders.close(order.id, { paymentMethod });
    };

    // Ontem: atendimentos concluídos (alimentam relatórios e comissões).
    await closeWith((await book(ze, client.Carlos!, [corte.id, barba.id], at(yesterday, '10:00'))).id, 'PIX');
    await closeWith((await book(bia.id, client.Marcos!, [barba.id], at(yesterday, '11:00'))).id, 'CASH');
    await closeWith(
      (await book(rafa.id, client.Diego!, [pigmentacao.id], at(yesterday, '14:00'))).id,
      'CARD_CREDIT',
    );
    const missedYesterday = await book(rafa.id, client.Bruno!, [corte.id], at(yesterday, '16:00'));
    await appointments.changeStatus(missedYesterday.id, { status: 'NO_SHOW' });

    // Hoje: um pouco de cada status, nas três colunas da agenda.
    await closeWith((await book(ze, client.Carlos!, [corte.id], at(today, '09:00'))).id, 'PIX');
    await closeWith((await book(ze, client.Marcos!, [corte.id, barba.id], at(today, '10:00'))).id, 'CASH');
    const noShow = await book(ze, client.Pedro!, [barba.id], at(today, '11:00'));
    await appointments.changeStatus(noShow.id, { status: 'NO_SHOW' });
    const inService = await book(ze, client.Lucas!, [corte.id], at(today, '14:00'));
    await appointments.changeStatus(inService.id, { status: 'IN_SERVICE' });
    await book(ze, client.André!, [pigmentacao.id], at(today, '16:00'), 'Cliente prefere máquina 2');

    const voided = await closeWith(
      (await book(bia.id, client.João!, [barba.id], at(today, '09:30'))).id,
      'CARD_DEBIT',
    );
    await orders.void(voided.id, { reason: 'Cobrança em duplicidade na maquininha' });
    const openOrder = await orders.open({
      appointmentId: (await book(bia.id, client.Rafael!, [corte.id], at(today, '10:30'))).id,
    });
    await orders.addItem(openOrder.id, {
      serviceId: sobrancelha.id,
      professionalId: bia.id,
      quantity: 1,
      discountCents: 500,
    });
    const confirmed = await book(bia.id, client.Gustavo!, [corte.id], at(today, '13:30'));
    await appointments.changeStatus(confirmed.id, { status: 'CONFIRMED' });
    await book(bia.id, client.Felipe!, [corte.id, sobrancelha.id], at(today, '15:00'));
    const cancelled = await book(bia.id, client.Thiago!, [barba.id], at(today, '17:00'));
    await appointments.changeStatus(cancelled.id, { status: 'CANCELLED', reason: 'Cliente viajou' });

    await closeWith((await book(rafa.id, client.Diego!, [corte.id], at(today, '09:00'))).id, 'CARD_CREDIT');
    const confirmedRafa = await book(rafa.id, client.Bruno!, [pigmentacao.id], at(today, '11:00'));
    await appointments.changeStatus(confirmedRafa.id, { status: 'CONFIRMED' });
    await book(rafa.id, client.Lucas!, [corte.id], at(today, '15:30'));

    // Amanhã: alguns horários já ocupados.
    await book(ze, client.Gustavo!, [corte.id], at(tomorrow, '09:00'));
    await book(rafa.id, client.Felipe!, [barba.id], at(tomorrow, '10:00'));

    // Comanda avulsa aberta (cliente que chegou sem horário).
    await orders.open({
      items: [{ serviceId: barba.id, professionalId: rafa.id, quantity: 1, discountCents: 0 }],
    });

    // ───────────── Cliente com conta (agendamento online) ─────────────

    const customer = await publicBooking.register(DEMO_SLUG, {
      name: DEMO_ACCOUNTS.client.name,
      email: DEMO_ACCOUNTS.client.email,
      password: DEMO_PASSWORD,
      phone: '11950005555',
    });
    await as(customer, async () => {
      // Primeiro horário livre de amanhã com a Bia, a partir das 10h (regras do online valem).
      const availability = await publicBooking.availability(DEMO_SLUG, {
        date: tomorrow,
        serviceIds: [corte.id],
        professionalId: bia.id,
      });
      const slot = availability.professionals[0]?.starts.find((start) => start >= at(tomorrow, '10:00'));
      if (slot)
        await publicBooking.book(DEMO_SLUG, {
          professionalId: bia.id,
          serviceIds: [corte.id],
          startsAt: slot,
        });
    });

    // ───────────── Outra barbearia (isolamento entre tenants) ─────────────

    const neighbor = await auth.registerBarbershop({
      barbershopName: 'Barbearia Vizinha',
      slug: NEIGHBOR_SLUG,
      ownerName: DEMO_ACCOUNTS.neighborOwner.name,
      email: DEMO_ACCOUNTS.neighborOwner.email,
      password: DEMO_PASSWORD,
      ownerIsProfessional: true,
    });
    await as(neighbor, async () => {
      await staff.replaceSchedule(neighbor.profile.membership.id, everyDay([['10:00', '20:00']]));
      await catalog.createService({ name: 'Corte da Vizinha', priceCents: 4500, durationMinutes: 30 });
      await clients.create({ name: 'Cliente Secreto da Vizinha', phone: '21999990000' });
    });

    return { created: true, slugs: [DEMO_SLUG, NEIGHBOR_SLUG] };
  });
}

function toAuth(session: Session): AuthContext {
  return {
    userId: session.profile.user.id,
    barbershopId: session.profile.barbershop.id,
    membershipId: session.profile.membership.id,
    permissions: session.profile.permissions.filter(isPermission),
  };
}

function shiftDate(date: string, days: number): string {
  const next = new Date(`${date}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}
