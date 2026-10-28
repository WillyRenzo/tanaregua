import { Inject, Injectable, Logger } from '@nestjs/common';
import { conflict, notFound, unprocessable } from '../../common/http/domain-error.js';
import { Clock } from '../../common/time/clock.js';
import { TenantDb } from '../../common/tenancy/tenant-db.service.js';
import type { Tx } from '../../prisma/prisma.service.js';
import { AppointmentsService } from '../appointments/appointments.service.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { ClientsService } from '../clients/clients.service.js';
import { OutboxService } from '../notifications/outbox.service.js';
import { reachableBy, selectAudience, type AudienceFacts, type MessagingContact } from './audience.js';
import { storedTemplate } from './birthdays.service.js';
import type { CampaignDetailView, CampaignPreview, CampaignView } from './marketing.responses.js';
import {
  audienceSchema,
  type Audience,
  type CreateCampaignInput,
  type MessageChannel,
  type PreviewCampaignInput,
} from './marketing.schemas.js';
import { WhatsAppConnectionService, whatsappNotConnected } from './whatsapp/whatsapp-connection.service.js';

/** [PROPOSTA] teto por campanha: protege o outbox e o custo por mensagem do WhatsApp. */
export const MAX_CAMPAIGN_RECIPIENTS = 2000;
const SAMPLE_SIZE = 5;
const DAY_MS = 24 * 60 * 60_000;

const campaignSelect = {
  id: true,
  name: true,
  channel: true,
  audience: true,
  emailSubject: true,
  emailBody: true,
  whatsappTemplate: true,
  recipientCount: true,
  createdAt: true,
} as const;

/**
 * Campanhas (business-rules §9): filtro simples, prévia de quantos recebem e confirmação.
 * Cada destinatário vira uma mensagem despachada pelo outbox; só recebe quem consentiu no
 * canal (conferido de novo na hora do envio).
 */
