import type { INestApplicationContext } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import sharp from 'sharp';
import type { AuthContext, RequestContext } from '../common/tenancy/request-context.js';
import { Clock } from '../common/time/clock.js';
import { localTimeToInstant, nextDate } from '../modules/appointments/availability.js';
import { AppointmentsService } from '../modules/appointments/appointments.service.js';
import { AuthService, type Session } from '../modules/auth/auth.service.js';
import { isPermission } from '../modules/auth/permissions.js';
import { BarbershopsService } from '../modules/barbershops/barbershops.module.js';
import { CatalogService } from '../modules/catalog/catalog.service.js';
import { ClientsService } from '../modules/clients/clients.service.js';
import type { PaymentMethod } from '../modules/finance/finance.service.js';
import { OrdersService } from '../modules/orders/orders.service.js';
import type { OrderItemInput } from '../modules/orders/orders.schemas.js';
import { PackagesService } from '../modules/packages/packages.service.js';
import { ProductsService } from '../modules/products/products.service.js';
import { PublicBookingService } from '../modules/public-booking/public-booking.service.js';
import { StaffService } from '../modules/staff/staff.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Seed de desenvolvimento: uma barbearia de demonstração com uma conta para cada papel e
 * dados suficientes para todas as telas terem o que mostrar:
 *
 * - ~5 semanas de histórico (atendimentos concluídos, faltas, cancelamentos, estornos),
 *   com comandas fechadas na data do atendimento: caixa, comissões e relatórios por período;
 * - hoje com todos os status na agenda e comandas aberta/fechada/estornada;
 * - a próxima semana parcialmente agendada, folga e férias na equipe;
 * - uma cliente com conta no agendamento online, com histórico, reservas futuras, uma
 *   reserva cancelada e outra reagendada por ela mesma;
 * - faltas com e sem justificativa;
 * - identidade visual própria (cores e logo) no painel e na página pública;
 * - produtos com entradas, vendas (com profissional e no balcão), ajuste e um abaixo do mínimo;
 * - uma segunda barbearia, com outra cor, para testar o isolamento entre tenants.
 *
 * Tudo passa pelos services de domínio (não por SQL): snapshots de preço, comissões,
 * conflito de horário e outbox seguem as regras reais. O histórico é gerado com sorteio
 * de semente fixa: rodar de novo num banco limpo dá o mesmo resultado.
 */

export const DEMO_PASSWORD = 'senha-forte-123';
export const DEMO_SLUG = 'barbearia-demo';
export const NEIGHBOR_SLUG = 'barbearia-vizinha';
const TIMEZONE = 'America/Sao_Paulo';
const HISTORY_DAYS = 35;
const UPCOMING_DAYS = 7;

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
  /** Demo que já existia: módulos acrescentados nesta execução (vazio = já estava completa). */
  added: string[];
}

type Clock24 = `${number}:${number}`;

const minutes = (clock: Clock24) => {
  const [hours, mins] = clock.split(':').map(Number);
  return hours! * 60 + mins!;
};

const DEMO_PRIMARY_COLOR = '#1f5f8b';
const DEMO_SECONDARY_COLOR = '#e3c567';
const NEIGHBOR_PRIMARY_COLOR = '#7a1f5c';

const pickPayment = weighted<PaymentMethod>([
  [45, 'PIX'],
  [20, 'CARD_CREDIT'],
  [20, 'CARD_DEBIT'],
  [15, 'CASH'],
]);

/** Instante de um horário local da demo (fuso da barbearia). */
const localAt = (date: string, time: Clock24) => localTimeToInstant(date, minutes(time), TIMEZONE);
const todayLocal = () => new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(new Date());

