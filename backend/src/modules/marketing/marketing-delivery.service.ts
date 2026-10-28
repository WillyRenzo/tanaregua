import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { PrismaService, type Tx } from '../../prisma/prisma.service.js';
import { BarbershopsService } from '../barbershops/barbershops.module.js';
import { ClientsService } from '../clients/clients.service.js';
import { MailSender, type MailMessage } from '../notifications/mail-sender.js';
import { OutboxHandlers, type OutboxEventRef, type OutboxHandler } from '../notifications/outbox.service.js';
import { reachableBy } from './audience.js';
import { storedTemplate } from './birthdays.service.js';
import { DEFAULT_BIRTHDAY_EMAIL_TEXT, optOutFooter, renderText } from './message-text.js';
import {
  WhatsAppSender,
  type TemplateMessage,
  type WhatsAppCredentials,
} from './whatsapp/whatsapp-sender.js';
import { WhatsAppConnectionService } from './whatsapp/whatsapp-connection.service.js';
import { templateParameters, toWhatsAppNumber } from './whatsapp/whatsapp-templates.js';

/** Motivos de não envio, em código curto e sem dado pessoal (vão para o banco e para logs). */
type SkipReason = 'client-unavailable' | 'no-consent' | 'whatsapp-not-connected' | 'template-missing';

type Delivery =
  | { kind: 'done' }
  | { kind: 'skip'; reason: SkipReason }
  | { kind: 'email'; message: MailMessage }
  | { kind: 'whatsapp'; credentials: WhatsAppCredentials; message: TemplateMessage };

/**
 * Despacha uma mensagem de aniversário ou de campanha (evento MarketingMessageQueued).
 * O consentimento é conferido de novo na hora do envio: quem revogou depois de entrar na
 * fila não recebe. O envio acontece fora da transação; falha do provedor volta para o
 * outbox (retry com backoff) e, esgotadas as tentativas, a mensagem fica FAILED.
 *
 * E-mail tem chave de idempotência no provedor; a Cloud API do WhatsApp não tem, então uma
 * queda entre o envio e a gravação do status pode repetir a mensagem (entrega "ao menos uma vez").
 */
@Injectable()
export class MarketingDeliveryService implements OnModuleInit, OutboxHandler {
  private readonly logger = new Logger(MarketingDeliveryService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(OutboxHandlers) private readonly handlers: OutboxHandlers,
    @Inject(ClientsService) private readonly clients: ClientsService,
    @Inject(BarbershopsService) private readonly barbershops: BarbershopsService,
    @Inject(WhatsAppConnectionService) private readonly whatsapp: WhatsAppConnectionService,
    @Inject(MailSender) private readonly mail: MailSender,
    @Inject(WhatsAppSender) private readonly whatsappSender: WhatsAppSender,
  ) {}

  onModuleInit(): void {
    this.handlers.register('MarketingMessageQueued', this);
  }

  async handle(event: OutboxEventRef): Promise<void> {
    const messageId = event.payload['messageId'];
    if (typeof messageId !== 'string') throw new Error('Evento sem messageId');
    const { barbershopId } = event;

    const delivery = await this.prisma.withContext({ barbershopId }, (tx) =>
      this.plan(tx, barbershopId, messageId),
    );
    const log = { barbershopId, messageId };

    switch (delivery.kind) {
      case 'done':
        return;
      case 'skip':
        await this.finish(barbershopId, messageId, { status: 'SKIPPED', outcome: delivery.reason });
        this.logger.log({ event: 'marketing.message.skipped', ...log, reason: delivery.reason });
        return;
      case 'email':
        await this.mail.send(delivery.message, messageId);
        await this.finish(barbershopId, messageId, { status: 'SENT', sentAt: new Date() });
        this.logger.log({ event: 'marketing.message.sent', ...log, channel: 'EMAIL' });
        return;
      case 'whatsapp': {
        const sent = await this.whatsappSender.sendTemplate(delivery.credentials, delivery.message);
        await this.finish(barbershopId, messageId, {
          status: 'SENT',
          sentAt: new Date(),
          providerMessageId: sent.messageId,
        });
        this.logger.log({ event: 'marketing.message.sent', ...log, channel: 'WHATSAPP' });
        return;
      }
    }
  }

  async onDeadLetter(event: OutboxEventRef): Promise<void> {
    const messageId = event.payload['messageId'];
    if (typeof messageId !== 'string') return;
    await this.finish(event.barbershopId, messageId, { status: 'FAILED', outcome: 'provider-error' });
    this.logger.warn({ event: 'marketing.message.failed', barbershopId: event.barbershopId, messageId });
  }

  private async plan(tx: Tx, barbershopId: string, messageId: string): Promise<Delivery> {
    const message = await tx.marketingMessage.findFirst({
      where: { id: messageId, barbershopId },
      include: { campaign: true },
    });
    // Já processada (retry depois de gravar o status): nada a fazer.
    if (!message || message.status !== 'PENDING') return { kind: 'done' };

    const [contact] = await this.clients.messagingContacts(tx, barbershopId, { ids: [message.clientId] });
    if (!contact) return { kind: 'skip', reason: 'client-unavailable' };
    if (!reachableBy(contact, message.channel)) return { kind: 'skip', reason: 'no-consent' };

    const { name: barbershopName } = await this.barbershops.settings(tx, barbershopId);
    const values = { clientName: contact.name, barbershopName };

    if (message.channel === 'EMAIL') {
      const settings = message.campaign ? null : await this.barbershops.birthdaySettings(tx, barbershopId);
      const subject = message.campaign?.emailSubject ?? `Feliz aniversário! — ${barbershopName}`;
      const body = message.campaign?.emailBody ?? settings?.birthdayEmailText ?? DEFAULT_BIRTHDAY_EMAIL_TEXT;
      return {
        kind: 'email',
        message: {
          to: contact.email!,
          subject: renderText(subject, values),
          text: `${renderText(body, values)}\n\n—\n${optOutFooter(barbershopName)}`,
        },
      };
    }

    const template = message.campaign
      ? storedTemplate(message.campaign.whatsappTemplate)
      : storedTemplate((await this.barbershops.birthdaySettings(tx, barbershopId)).birthdayWhatsappTemplate);
    if (!template) return { kind: 'skip', reason: 'template-missing' };
    const credentials = await this.whatsapp.credentials(tx, barbershopId);
    if (!credentials) return { kind: 'skip', reason: 'whatsapp-not-connected' };
    return {
      kind: 'whatsapp',
      credentials,
      message: {
        to: toWhatsAppNumber(contact.phone)!,
        template: { name: template.name, language: template.language },
        parameters: templateParameters(template.parameters, values),
      },
    };
  }

  private async finish(
    barbershopId: string,
    messageId: string,
    data: {
      status: 'SENT' | 'SKIPPED' | 'FAILED';
      outcome?: string;
      sentAt?: Date;
      providerMessageId?: string;
    },
  ): Promise<void> {
    await this.prisma.withContext({ barbershopId }, (tx) =>
      tx.marketingMessage.updateMany({ where: { id: messageId, barbershopId, status: 'PENDING' }, data }),
    );
  }
}
