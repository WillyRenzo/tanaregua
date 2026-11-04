import { randomBytes } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { SecretBox } from '../../common/crypto/secret-box.js';
import { DomainError, unprocessable } from '../../common/http/domain-error.js';
import { TenantDb } from '../../common/tenancy/tenant-db.service.js';
import type { Tx } from '../../prisma/prisma.service.js';
import { MerchantGateway, MerchantGatewayError, type MerchantCredentials } from './merchant-gateway.js';
import type { OnlinePaymentView } from './online-payments.responses.js';
import type { ConnectPaymentAccountInput, OnlinePaymentSettingsInput } from './online-payments.schemas.js';

const unavailable = () =>
  new DomainError(
    'online-payment-unavailable',
    'Service Unavailable',
    'O pagamento online ainda não está disponível. Fale com o suporte do TaNaRegua.',
    HttpStatus.SERVICE_UNAVAILABLE,
  );

const gatewayUnavailable = () =>
  new DomainError(
    'payment-gateway-unavailable',
    'Bad Gateway',
    'O serviço de pagamento não respondeu. Tente de novo em alguns minutos.',
    HttpStatus.BAD_GATEWAY,
  );

const OFF_SETTINGS = { mode: 'OFF', amount: 'FULL', depositBps: null } as const;

/**
 * Conta da barbearia no gateway e configuração do pagamento da reserva online
 * (business-rules §5). As credenciais são conferidas no gateway, guardadas cifradas (ligadas
 * ao tenant) e nunca devolvidas ao navegador.
 */
@Injectable()
export class OnlinePaymentsService {
  private readonly logger = new Logger(OnlinePaymentsService.name);

  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(SecretBox) private readonly secrets: SecretBox,
    @Inject(MerchantGateway) private readonly gateway: MerchantGateway,
  ) {}

  get(): Promise<OnlinePaymentView> {
    return this.db.run((tx, auth) => this.view(tx, auth.barbershopId));
  }

  async connect(input: ConnectPaymentAccountInput): Promise<OnlinePaymentView> {
    const provider = this.gateway.provider;
    if (!provider) throw unavailable();
    let account;
    try {
      account = await this.gateway.verifyAccount({ accessToken: input.accessToken });
    } catch (error) {
      if (!(error instanceof MerchantGatewayError)) throw error;
      this.logger.warn({
        event: 'online-payment.verify.failed',
        status: error.status,
        code: error.providerCode,
      });
      if (error.status >= 500) throw gatewayUnavailable();
      throw unprocessable(
        'payment-account-invalid-credentials',
        'O serviço de pagamento recusou as credenciais. Confira o access token de produção da sua conta.',
      );
    }
    return this.db.run(async (tx, auth) => {
      const data = {
        provider,
        externalAccountId: account.id,
        accountName: account.name,
        accessTokenSealed: this.secrets.seal(input.accessToken, auth.barbershopId),
        webhookSecretSealed: this.secrets.seal(input.webhookSecret, auth.barbershopId),
        connectedByUserId: auth.userId,
      };
      await tx.paymentAccount.upsert({
        where: { barbershopId: auth.barbershopId },
        create: {
          ...data,
          barbershopId: auth.barbershopId,
          webhookKey: randomBytes(24).toString('base64url'),
        },
        // Reconectar troca as credenciais e mantém a configuração e a URL de notificação.
        update: data,
      });
      this.logger.log({ event: 'online-payment.connected', barbershopId: auth.barbershopId });
      return this.view(tx, auth.barbershopId);
    });
  }

  /** Desconectar apaga as credenciais e desliga o pagamento online. */
  disconnect(): Promise<void> {
    return this.db.run(async (tx, auth) => {
      await tx.paymentAccount.deleteMany({ where: { barbershopId: auth.barbershopId } });
      this.logger.log({ event: 'online-payment.disconnected', barbershopId: auth.barbershopId });
    });
  }

  updateSettings(input: OnlinePaymentSettingsInput): Promise<OnlinePaymentView> {
    return this.db.run(async (tx, auth) => {
      const updated = await tx.paymentAccount.updateMany({
        where: { barbershopId: auth.barbershopId },
        data: { mode: input.mode, amount: input.amount, depositBps: input.depositBps },
      });
      if (updated.count === 0) {
        throw unprocessable(
          'payment-account-not-connected',
          'Conecte a conta da barbearia no serviço de pagamento antes de configurar o pagamento online.',
        );
      }
      return this.view(tx, auth.barbershopId);
    });
  }

  /** Credenciais decifradas, para os pagamentos. `null` se a barbearia não conectou. */
  async credentials(tx: Tx, barbershopId: string): Promise<MerchantCredentials | null> {
    const row = await tx.paymentAccount.findFirst({ where: { barbershopId } });
    return row ? { accessToken: this.secrets.open(row.accessTokenSealed, barbershopId) } : null;
  }

  private async view(tx: Tx, barbershopId: string): Promise<OnlinePaymentView> {
    const row = await tx.paymentAccount.findFirst({ where: { barbershopId } });
    return {
      available: this.gateway.provider !== null,
      account: row
        ? {
            provider: row.provider,
            accountId: row.externalAccountId,
            accountName: row.accountName,
            connectedAt: row.updatedAt,
          }
        : null,
      settings: row
        ? { mode: row.mode, amount: row.amount, depositBps: row.depositBps }
        : { ...OFF_SETTINGS },
    };
  }
}