export async function seedDemo(app: INestApplicationContext): Promise<SeedResult> {
  const prisma = app.get(PrismaService);
  if (await prisma.barbershop.findUnique({ where: { slug: DEMO_SLUG }, select: { id: true } })) {
    return { created: false, slugs: [DEMO_SLUG, NEIGHBOR_SLUG], added: await completeDemo(app) };
  }

  const cls = app.get<ClsService<RequestContext>>(ClsService);
  const clock = app.get(Clock);
  const auth = app.get(AuthService);
  const staff = app.get(StaffService);
  const catalog = app.get(CatalogService);
  const clients = app.get(ClientsService);
  const appointments = app.get(AppointmentsService);
  const orders = app.get(OrdersService);
  const publicBooking = app.get(PublicBookingService);
  const products = app.get(ProductsService);
  const barbershops = app.get(BarbershopsService);

  /** Executa `fn` como se fosse uma requisição autenticada desta sessão. */
  const as = <T>(session: Session, fn: () => Promise<T>) =>
    cls.run(() => {
      cls.set('auth', toAuth(session));
      return fn();
    });

  const today = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(new Date());
  const yesterday = shiftDate(today, -1);
  const tomorrow = nextDate(today);
  const at = (date: string, time: Clock24) => localTimeToInstant(date, minutes(time), TIMEZONE);
  const random = mulberry32(20261026);

  // ───────────── Barbearia de demonstração e equipe ─────────────

  const owner = await auth.registerBarbershop({
    barbershopName: 'Barbearia Demo',
    slug: DEMO_SLUG,
    ownerName: DEMO_ACCOUNTS.owner.name,
    email: DEMO_ACCOUNTS.owner.email,
    password: DEMO_PASSWORD,
    ownerIsProfessional: true,
  });

  await as(owner, async () => {
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
    const shifts: Record<string, [Clock24, Clock24][]> = {
      [ze]: [['09:00', '18:00']],
      [bia.id]: [
        ['09:00', '12:00'],
        ['13:00', '19:00'],
      ],
      [rafa.id]: [['09:00', '18:00']],
    };
    for (const [membershipId, ranges] of Object.entries(shifts)) {
      await staff.replaceSchedule(membershipId, everyDay(ranges));
    }
    await staff.createTimeOff(bia.id, {
      startsAt: at(tomorrow, '15:00'),
      endsAt: at(tomorrow, '17:00'),
      reason: 'Dentista',
    });
    // Férias depois da janela de agenda gerada (aparecem em Equipe → folgas).
    await staff.createTimeOff(rafa.id, {
      startsAt: at(shiftDate(today, UPCOMING_DAYS + 1), '00:00'),
      endsAt: at(shiftDate(today, UPCOMING_DAYS + 6), '00:00'),
      reason: 'Férias',
    });

    await applyDemoBrand(app);

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
    const infantil = await catalog.createService({
      name: 'Corte infantil',
      description: 'Até 12 anos',
      priceCents: 4000,
      durationMinutes: 30,
    });
    const hidratacao = await catalog.createService({
      name: 'Hidratação',
      priceCents: 3000,
      durationMinutes: 20,
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
      productId: null,
      type: 'PERCENT',
      value: 4000,
    });
    await catalog.upsertCommissionRule({
      membershipId: null,
      serviceId: pigmentacao.id,
      productId: null,
      type: 'PERCENT',
      value: 5000,
    });
    await catalog.upsertCommissionRule({
      membershipId: bia.id,
      serviceId: null,
      productId: null,
      type: 'PERCENT',
      value: 3500,
    });
    await catalog.upsertCommissionRule({
      membershipId: bia.id,
      serviceId: barba.id,
      productId: null,
      type: 'FIXED',
      value: 1500,
    });
    await catalog.upsertCommissionRule({
      membershipId: rafa.id,
      serviceId: null,
      productId: null,
      type: 'PERCENT',
      value: 3000,
    });

    // ───────────── Produtos e estoque ─────────────

    const demoProducts = await createDemoProducts(
      app,
      at(shiftDate(today, -HISTORY_DAYS - 1), '09:00'),
      bia.id,
    );
    const { pomada, oleo, shampoo, cera } = demoProducts;
    /** Saldo acompanhado aqui para o seed nunca tentar vender o que não tem. */
    const stock = new Map(Object.values(demoProducts).map((product) => [product.id, product]));

    // ───────────── Clientes ─────────────

    // [nome, telefone, consentimento de marketing, aniversário neste mês daqui a N dias]
    const clientSpecs: [string, string | null, boolean, number | null][] = [
      ['Carlos Souza', '11988887777', true, 0],
      ['Marcos Oliveira', '11977776666', false, null],
      ['Pedro Henrique', '11966665555', false, 3],
      ['Lucas Ferreira', '11955554444', true, null],
      ['André Martins', '11944443333', false, null],
      ['João Pereira', '11933332222', false, 10],
      ['Rafael Gomes', '11922221111', true, null],
      ['Gustavo Rocha', '11911110000', false, null],
      ['Felipe Araújo', '11990001111', false, null],
      ['Thiago Barbosa', '11980002222', false, -5],
      ['Diego Cardoso', '11970003333', true, null],
      ['Bruno Teixeira', '11960004444', false, null],
      ['Vinícius Moreira', '11940006666', true, 15],
      ['Eduardo Nascimento', null, false, null],
      ['Henrique Castro', '11920008888', false, null],
      ['Leonardo Pinto', '11910009999', true, null],
      ['Matheus Correia', '11991112222', false, 7],
      ['Ricardo Nunes', '11981113333', false, null],
      ['Samuel Batista', '11971114444', false, null],
      ['Otávio Freitas', '11961115555', true, null],
    ];
    const client: Record<string, string> = {};
    for (const [name, phone, consent, birthdayInDays] of clientSpecs) {
      const created = await clients.create({
        name,
        phone: phone ?? undefined,
        email: `${slugify(name)}@exemplo.test`,
        birthDate:
          birthdayInDays === null ? undefined : birthdayThisMonth(today, birthdayInDays, 1985 + name.length),
        consents: consent ? { email: true, whatsapp: name.length % 2 === 0 } : undefined,
      });
      client[name.split(' ')[0]!] = created.id;
    }
    const regulars = Object.values(client);

    // ───────────── Ferramentas de agenda ─────────────

    /** Horas cheias já ocupadas por profissional e dia, para o gerador não criar conflito. */
    const busy = new Set<string>();
    const hourKey = (professionalId: string, date: string, hour: number) =>
      `${professionalId}|${date}|${hour}`;
    const markBusy = (professionalId: string, date: string, startHour: number, endHour: number) => {
      for (let hour = startHour; hour < endHour; hour++) busy.add(hourKey(professionalId, date, hour));
    };

    const book = async (
      professionalId: string,
      clientId: string,
      serviceIds: string[],
      startsAt: Date,
      notes?: string,
    ) => {
      const appointment = await appointments.create({
        professionalId,
        clientId,
        serviceIds,
        startsAt,
        notes,
      });
      const date = localDate(startsAt);
      markBusy(professionalId, date, localHour(startsAt), Math.ceil(localHour(appointment.endsAt, true)));
      return appointment;
    };

    /** Fecha a comanda no fim do atendimento (ou agora, se ele ainda não terminou). */
    const closeWith = async (
      appointment: { id: string; endsAt: Date },
      paymentMethod: PaymentMethod,
      extras: OrderItemInput[] = [],
    ) => {
      const closedAt = new Date(Math.min(appointment.endsAt.getTime() + 5 * 60_000, Date.now()));
      return clock.at(closedAt, async () => {
        const order = await orders.open({ appointmentId: appointment.id });
        for (const extra of extras) await orders.addItem(order.id, extra);
        return orders.close(order.id, { paymentMethod });
      });
    };

    const productWeights = weighted(
      [...stock.values()].map((product): [number, typeof product] => [product.weight, product]),
    );
    /** Produto vendido junto do atendimento: às vezes indicado pelo barbeiro, às vezes no balcão. */
    const productSale = (professionalId: string): OrderItemInput | null => {
      const product = productWeights(random());
      if (product.quantity < 1) return null;
      product.quantity--;
      return {
        productId: product.id,
        professionalId: random() < 0.7 ? professionalId : null,
        quantity: 1,
        discountCents: 0,
      };
    };

    const voidAt = (orderId: string, when: Date, reason: string) =>
      clock.at(new Date(Math.min(when.getTime(), Date.now())), () => orders.void(orderId, { reason }));

    // ───────────── Cliente com conta (agendamento online) ─────────────

    const paula = await publicBooking.register(DEMO_SLUG, {
      name: DEMO_ACCOUNTS.client.name,
      email: DEMO_ACCOUNTS.client.email,
      password: DEMO_PASSWORD,
      phone: '11950005555',
    });
    /** Primeiro horário livre do dia com a Bia, a partir de `from` (regras do online valem). */
    const bookOnline = (date: string, from: Clock24, serviceIds: string[]) =>
      as(paula, async () => {
        const availability = await publicBooking.availability(DEMO_SLUG, {
          date,
          serviceIds,
          professionalId: bia.id,
        });
        const slot = availability.professionals[0]?.starts.find((start) => start >= at(date, from));
        if (!slot) return null;
        const booked = await publicBooking.book(DEMO_SLUG, {
          professionalId: bia.id,
          serviceIds,
          startsAt: slot,
        });
        markBusy(bia.id, date, localHour(booked.startsAt), Math.ceil(localHour(booked.endsAt, true)));
        return booked;
      });

    /** Reagendamento pela própria cliente (até 24 h antes), para o primeiro horário a partir de `from`. */
    const rescheduleOnline = (appointmentId: string, date: string, from: Clock24, serviceIds: string[]) =>
      as(paula, async () => {
        const availability = await publicBooking.availability(DEMO_SLUG, {
          date,
          serviceIds,
          professionalId: bia.id,
        });
        const slot = availability.professionals[0]?.starts.find((start) => start >= at(date, from));
        if (!slot) return null;
        const moved = await publicBooking.reschedule(DEMO_SLUG, appointmentId, { startsAt: slot });
        markBusy(bia.id, date, localHour(moved.startsAt), Math.ceil(localHour(moved.endsAt, true)));
        return moved;
      });

    const paulaTomorrow = await bookOnline(tomorrow, '10:00', [corte.id]);
    const paulaId = paulaTomorrow?.client.id;
    // Marcou às 16h de daqui a 6 dias e depois ela mesma passou para a manhã (e-mail de remarcação no outbox).
    const toReschedule = await bookOnline(shiftDate(today, 6), '16:00', [corte.id, sobrancelha.id]);
    if (toReschedule) {
      await rescheduleOnline(toReschedule.id, shiftDate(today, 6), '09:00', [corte.id, sobrancelha.id]);
    }
    const toCancel = await bookOnline(shiftDate(today, 5), '11:00', [hidratacao.id]);
    if (toCancel) await as(paula, () => publicBooking.cancel(DEMO_SLUG, toCancel.id));

    // Histórico da Paula feito pelo balcão: o "Meus agendamentos" dela mostra o passado também.
    if (paulaId) {
      await closeWith(await book(bia.id, paulaId, [corte.id], at(shiftDate(today, -28), '10:00')), 'PIX');
      const rescheduled = await book(bia.id, paulaId, [corte.id], at(shiftDate(today, -21), '10:00'));
      await appointments.changeStatus(rescheduled.id, { status: 'CANCELLED', reason: 'Cliente remarcou' });
      await closeWith(
        await book(bia.id, paulaId, [corte.id, sobrancelha.id], at(shiftDate(today, -14), '10:00')),
        'CARD_DEBIT',
      );
    }

    // ───────────── Hoje, ontem e amanhã (montados à mão) ─────────────

    // Ontem: atendimentos concluídos (alimentam relatórios e comissões).
    await closeWith(await book(ze, client.Carlos!, [corte.id, barba.id], at(yesterday, '10:00')), 'PIX');
    await closeWith(await book(bia.id, client.Marcos!, [barba.id], at(yesterday, '11:00')), 'CASH');
    await closeWith(
      await book(rafa.id, client.Diego!, [pigmentacao.id], at(yesterday, '14:00')),
      'CARD_CREDIT',
    );
    const missedYesterday = await book(rafa.id, client.Bruno!, [corte.id], at(yesterday, '16:00'));
    await appointments.changeStatus(missedYesterday.id, { status: 'NO_SHOW' });

    // Hoje: um pouco de cada status, nas três colunas da agenda.
    await closeWith(await book(ze, client.Carlos!, [corte.id], at(today, '09:00')), 'PIX');
    await closeWith(await book(ze, client.Marcos!, [corte.id, barba.id], at(today, '10:00')), 'CASH');
    const noShow = await book(ze, client.Pedro!, [barba.id], at(today, '11:00'));
    await appointments.changeStatus(noShow.id, { status: 'NO_SHOW' });
    const inService = await book(ze, client.Lucas!, [corte.id], at(today, '14:00'));
    await appointments.changeStatus(inService.id, { status: 'IN_SERVICE' });
    await book(ze, client.André!, [pigmentacao.id], at(today, '16:00'), 'Cliente prefere máquina 2');

    const voidedToday = await book(bia.id, client.João!, [barba.id], at(today, '09:30'));
    const voided = await closeWith(voidedToday, 'CARD_DEBIT');
    await voidAt(
      voided.id,
      new Date(voidedToday.endsAt.getTime() + 30 * 60_000),
      'Cobrança em duplicidade na maquininha',
    );
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

    await closeWith(await book(rafa.id, client.Diego!, [corte.id], at(today, '09:00')), 'CARD_CREDIT');
    const confirmedRafa = await book(rafa.id, client.Bruno!, [pigmentacao.id], at(today, '11:00'));
    await appointments.changeStatus(confirmedRafa.id, { status: 'CONFIRMED' });
    await book(rafa.id, client.Lucas!, [corte.id], at(today, '15:30'));

    // Amanhã: alguns horários já ocupados (a Bia tem dentista das 15h às 17h).
    await book(ze, client.Gustavo!, [corte.id], at(tomorrow, '09:00'));
    await book(rafa.id, client.Felipe!, [barba.id], at(tomorrow, '10:00'));
    markBusy(bia.id, tomorrow, 15, 17);

    // Comanda avulsa aberta (cliente que chegou sem horário).
    await orders.open({
      items: [{ serviceId: barba.id, professionalId: rafa.id, quantity: 1, discountCents: 0 }],
    });

    // ───────────── Histórico e próximos dias (gerados) ─────────────

    const combos = weighted([
      [5, [corte]],
      [4, [corte, barba]],
      [2, [barba]],
      [2, [corte, sobrancelha]],
      [1, [pigmentacao]],
      [1, [infantil]],
      [1, [hidratacao, barba]],
    ]);
    const payments = pickPayment;
    const voidReasons = [
      'Lançado na comanda errada',
      'Cobrança em duplicidade na maquininha',
      'Cliente contestou o valor',
    ];
    const cancelReasons = ['Cliente desmarcou por mensagem', 'Imprevisto do cliente', 'Chuva forte'];
    let closedCount = 0;

    /** Para cada hora cheia livre do expediente, sorteia se há atendimento e qual. */
    const fillDay = async (date: string, occupancy: number, past: boolean) => {
      for (const [professionalId, ranges] of Object.entries(shifts)) {
        for (const [start, end] of ranges) {
          for (let hour = minutes(start) / 60; hour < minutes(end) / 60; hour++) {
            if (busy.has(hourKey(professionalId, date, hour)) || random() > occupancy) continue;
            const services = combos(random());
            const duration = services.reduce((sum, service) => sum + service.durationMinutes, 0);
            const offset = duration <= 45 && random() < 0.3 ? 15 : 0;
            const startsAt = at(date, `${hour}:${offset}`);
            const clientId = regulars[Math.floor(random() * regulars.length)]!;
            const appointment = await book(
              professionalId,
              clientId,
              services.map((service) => service.id),
              startsAt,
            );

            const outcome = random();
            if (!past) {
              if (outcome < 0.35 && date <= shiftDate(today, 2)) {
                await appointments.changeStatus(appointment.id, { status: 'CONFIRMED' });
              }
            } else if (outcome < 0.06) {
              // Cerca de um terço das faltas tem justificativa; as demais contam como "sem justificativa".
              await appointments.changeStatus(appointment.id, {
                status: 'NO_SHOW',
                reason: outcome < 0.02 ? 'Avisou depois que estava doente' : undefined,
              });
            } else if (outcome < 0.11) {
              await appointments.changeStatus(appointment.id, {
                status: 'CANCELLED',
                reason: cancelReasons[closedCount % cancelReasons.length],
              });
            } else {
              const extras: OrderItemInput[] = [];
              if (random() < 0.1 && !services.includes(sobrancelha)) {
                extras.push({ serviceId: sobrancelha.id, professionalId, quantity: 1, discountCents: 0 });
              }
              const product = random() < 0.2 ? productSale(professionalId) : null;
              if (product) extras.push(product);
              const order = await closeWith(appointment, payments(random()), extras);
              closedCount++;
              if (closedCount % 25 === 0) {
                await voidAt(
                  order.id,
                  new Date(appointment.endsAt.getTime() + 40 * 60_000),
                  voidReasons[(closedCount / 25) % voidReasons.length]!,
                );
                // O estorno devolve o produto ao estoque.
                if (product && 'productId' in product) stock.get(product.productId)!.quantity++;
              }
            }
          }
        }
      }
    };

    for (let offset = -HISTORY_DAYS; offset <= -1; offset++) {
      const date = shiftDate(today, offset);
      const weekday = weekdayOf(date);
      if (weekday === 0) continue; // domingo fechado no histórico: o gráfico mostra o ritmo da semana
      if (offset === -15) {
        // Reposição no meio do período (o shampoo fica de fora e termina abaixo do mínimo).
        for (const product of [pomada, oleo, cera]) {
          await clock.at(at(date, '08:30'), () =>
            products.addEntry(product.id, {
              quantity: 12,
              unitCostCents: 2100,
              note: 'Reposição do distribuidor',
            }),
          );
          product.quantity += 12;
        }
      }
      await fillDay(date, weekday === 6 ? 0.65 : weekday === 5 ? 0.5 : 0.35, true);
    }
    for (let offset = 1; offset <= UPCOMING_DAYS; offset++) {
      await fillDay(shiftDate(today, offset), 0.3 / offset + 0.1, false);
    }

    // Ajuste de inventário e uma venda de balcão hoje (produto sem profissional, sem comissão).
    if (cera.quantity >= 1) {
      await clock.at(at(yesterday, '19:00'), () =>
        products.adjust(cera.id, { quantity: -1, reason: 'Embalagem danificada' }),
      );
      cera.quantity--;
    }
    if (shampoo.quantity >= 1) {
      const counter = await orders.open({
        items: [{ productId: shampoo.id, professionalId: null, quantity: 1, discountCents: 0 }],
      });
      await orders.close(counter.id, { paymentMethod: 'CASH' });
      shampoo.quantity--;
    }

    // ───────────── Pacotes ─────────────

    await createDemoPackages(app, {
      corteId: corte.id,
      barbaId: barba.id,
      professionalId: bia.id,
      clients: {
        carlos: client.Carlos!,
        marcos: client.Marcos!,
        lucas: client.Lucas!,
        paula: paulaId ?? null,
      },
    });

    // LGPD: cliente que pediu exclusão. Some da lista, o histórico fica como "Cliente anonimizado".
    await clients.anonymize(client.Ricardo!);
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
    const marta = neighbor.profile.membership.id;
    // Outra marca (vinho, sem logo): cada barbearia vê só a própria identidade.
    await barbershops.update({ brandPrimaryColor: NEIGHBOR_PRIMARY_COLOR });
    await staff.replaceSchedule(marta, everyDay([['10:00', '20:00']]));
    const corte = await catalog.createService({
      name: 'Corte da Vizinha',
      priceCents: 4500,
      durationMinutes: 30,
    });
    const secret = await clients.create({ name: 'Cliente Secreto da Vizinha', phone: '21999990000' });
    const visit = await appointments.create({
      professionalId: marta,
      clientId: secret.id,
      serviceIds: [corte.id],
      startsAt: at(yesterday, '15:00'),
    });
    await clock.at(new Date(visit.endsAt.getTime() + 5 * 60_000), async () => {
      const order = await orders.open({ appointmentId: visit.id });
      await orders.close(order.id, { paymentMethod: 'PIX' });
    });
    await appointments.create({
      professionalId: marta,
      clientId: secret.id,
      serviceIds: [corte.id],
      startsAt: at(tomorrow, '11:00'),
    });
  });

  return { created: true, slugs: [DEMO_SLUG, NEIGHBOR_SLUG], added: [] };
}

