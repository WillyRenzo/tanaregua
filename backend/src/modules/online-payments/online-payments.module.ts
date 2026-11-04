import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Module,
  type OnModuleInit,
  Param,
  Post,
  Put,
  Redirect,
  Req,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { z } from 'zod';
import { Public, RequirePermissions } from '../../common/auth/decorators.js';
import { RequiresFeature } from '../../common/auth/requires-feature.js';
import { AppSecretBox, SecretBox } from '../../common/crypto/secret-box.js';
import { API_TAGS, ApiProblem, ApiResult } from '../../common/http/openapi.js';
import type { Env } from '../../config/env.js';
import { AppointmentPayments } from '../appointments/appointment-payments.js';
import { AppointmentsModule } from '../appointments/appointments.module.js';
import { BarbershopsModule } from '../barbershops/barbershops.module.js';
import { OutboxHandlers } from '../notifications/outbox.service.js';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module.js';
import { BookingPaymentsService } from './booking-payments.service.js';
import {
  DisabledMerchantGateway,
  FakeMerchantGateway,
  MercadoPagoMerchantGateway,
  MerchantGateway,
} from './merchant-gateway.js';
import { onlinePaymentViewSchema, type OnlinePaymentView } from './online-payments.responses.js';
import {
  connectPaymentAccountSchema,
  onlinePaymentSettingsSchema,
  type ConnectPaymentAccountInput,
  type OnlinePaymentSettingsInput,
} from './online-payments.schemas.js';
import { OnlinePaymentsService } from './online-payments.service.js';

/** O gateway reenvia notificações e pode mandar várias juntas; a assinatura HMAC barra o resto. */
const WEBHOOK_THROTTLE = { default: { limit: 300, ttl: 60_000 } };
const FAKE_CHECKOUT_THROTTLE = { default: { limit: 20, ttl: 60_000 } };

const webhookAckSchema = z.object({ received: z.boolean() }).meta({ id: 'BookingPaymentWebhookAck' });

/** Configuração da barbearia: quem configura a barbearia (`barbershop:manage`), e só nos planos com o recurso. */
@ApiTags(API_TAGS.onlinePayments[0])
@Controller('online-payments')
export class OnlinePaymentsController {
  constructor(
    @Inject(OnlinePaymentsService) private readonly payments: OnlinePaymentsService,
    @Inject(BookingPaymentsService) private readonly bookingPayments: BookingPaymentsService,
  ) {}

  @RequirePermissions('barbershop:manage')
  @RequiresFeature('online-payment')
  @ApiResult(onlinePaymentViewSchema)
  @ApiOperation({ summary: 'Conta conectada no gateway e como a reserva online é paga' })
  @Get()
  get(): Promise<OnlinePaymentView> {
    return this.payments.get();
  }

  @RequirePermissions('barbershop:manage')
  @RequiresFeature('online-payment')
  @ApiResult(onlinePaymentViewSchema)
  @ApiOperation({
    summary: 'Conecta a conta da barbearia no gateway de pagamento',
    description:
      'As credenciais são conferidas no gateway e guardadas cifradas; nunca voltam ao navegador. Reconectar troca as credenciais e mantém a configuração.',
  })
  @ApiProblem(422, 'payment-account-invalid-credentials', 'O gateway recusou as credenciais.')
  @ApiProblem(502, 'payment-gateway-unavailable', 'O gateway não respondeu.')
  @ApiProblem(503, 'online-payment-unavailable', 'O pagamento online está desligado nesta instalação.')
  @Put('account')
  connect(
    @Body({ schema: connectPaymentAccountSchema }) input: ConnectPaymentAccountInput,
  ): Promise<OnlinePaymentView> {
    return this.payments.connect(input);
  }

  @RequirePermissions('barbershop:manage')
  @RequiresFeature('online-payment')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Desconecta a conta e desliga o pagamento online' })
  @Delete('account')
  disconnect(): Promise<void> {
    return this.payments.disconnect();
  }

