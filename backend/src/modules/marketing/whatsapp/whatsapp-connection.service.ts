import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { SecretBox } from '../../../common/crypto/secret-box.js';
import { DomainError, unprocessable } from '../../../common/http/domain-error.js';
import { TenantDb } from '../../../common/tenancy/tenant-db.service.js';
import type { Tx } from '../../../prisma/prisma.service.js';
import type { ConnectWhatsAppInput, TemplateConfig } from '../marketing.schemas.js';
import type { WhatsAppConnectionView } from '../marketing.responses.js';
import { WhatsAppProviderError, WhatsAppSender, type WhatsAppCredentials } from './whatsapp-sender.js';
import { validateTemplateConfig, type WhatsAppTemplate } from './whatsapp-templates.js';

export const whatsappNotConnected = () =>
  unprocessable('whatsapp-not-connected', 'Conecte o WhatsApp da barbearia antes de usar modelos.');

const providerUnavailable = () =>
  new DomainError(
    'whatsapp-unavailable',
    'Bad Gateway',
    'O WhatsApp não respondeu. Tente de novo em alguns minutos.',
    HttpStatus.BAD_GATEWAY,
  );

/**
 * Conexão manual da conta do WhatsApp Business da barbearia (business-rules §9). O token é
 * conferido na Meta, guardado cifrado (ligado ao tenant) e nunca devolvido ao navegador.
 */
@Injectable()
export class WhatsAppConnectionService {
  private readonly logger = new Logger(WhatsAppConnectionService.name);

  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(SecretBox) private readonly secrets: SecretBox,
    @Inject(WhatsAppSender) private readonly sender: WhatsAppSender,
  ) {}

  get(): Promise<WhatsAppConnectionView> {
    return this.db.run((tx, auth) => this.view(tx, auth.barbershopId));
  }

  async connect(input: ConnectWhatsAppInput): Promise<WhatsAppConnectionView> {
    let account;
    try {
      account = await this.sender.verify(input);
    } catch (error) {
      if (!(error instanceof WhatsAppProviderError)) throw error;
      this.logger.warn({ event: 'whatsapp.verify.failed', status: error.status, code: error.providerCode });
      if (error.status >= 500) throw providerUnavailable();
      throw unprocessable(
        'whatsapp-invalid-credentials',
        'A Meta recusou os dados. Confira o ID do número, o ID da conta e o token.',
      );
    }
    return this.db.run(async (tx, auth) => {
      const data = {
        phoneNumberId: input.phoneNumberId,
        businessAccountId: input.businessAccountId,
        displayPhoneNumber: account.displayPhoneNumber,
        verifiedName: account.verifiedName,
        accessTokenSealed: this.secrets.seal(input.accessToken, auth.barbershopId),
        connectedByUserId: auth.userId,
      };
      await tx.whatsAppConnection.upsert({
        where: { barbershopId: auth.barbershopId },
        create: { ...data, barbershopId: auth.barbershopId },
        update: data,
      });
      this.logger.log({ event: 'whatsapp.connected', barbershopId: auth.barbershopId });
      return this.view(tx, auth.barbershopId);
    });
  }

  disconnect(): Promise<void> {
    return this.db.run(async (tx, auth) => {
      await tx.whatsAppConnection.deleteMany({ where: { barbershopId: auth.barbershopId } });
    });
  }

  /** Modelos aprovados da conta conectada. */
  async templates(): Promise<WhatsAppTemplate[]> {
    const credentials = await this.db.run((tx, auth) => this.credentials(tx, auth.barbershopId));
    if (!credentials) throw whatsappNotConnected();
    try {
      return await this.sender.listTemplates(credentials);
    } catch (error) {
      if (!(error instanceof WhatsAppProviderError)) throw error;
      this.logger.warn({
        event: 'whatsapp.templates.failed',
        status: error.status,
        code: error.providerCode,
      });
      throw providerUnavailable();
    }
  }

  /** Lança 422 se o modelo escolhido não serve para esta conta (não existe, mídia, variáveis). */
  async assertTemplate(config: TemplateConfig): Promise<void> {
    const problem = validateTemplateConfig(config, await this.templates());
    if (problem) throw unprocessable('whatsapp-template-invalid', problem);
  }

  /** Credenciais decifradas, para o envio. Null se a barbearia não conectou. */
  async credentials(tx: Tx, barbershopId: string): Promise<WhatsAppCredentials | null> {
    const row = await tx.whatsAppConnection.findFirst({ where: { barbershopId } });
    if (!row) return null;
    return {
      phoneNumberId: row.phoneNumberId,
      businessAccountId: row.businessAccountId,
      accessToken: this.secrets.open(row.accessTokenSealed, barbershopId),
    };
  }

  async isConnected(tx: Tx, barbershopId: string): Promise<boolean> {
    return (await tx.whatsAppConnection.count({ where: { barbershopId } })) > 0;
  }

  private async view(tx: Tx, barbershopId: string): Promise<WhatsAppConnectionView> {
    const row = await tx.whatsAppConnection.findFirst({ where: { barbershopId } });
    return {
      connection: row
        ? {
            phoneNumberId: row.phoneNumberId,
            businessAccountId: row.businessAccountId,
            displayPhoneNumber: row.displayPhoneNumber,
            verifiedName: row.verifiedName,
            connectedAt: row.updatedAt,
          }
        : null,
    };
  }
}