// ───────────── Complemento de uma demo criada por versão anterior do seed ─────────────

/**
 * Quem já tem a demo no banco não precisa apagar tudo para ver um módulo novo: rodar o seed
 * de novo acrescenta só o que falta (cada passo confere se já existe), sem duplicar nem
 * apagar nada. Devolve a descrição do que foi acrescentado.
 */
export async function completeDemo(
  app: INestApplicationContext,
  slugs: { demo: string; neighbor: string } = { demo: DEMO_SLUG, neighbor: NEIGHBOR_SLUG },
): Promise<string[]> {
  const added: string[] = [];

  await asOwnerOf(app, slugs.demo, async (professionalIds) => {
    const products = app.get(ProductsService);
    if ((await products.list({ includeInactive: true })).length === 0) {
      await addProductsToExistingDemo(app, professionalIds);
      added.push('produtos e estoque (com vendas dos últimos 30 dias)');
    }
    const settings = await app.get(BarbershopsService).get();
    if (!settings.brand.primaryColor && !settings.brand.logoVersion) {
      await applyDemoBrand(app);
      added.push('identidade visual (cores e logo)');
    }
    if ((await app.get(PackagesService).list({ includeInactive: true })).length === 0) {
      if (await addPackagesToExistingDemo(app, professionalIds)) {
        added.push('pacotes (vendidos, em uso, reembolsado e vencido)');
      }
    }
  });

  await asOwnerOf(app, slugs.neighbor, async () => {
    const barbershops = app.get(BarbershopsService);
    if (!(await barbershops.get()).brand.primaryColor) {
      await barbershops.update({ brandPrimaryColor: NEIGHBOR_PRIMARY_COLOR });
      added.push('cor da Barbearia Vizinha');
    }
  });

  return added;
}

