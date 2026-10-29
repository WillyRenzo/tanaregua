import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import type { Env } from '../../config/env.js';
import { Clock } from '../../common/time/clock.js';
import { TenantDb } from '../../common/tenancy/tenant-db.service.js';
import type { Tx } from '../../prisma/prisma.service.js';
import { BarbershopsService, type BirthdaySettingsRow } from '../barbershops/barbershops.module.js';
import { ClientsService } from '../clients/clients.service.js';
import { OutboxService } from '../notifications/outbox.service.js';
import { SubscriptionsService } from '../subscriptions/subscriptions.service.js';
import { reachableBy, type MessagingContact } from './audience.js';
import { BIRTHDAY_SEND_HOUR, isBirthdayOn, localClock } from './birthdays.js';
import type { BirthdayEntry, BirthdaySettingsView } from './marketing.responses.js';
import {
  templateConfigSchema,
  type BirthdaySettingsInput,
  type ListBirthdaysQuery,
  type MessageChannel,
  type TemplateConfig,
} from './marketing.schemas.js';
import { DEFAULT_BIRTHDAY_EMAIL_TEXT } from './message-text.js';
import { WhatsAppConnectionService, whatsappNotConnected } from './whatsapp/whatsapp-connection.service.js';

/** O job roda a cada 10 minutos; a mensagem sai no primeiro ciclo depois da hora de envio. */
const JOB_INTERVAL_MS = 10 * 60_000;