  @RequirePermissions('barbershop:manage')
  @RequiresFeature('online-payment')
  @ApiResult(onlinePaymentViewSchema)
  @ApiOperation({
    summary: 'Define como a reserva online é paga',
    description:
      'Desligado, à escolha do cliente ou exigido; o total dos serviços ou um sinal (basis points, de 1% a 99%).',
  })
  @ApiProblem(422, 'payment-account-not-connected', 'A barbearia ainda não conectou a conta no gateway.')
  @Put('settings')
  updateSettings(
    @Body({ schema: onlinePaymentSettingsSchema }) input: OnlinePaymentSettingsInput,
  ): Promise<OnlinePaymentView> {
    return this.payments.updateSettings(input);
  }

  @Public()
  @Throttle(WEBHOOK_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @ApiResult(webhookAckSchema)
  @ApiOperation({
    summary: 'Notificação do gateway sobre um pagamento de reserva, na URL da conta da barbearia',
    description:
      'Chamada pelo gateway. A chave na URL diz de qual conta é, e a assinatura HMAC é conferida com o segredo dela (401 se inválida). Só põe a consulta ao gateway na fila; notificação repetida é ignorada.',
  })
  @Post('webhook/:webhookKey')
  async webhook(
    @Param('webhookKey') webhookKey: string,
    @Req() request: Request,
  ): Promise<{ received: boolean }> {
    await this.bookingPayments.receiveNotification(webhookKey, {
      headers: request.headers,
      query: request.query as Record<string, unknown>,
      body: request.body as unknown,
    });
    return { received: true };
  }

  /** Só com PAYMENT_PROVIDER=fake (desenvolvimento e testes); fora dele, 404. */
  @Public()
  @Throttle(FAKE_CHECKOUT_THROTTLE)
  @ApiExcludeEndpoint()
  @Redirect()
  @Get('fake-checkout/:id')
  async fakeCheckout(@Param('id') id: string): Promise<{ url: string; statusCode: number }> {
    return { url: await this.bookingPayments.approveFakeCheckout(id), statusCode: HttpStatus.SEE_OTHER };
  }
}

@Module({
  imports: [AppointmentsModule, BarbershopsModule, SubscriptionsModule],
  controllers: [OnlinePaymentsController],
  providers: [
    OnlinePaymentsService,
    BookingPaymentsService,
    { provide: SecretBox, useClass: AppSecretBox },
    DisabledMerchantGateway,
    FakeMerchantGateway,
    MercadoPagoMerchantGateway,
    {
      // O gateway da instalação é um só (o mesmo da assinatura do TaNaRegua).
      provide: MerchantGateway,
      inject: [ConfigService, DisabledMerchantGateway, FakeMerchantGateway, MercadoPagoMerchantGateway],
      useFactory: (
        config: ConfigService<Env, true>,
        disabled: DisabledMerchantGateway,
        fake: FakeMerchantGateway,
        mercadopago: MercadoPagoMerchantGateway,
      ) => ({ none: disabled, fake, mercadopago })[config.get('PAYMENT_PROVIDER') as Env['PAYMENT_PROVIDER']],
    },
  ],
  exports: [OnlinePaymentsService, BookingPaymentsService],
})
export class OnlinePaymentsModule implements OnModuleInit {
  constructor(
    @Inject(BookingPaymentsService) private readonly bookingPayments: BookingPaymentsService,
    @Inject(AppointmentPayments) private readonly appointmentPayments: AppointmentPayments,
    @Inject(OutboxHandlers) private readonly handlers: OutboxHandlers,
  ) {}

  onModuleInit(): void {
    const payments = this.bookingPayments;
    this.appointmentPayments.register({
      summaries: (tx, barbershopId, ids) => payments.summaries(tx, barbershopId, ids),
      onCancel: (tx, barbershopId, appointment, context) =>
        payments.onCancel(tx, barbershopId, appointment, context),
    });
    this.handlers.register('BookingPaymentChanged', {
      handle: (event) => payments.applyGatewayPayment(event),
    });
    this.handlers.register('BookingPaymentRefund', {
      handle: (event) => payments.refund(event),
      onDeadLetter: (event) => payments.refundFailed(event),
    });
    this.handlers.register('BookingPaymentExtraRefund', { handle: (event) => payments.refundExtra(event) });
    this.handlers.register('BookingPaymentHoldExpired', { handle: (event) => payments.expireHold(event) });
  }
}