/**
 * Executa `fn` como o dono da barbearia (contexto de requisição autenticada), passando os
 * profissionais ativos. Não faz nada se a barbearia não existir.
 */
async function asOwnerOf(
  app: INestApplicationContext,
  slug: string,
  fn: (professionalIds: string[]) => Promise<void>,
): Promise<void> {
  const prisma = app.get(PrismaService);
  const shop = await prisma.barbershop.findUnique({ where: { slug }, select: { id: true } });
  if (!shop) return;
  const { owner, professionals } = await prisma.withContext({ barbershopId: shop.id }, async (tx) => ({
    owner: await tx.membership.findFirst({
      where: { barbershopId: shop.id, active: true, role: { key: 'owner' } },
      select: { id: true, userId: true, role: { select: { permissions: true } } },
    }),
    professionals: await tx.membership.findMany({
      where: { barbershopId: shop.id, active: true, isProfessional: true },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    }),
  }));
  if (!owner) return;

  const cls = app.get<ClsService<RequestContext>>(ClsService);
  await cls.run(async () => {
    cls.set('auth', {
      userId: owner.userId,
      barbershopId: shop.id,
      membershipId: owner.id,
      permissions: owner.role.permissions.filter(isPermission),
    });
    await fn(professionals.map((professional) => professional.id));
  });
}