/** O JSON guardado no banco passou pela validação ao salvar; se não bater, trata como ausente. */
export function storedTemplate(value: unknown): TemplateConfig | null {
  const parsed = templateConfigSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * Mensagem automática de aniversário (business-rules §9): no dia, a partir das 9h no fuso da
 * barbearia, uma por cliente por ano (garantido por índice único), só pelo canal consentido.
 * Prefere o WhatsApp (modelo aprovado configurado e conta conectada); senão, e-mail.
 */
@Injectable()
export class BirthdaysService {
  private readonly logger = new Logger(BirthdaysService.name);
  private readonly enabled: boolean;
  private running = false;

  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(BarbershopsService) private readonly barbershops: BarbershopsService,
    @Inject(ClientsService) private readonly clients: ClientsService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(WhatsAppConnectionService) private readonly whatsapp: WhatsAppConnectionService,
    @Inject(SubscriptionsService) private readonly subscriptions: SubscriptionsService,
    @Inject(ConfigService) config: ConfigService<Env, true>,
  ) {
    // Nos testes o job é chamado sob demanda (enqueueDue), para ser determinístico.
    this.enabled = config.get('NODE_ENV') !== 'test';
  }

  settings(): Promise<BirthdaySettingsView> {
    return this.db.run(async (tx, auth) =>
      this.toView(
        await this.barbershops.birthdaySettings(tx, auth.barbershopId),
        await this.whatsapp.isConnected(tx, auth.barbershopId),
      ),
    );
  }

  async updateSettings(input: BirthdaySettingsInput): Promise<BirthdaySettingsView> {
    if (input.whatsappTemplate) {
      const connected = await this.db.run((tx, auth) => this.whatsapp.isConnected(tx, auth.barbershopId));
      if (!connected) throw whatsappNotConnected();
      await this.whatsapp.assertTemplate(input.whatsappTemplate);
    }
    return this.db.run(async (tx, auth) =>
      this.toView(
        await this.barbershops.updateBirthdaySettings(tx, auth.barbershopId, input),
        await this.whatsapp.isConnected(tx, auth.barbershopId),
      ),
    );
  }

  /**
   * Aniversariantes do mês, para a equipe: sem consentimento, o aniversário é só lembrete
   * interno. Mostra a mensagem deste ano, se já houve.
   */
  list(query: ListBirthdaysQuery): Promise<BirthdayEntry[]> {
    return this.db.run(async (tx, auth) => {
      const { timezone } = await this.barbershops.settings(tx, auth.barbershopId);
      const { year } = localClock(this.clock.now(), timezone);
      const month = String(query.month).padStart(2, '0');
      const contacts = (
        await this.clients.messagingContacts(tx, auth.barbershopId, { withBirthDate: true })
      ).filter((contact) => contact.birthDate?.slice(5, 7) === month);
      const messages = await tx.marketingMessage.findMany({
        where: {
          barbershopId: auth.barbershopId,
          kind: 'BIRTHDAY',
          birthdayYear: year,
          clientId: { in: contacts.map((contact) => contact.id) },
        },
        select: { clientId: true, channel: true, status: true, outcome: true, sentAt: true },
      });
      const byClient = new Map(messages.map(({ clientId, ...message }) => [clientId, message]));
      return contacts
        .map((contact) => ({
          clientId: contact.id,
          name: contact.name,
          day: Number(contact.birthDate!.slice(8, 10)),
          month: query.month,
          consents: { email: contact.emailConsentAt !== null, whatsapp: contact.whatsappConsentAt !== null },
          message: byClient.get(contact.id) ?? null,
        }))
        .sort((a, b) => a.day - b.day || a.name.localeCompare(b.name, 'pt-BR'));
    });
  }

  @Interval(JOB_INTERVAL_MS)
  async tick(): Promise<void> {
    if (!this.enabled || this.running) return;
    this.running = true;
    try {
      await this.enqueueDue(this.clock.now());
    } catch (error) {
      this.logger.error(error instanceof Error ? error.stack : String(error));
    } finally {
      this.running = false;
    }
  }

  /**
   * Enfileira as mensagens de aniversário devidas em `now`. Idempotente: rodar de novo no
   * mesmo dia (ou em outra instância) não duplica, por causa do índice único por ano.
   * O escopo por barbearia existe para os testes e2e, que rodam em paralelo no mesmo banco.
   * Devolve quantas mensagens foram enfileiradas.
   */
  async enqueueDue(now: Date, scope: { barbershopId?: string } = {}): Promise<number> {
    const shops = (await this.barbershops.withBirthdayMessages()).filter(
      (shop) => !scope.barbershopId || shop.id === scope.barbershopId,
    );
    let queued = 0;
    for (const shop of shops) {
      const clock = localClock(now, shop.timezone);
      if (clock.hour < BIRTHDAY_SEND_HOUR) continue;
      const count = await this.db.runAs(shop.id, (tx) => this.enqueueForShop(tx, shop.id, clock));
      if (count > 0) {
        this.logger.log({ event: 'birthday.queued', barbershopId: shop.id, count });
      }
      queued += count;
    }
    return queued;
  }

  private async enqueueForShop(
    tx: Tx,
    barbershopId: string,
    clock: { date: string; year: number },
  ): Promise<number> {
    const settings = await this.barbershops.birthdaySettings(tx, barbershopId);
    if (!settings.birthdayMessagesEnabled) return 0;
    // Sem pagamento (modo só leitura, business-rules §12), a mensagem automática fica pausada.
    // Pelo relógio real, como a API: volta na próxima rodada depois de assinar.
    const subscription = await this.subscriptions.summary(tx, barbershopId);
    if (!subscription || subscription.access.state === 'read-only') return 0;
    const whatsappReady =
      storedTemplate(settings.birthdayWhatsappTemplate) !== null &&
      (await this.whatsapp.isConnected(tx, barbershopId));

    const due = (await this.clients.messagingContacts(tx, barbershopId, { withBirthDate: true }))
      .filter((contact) => isBirthdayOn(contact.birthDate!, clock.date))
      .flatMap((contact) => {
        const channel = birthdayChannel(contact, whatsappReady);
        return channel ? [{ contact, channel }] : [];
      });
    if (due.length === 0) return 0;

    const created = await tx.marketingMessage.createManyAndReturn({
      data: due.map(({ contact, channel }) => ({
        barbershopId,
        clientId: contact.id,
        kind: 'BIRTHDAY' as const,
        channel,
        birthdayYear: clock.year,
      })),
      // Já felicitado neste ano (rodada anterior ou outra instância): não repete.
      skipDuplicates: true,
      select: { id: true },
    });
    await this.outbox.publishMany(
      tx,
      barbershopId,
      created.map((message) => ({ type: 'MarketingMessageQueued', payload: { messageId: message.id } })),
    );
    return created.length;
  }

  private toView(row: BirthdaySettingsRow, whatsappConnected: boolean): BirthdaySettingsView {
    return {
      enabled: row.birthdayMessagesEnabled,
      emailText: row.birthdayEmailText,
      defaultEmailText: DEFAULT_BIRTHDAY_EMAIL_TEXT,
      whatsappTemplate: storedTemplate(row.birthdayWhatsappTemplate),
      whatsappConnected,
      sendHour: BIRTHDAY_SEND_HOUR,
    };
  }
}

/** WhatsApp se o cliente aceitou e o canal está pronto; senão e-mail se aceitou; senão nada. */
function birthdayChannel(contact: MessagingContact, whatsappReady: boolean): MessageChannel | null {
  if (whatsappReady && reachableBy(contact, 'WHATSAPP')) return 'WHATSAPP';
  if (reachableBy(contact, 'EMAIL')) return 'EMAIL';
  return null;
}