@Injectable()
export class CampaignsService {
  private readonly logger = new Logger(CampaignsService.name);

  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(ClientsService) private readonly clients: ClientsService,
    @Inject(AppointmentsService) private readonly appointments: AppointmentsService,
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(WhatsAppConnectionService) private readonly whatsapp: WhatsAppConnectionService,
  ) {}

  preview(input: PreviewCampaignInput): Promise<CampaignPreview> {
    return this.db.run(async (tx, auth) => {
      const { matched, recipients } = await this.resolve(
        tx,
        auth.barbershopId,
        input.channel,
        input.audience,
      );
      return {
        matched: matched.length,
        recipients: recipients.length,
        sample: recipients.slice(0, SAMPLE_SIZE).map(({ id, name }) => ({ id, name })),
      };
    });
  }

  async create(input: CreateCampaignInput): Promise<CampaignDetailView> {
    if (input.channel === 'WHATSAPP') {
      const connected = await this.db.run((tx, auth) => this.whatsapp.isConnected(tx, auth.barbershopId));
      if (!connected) throw whatsappNotConnected();
      await this.whatsapp.assertTemplate(input.whatsapp!);
    }
    const campaignId = await this.db.run(async (tx, auth) => {
      const { recipients } = await this.resolve(tx, auth.barbershopId, input.channel, input.audience);
      if (recipients.length === 0) {
        throw unprocessable(
          'empty-audience',
          'Nenhum cliente com consentimento neste canal atende ao filtro.',
        );
      }
      if (recipients.length > MAX_CAMPAIGN_RECIPIENTS) {
        throw unprocessable(
          'audience-too-large',
          `Uma campanha vai para no máximo ${MAX_CAMPAIGN_RECIPIENTS} clientes. Use um filtro mais específico.`,
        );
      }
      if (recipients.length !== input.confirmRecipients) {
        throw conflict(
          'audience-changed',
          `O público mudou desde a prévia: agora são ${recipients.length} clientes. Revise e confirme de novo.`,
        );
      }
      const campaign = await tx.campaign.create({
        data: {
          barbershopId: auth.barbershopId,
          name: input.name,
          channel: input.channel,
          audience: input.audience,
          emailSubject: input.channel === 'EMAIL' ? input.email!.subject : null,
          emailBody: input.channel === 'EMAIL' ? input.email!.body : null,
          whatsappTemplate: input.channel === 'WHATSAPP' ? input.whatsapp : undefined,
          recipientCount: recipients.length,
          createdByUserId: auth.userId,
        },
        select: { id: true },
      });
      const messages = await tx.marketingMessage.createManyAndReturn({
        data: recipients.map((contact) => ({
          barbershopId: auth.barbershopId,
          clientId: contact.id,
          campaignId: campaign.id,
          kind: 'CAMPAIGN' as const,
          channel: input.channel,
        })),
        select: { id: true },
      });
      await this.outbox.publishMany(
        tx,
        auth.barbershopId,
        messages.map((message) => ({ type: 'MarketingMessageQueued', payload: { messageId: message.id } })),
      );
      this.logger.log({
        event: 'campaign.created',
        barbershopId: auth.barbershopId,
        campaignId: campaign.id,
        channel: input.channel,
        audience: input.audience.kind,
        recipients: recipients.length,
      });
      return campaign.id;
    });
    return this.get(campaignId);
  }

  /** Últimas 50 campanhas, com a situação das mensagens. */
  list(): Promise<CampaignView[]> {
    return this.db.run(async (tx, auth) => {
      const rows = await tx.campaign.findMany({
        where: { barbershopId: auth.barbershopId },
        select: campaignSelect,
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      const counts = await this.counts(
        tx,
        auth.barbershopId,
        rows.map((row) => row.id),
      );
      return rows.map((row) => toView(row, counts.get(row.id)));
    });
  }

  get(campaignId: string): Promise<CampaignDetailView> {
    return this.db.run(async (tx, auth) => {
      const row = await tx.campaign.findFirst({
        where: { id: campaignId, barbershopId: auth.barbershopId },
        select: campaignSelect,
      });
      if (!row) throw notFound('Campanha');
      const messages = await tx.marketingMessage.findMany({
        where: { barbershopId: auth.barbershopId, campaignId },
        select: { clientId: true, status: true, outcome: true, sentAt: true },
      });
      const names = new Map(
        (
          await this.clients.messagingContacts(tx, auth.barbershopId, {
            ids: messages.map((message) => message.clientId),
          })
        ).map((contact) => [contact.id, contact.name]),
      );
      const counts = await this.counts(tx, auth.barbershopId, [row.id]);
      return {
        ...toView(row, counts.get(row.id)),
        emailBody: row.emailBody,
        whatsappTemplate: storedTemplate(row.whatsappTemplate),
        messages: messages
          .map((message) => ({
            ...message,
            // Cliente anonimizado depois do envio: o histórico fica, sem identificação.
            clientName: names.get(message.clientId) ?? 'Cliente anonimizado',
          }))
          .sort((a, b) => a.clientName.localeCompare(b.clientName, 'pt-BR')),
      };
    });
  }

  /** Quem atende ao filtro e, desses, quem pode receber pelo canal. */
  private async resolve(
    tx: Tx,
    barbershopId: string,
    channel: MessageChannel,
    audience: Audience,
  ): Promise<{ matched: MessagingContact[]; recipients: MessagingContact[] }> {
    const now = this.clock.now();
    const facts: AudienceFacts = { now, lastVisits: new Map(), serviceClientIds: new Set() };
    if (audience.kind === 'inactive') {
      facts.lastVisits = await this.appointments.lastCompletedVisits(tx, barbershopId);
    }
    if (audience.kind === 'service') {
      const services = await this.catalog.servicePrices(tx, barbershopId, [audience.serviceId]);
      if (!services.has(audience.serviceId)) {
        throw unprocessable('invalid-service', 'Serviço inexistente.');
      }
      facts.serviceClientIds = await this.appointments.clientsWithCompletedService(
        tx,
        barbershopId,
        audience.serviceId,
        new Date(now.getTime() - audience.days * DAY_MS),
      );
    }
    const matched = selectAudience(await this.clients.messagingContacts(tx, barbershopId), audience, facts);
    return { matched, recipients: matched.filter((contact) => reachableBy(contact, channel)) };
  }

  private async counts(tx: Tx, barbershopId: string, campaignIds: string[]) {
    const groups = await tx.marketingMessage.groupBy({
      by: ['campaignId', 'status'],
      where: { barbershopId, campaignId: { in: campaignIds } },
      _count: { _all: true },
    });
    const counts = new Map<string, CampaignView['counts']>();
    for (const group of groups) {
      const current = counts.get(group.campaignId!) ?? { pending: 0, sent: 0, skipped: 0, failed: 0 };
      current[group.status.toLowerCase() as keyof CampaignView['counts']] = group._count._all;
      counts.set(group.campaignId!, current);
    }
    return counts;
  }
}

type CampaignRow = {
  id: string;
  name: string;
  channel: MessageChannel;
  audience: unknown;
  emailSubject: string | null;
  whatsappTemplate: unknown;
  recipientCount: number;
  createdAt: Date;
};

function toView(row: CampaignRow, counts?: CampaignView['counts']): CampaignView {
  return {
    id: row.id,
    name: row.name,
    channel: row.channel,
    audience: audienceSchema.parse(row.audience),
    emailSubject: row.emailSubject,
    whatsappTemplateName: storedTemplate(row.whatsappTemplate)?.name ?? null,
    recipientCount: row.recipientCount,
    createdAt: row.createdAt,
    counts: counts ?? { pending: 0, sent: 0, skipped: 0, failed: 0 },
  };
}