/**
 * Produtos numa demo antiga: o histórico de atendimentos já existe, então as vendas entram
 * como comandas de balcão nos últimos 30 dias (às vezes com o profissional que indicou).
 */
async function addProductsToExistingDemo(app: INestApplicationContext, professionalIds: string[]) {
  const clock = app.get(Clock);
  const orders = app.get(OrdersService);
  const products = app.get(ProductsService);
  const today = todayLocal();
  const random = mulberry32(20261027);

  // O segundo profissional (a Bia, na demo) tem regra própria no óleo.
  const demoProducts = await createDemoProducts(
    app,
    localAt(shiftDate(today, -31), '09:00'),
    professionalIds[1] ?? professionalIds[0] ?? null,
  );
  const { pomada, oleo, shampoo, cera } = demoProducts;
  const pick = weighted(
    Object.values(demoProducts).map((product): [number, DemoProduct] => [product.weight, product]),
  );

  for (let offset = -30; offset <= -1; offset++) {
    const date = shiftDate(today, offset);
    if (weekdayOf(date) === 0) continue;
    if (offset === -15) {
      for (const product of [pomada, oleo, cera]) {
        await clock.at(localAt(date, '08:30'), () =>
          products.addEntry(product.id, {
            quantity: 12,
            unitCostCents: 2100,
            note: 'Reposição do distribuidor',
          }),
        );
        product.quantity += 12;
      }
    }
    const sales = Math.floor(random() * 3);
    for (let i = 0; i < sales; i++) {
      const product = pick(random());
      if (product.quantity < 1) continue;
      product.quantity--;
      const seller =
        professionalIds.length > 0 && random() < 0.7
          ? professionalIds[Math.floor(random() * professionalIds.length)]!
          : null;
      await clock.at(localAt(date, `${11 + i * 3}:00`), async () => {
        const order = await orders.open({
          items: [{ productId: product.id, professionalId: seller, quantity: 1, discountCents: 0 }],
        });
        await orders.close(order.id, { paymentMethod: pickPayment(random()) });
      });
    }
  }

  if (cera.quantity >= 1) {
    await clock.at(localAt(shiftDate(today, -1), '19:00'), () =>
      products.adjust(cera.id, { quantity: -1, reason: 'Embalagem danificada' }),
    );
  }
  // O shampoo termina perto do fim: aparece no alerta de reposição.
  if (shampoo.quantity > 4) {
    await products.adjust(shampoo.id, { quantity: -(shampoo.quantity - 3), reason: 'Inventário: vencidos' });
  }
}

/**
 * Pacotes numa demo antiga: acha os serviços e clientes da demo pelo nome. Se a demo foi
 * mexida a ponto de não ter corte/barba ou clientes, não inventa nada (devolve false).
 */
async function addPackagesToExistingDemo(app: INestApplicationContext, professionalIds: string[]) {
  const catalog = app.get(CatalogService);
  const clients = app.get(ClientsService);
  const services = await catalog.listServices({ includeInactive: false });
  const corte = services.find((service) => service.name === 'Corte masculino') ?? services[0];
  const barba = services.find((service) => service.name === 'Barba') ?? services[1] ?? corte;
  const professionalId = professionalIds[1] ?? professionalIds[0];
  if (!corte || !barba || !professionalId) return false;

  const byName = async (name: string) =>
    (await clients.list({ search: name, limit: 1 })).items[0]?.id ?? null;
  const list = (await clients.list({ limit: 4 })).items.map((item) => item.id);
  const carlos = (await byName('Carlos Souza')) ?? list[0];
  const marcos = (await byName('Marcos Oliveira')) ?? list[1];
  const lucas = (await byName('Lucas Ferreira')) ?? list[2];
  if (!carlos || !marcos || !lucas) return false;

  await createDemoPackages(app, {
    corteId: corte.id,
    barbaId: barba.id,
    professionalId,
    clients: { carlos, marcos, lucas, paula: await byName(DEMO_ACCOUNTS.client.name) },
  });
  return true;
}

// ───────────── Peças reaproveitadas pelo seed completo e pelo complemento ─────────────

/**
 * Pacotes da demo (business-rules §6), com histórico nas datas certas: um combo em uso,
 * um pacote da cliente online (ela vê o saldo em "Meus agendamentos"), um reembolsado e
 * um vencido com sessão sobrando. Precisa de contexto autenticado de quem gerencia.
 */
async function createDemoPackages(
  app: INestApplicationContext,
  demo: {
    corteId: string;
    barbaId: string;
    professionalId: string;
    clients: { carlos: string; marcos: string; lucas: string; paula: string | null };
  },
): Promise<void> {
  const clock = app.get(Clock);
  const orders = app.get(OrdersService);
  const packages = app.get(PackagesService);
  const today = todayLocal();
  const on = (days: number, time: Clock24) => localAt(shiftDate(today, days), time);

  const combo = await packages.create({
    name: 'Combo do mês',
    description: '4 cortes + 2 barbas',
    priceCents: 22000,
    validityDays: 60,
    commissionOnSessions: true,
    items: [
      { serviceId: demo.corteId, quantity: 4 },
      { serviceId: demo.barbaId, quantity: 2 },
    ],
  });
  const barbaMensal = await packages.create({
    name: 'Barba mensal',
    description: '4 barbas (sessões sem comissão)',
    priceCents: 12000,
    validityDays: 30,
    commissionOnSessions: false,
    items: [{ serviceId: demo.barbaId, quantity: 4 }],
  });

  /** Vende na comanda do cliente, na data dada; devolve o pacote comprado. */
  const sell = (clientId: string, packageId: string, at: Date) =>
    clock.at(at, async () => {
      const order = await orders.open({ clientId, items: [{ packageId, quantity: 1, discountCents: 0 }] });
      await orders.close(order.id, { paymentMethod: 'PIX' });
      const sold = await packages.listSold({ clientId });
      return sold.find((row) => row.orderId === order.id)!.id;
    });
  /** Atendimento avulso pago com uma sessão do pacote, na data dada. */
  const use = (clientId: string, clientPackageId: string, serviceId: string, at: Date) =>
    clock.at(at, async () => {
      const order = await orders.open({
        clientId,
        items: [{ serviceId, professionalId: demo.professionalId, quantity: 1, discountCents: 0 }],
      });
      await orders.applyPackage(order.id, order.items[0]!.id, { clientPackageId });
      await orders.close(order.id, { paymentMethod: 'PIX' });
    });

  const carlos = await sell(demo.clients.carlos, combo.id, on(-20, '10:30'));
  await use(demo.clients.carlos, carlos, demo.corteId, on(-13, '10:30'));
  await use(demo.clients.carlos, carlos, demo.barbaId, on(-6, '10:30'));

  if (demo.clients.paula) {
    const paula = await sell(demo.clients.paula, combo.id, on(-10, '18:30'));
    await use(demo.clients.paula, paula, demo.corteId, on(-3, '18:30'));
  }

  const marcos = await sell(demo.clients.marcos, barbaMensal.id, on(-25, '11:30'));
  await clock.at(on(-5, '17:00'), () =>
    packages.refund(marcos, { amountCents: 7200, paymentMethod: 'PIX', reason: 'Cliente mudou de cidade' }),
  );

  // Vencido: comprado há 40 dias com validade de 30, uma sessão usada e três perdidas.
  const lucas = await sell(demo.clients.lucas, barbaMensal.id, on(-40, '12:00'));
  await use(demo.clients.lucas, lucas, demo.barbaId, on(-35, '12:00'));
}

interface DemoProduct {
  id: string;
  name: string;
  /** Saldo acompanhado pelo seed (para nunca tentar vender o que não tem). */
  quantity: number;
  /** Peso no sorteio das vendas. */
  weight: number;
}

/**
 * Produtos da demo com a entrada inicial em `firstDay`, um produto desativado e as regras
 * de comissão de produto (só regra de produto; o padrão do profissional não vale).
 * Precisa rodar num contexto autenticado de quem gerencia a barbearia.
 */
async function createDemoProducts(
  app: INestApplicationContext,
  firstDay: Date,
  oleoSellerId: string | null,
): Promise<Record<'pomada' | 'oleo' | 'shampoo' | 'cera', DemoProduct>> {
  const clock = app.get(Clock);
  const products = app.get(ProductsService);
  const catalog = app.get(CatalogService);

  // [chave, nome, preço, custo, estoque mínimo, entrada inicial, peso nas vendas]
  const specs = [
    ['pomada', 'Pomada modeladora', 4500, 2200, 5, 30, 4],
    ['oleo', 'Óleo para barba', 3500, 1800, 3, 20, 3],
    ['shampoo', 'Shampoo anticaspa', 3000, 1500, 4, 8, 3],
    ['cera', 'Cera capilar', 4000, 2000, null, 15, 1],
  ] as const;
  const created = {} as Record<'pomada' | 'oleo' | 'shampoo' | 'cera', DemoProduct>;
  for (const [key, name, priceCents, costCents, minStockQuantity, initial, weight] of specs) {
    const product = await products.create({ name, priceCents, costCents, minStockQuantity });
    await clock.at(firstDay, () =>
      products.addEntry(product.id, { quantity: initial, unitCostCents: costCents, note: 'Estoque inicial' }),
    );
    created[key] = { id: product.id, name, quantity: initial, weight };
  }
  const gel = await products.create({ name: 'Gel fixador (desativado)', priceCents: 2500, costCents: 1200 });
  await products.update(gel.id, { active: false });

  await catalog.upsertCommissionRule({
    membershipId: null,
    serviceId: null,
    productId: created.pomada.id,
    type: 'FIXED',
    value: 500,
  });
  if (oleoSellerId) {
    await catalog.upsertCommissionRule({
      membershipId: oleoSellerId,
      serviceId: null,
      productId: created.oleo.id,
      type: 'PERCENT',
      value: 1000,
    });
  }
  return created;
}

/**
 * Azul e dourado no lugar do cobre padrão: painel e página pública saem com a marca da
 * demo. O logo passa pelo mesmo caminho do upload (validação e reprocessamento).
 */
async function applyDemoBrand(app: INestApplicationContext): Promise<void> {
  const barbershops = app.get(BarbershopsService);
  await barbershops.update({
    brandPrimaryColor: DEMO_PRIMARY_COLOR,
    brandSecondaryColor: DEMO_SECONDARY_COLOR,
  });
  const logo = await demoLogo();
  await barbershops.replaceLogo({ buffer: logo, size: logo.length });
}

/**
 * Logo da demo (poste de barbearia nas cores da marca), desenhado aqui para não versionar
 * binário. Sai em PNG porque o upload aceita só PNG, JPEG ou WebP (SVG é recusado).
 */
async function demoLogo(): Promise<Buffer> {
  const stripes = [0, 1, 2, 3, 4, 5, 6]
    .map((i) => {
      const y = 40 + i * 28;
      return `<path d="M96 ${y + 20} L160 ${y - 12} L160 ${y + 2} L96 ${y + 34} Z" fill="#c0392b"/>`;
    })
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
    <circle cx="128" cy="128" r="124" fill="#e3c567"/>
    <circle cx="128" cy="128" r="108" fill="#1f5f8b"/>
    <defs><clipPath id="pole"><rect x="100" y="64" width="56" height="128" rx="10"/></clipPath></defs>
    <rect x="100" y="64" width="56" height="128" rx="10" fill="#ffffff"/>
    <g clip-path="url(#pole)">${stripes}</g>
    <rect x="90" y="50" width="76" height="18" rx="8" fill="#e3c567"/>
    <rect x="90" y="188" width="76" height="18" rx="8" fill="#e3c567"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

function toAuth(session: Session): AuthContext {
  return {
    userId: session.profile.user.id,
    barbershopId: session.profile.barbershop.id,
    membershipId: session.profile.membership.id,
    permissions: session.profile.permissions.filter(isPermission),
  };
}

function everyDay(ranges: [Clock24, Clock24][]) {
  return {
    intervals: [0, 1, 2, 3, 4, 5, 6].flatMap((weekday) =>
      ranges.map(([start, end]) => ({ weekday, start: minutes(start), end: minutes(end) })),
    ),
  };
}

function shiftDate(date: string, days: number): string {
  const next = new Date(`${date}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function weekdayOf(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

/** Data local (YYYY-MM-DD) do instante no fuso da demo. */
function localDate(instant: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(instant);
}

/** Hora local (fracionária se `fractional`) do instante no fuso da demo. */
function localHour(instant: Date, fractional = false): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const hour = Number(parts.find((part) => part.type === 'hour')!.value);
  const minute = Number(parts.find((part) => part.type === 'minute')!.value);
  return fractional ? hour + minute / 60 : hour;
}

/** Aniversário no mês corrente, `inDays` dias depois de hoje (limitado ao mês). */
function birthdayThisMonth(today: string, inDays: number, year: number): Date {
  const day = Math.min(Math.max(Number(today.slice(8, 10)) + inDays, 1), 28);
  return new Date(`${year}-${today.slice(5, 7)}-${String(day).padStart(2, '0')}T00:00:00Z`);
}

function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, '.');
}

/** Escolha ponderada: recebe um número em [0, 1) e devolve o item correspondente. */
function weighted<T>(options: [number, T][]): (roll: number) => T {
  const total = options.reduce((sum, [weight]) => sum + weight, 0);
  return (roll) => {
    let threshold = roll * total;
    for (const [weight, value] of options) {
      threshold -= weight;
      if (threshold < 0) return value;
    }
    return options.at(-1)![1];
  };
}

/** PRNG de semente fixa (mulberry32): o seed gera sempre os mesmos dados. */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
