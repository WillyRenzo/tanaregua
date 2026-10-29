import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Module,
  Param,
  Post,
  Redirect,
  Req,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { z } from 'zod';
import { Public, RequirePermissions } from '../../common/auth/decorators.js';
import { AllowedWhenReadOnly } from '../../common/auth/read-only.js';
import { API_TAGS, ApiProblem, ApiResult } from '../../common/http/openapi.js';
import type { Env } from '../../config/env.js';
import { BarbershopsModule } from '../barbershops/barbershops.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { StaffModule } from '../staff/staff.module.js';
import { BillingService } from './billing.service.js';
import { MercadoPagoGateway } from './mercadopago-gateway.js';
import { DisabledPaymentGateway, FakePaymentGateway, PaymentGateway } from './payment-gateway.js';
import {
  checkoutSchema,
  subscriptionDetailSchema,
  type CheckoutView,
  type SubscriptionDetail,
} from './subscriptions.responses.js';
import {
  changePlanSchema,
  startCheckoutSchema,
  type ChangePlanInput,
  type StartCheckoutInput,
} from './subscriptions.schemas.js';

/** O gateway reenvia notificações e pode mandar várias juntas; a assinatura HMAC barra o resto. */
const WEBHOOK_THROTTLE = { default: { limit: 300, ttl: 60_000 } };
const FAKE_CHECKOUT_THROTTLE = { default: { limit: 20, ttl: 60_000 } };

const webhookAckSchema = z.object({ received: z.boolean() }).meta({ id: 'BillingWebhookAck' });

@ApiTags(API_TAGS.subscription[0])
@Controller()
export class BillingController {
  constructor(@Inject(BillingService) private readonly billing: BillingService) {}

  @RequirePermissions('subscription:manage')
  @ApiResult(subscriptionDetailSchema)
  @ApiOperation({
    summary: 'Assinatura da barbearia: plano, ciclo, valor, reajuste avisado e checkout aberto',
  })
  @Get('subscription')
  detail(): Promise<SubscriptionDetail> {
    return this.billing.detail();
  }

  // Assinar é a saída do modo só leitura (§12).
  @AllowedWhenReadOnly()
  @RequirePermissions('subscription:manage')
  @ApiResult(checkoutSchema, 201)
  @ApiOperation({
    summary: 'Abre o checkout do gateway para assinar um plano num ciclo',
    description:
      'O preço vem do catálogo. A assinatura só muda quando o gateway confirma o pagamento (notificação verificada), nunca pelo retorno do navegador.',
  })
  @ApiProblem(
    409,
    'plan-change-unavailable',
    'A barbearia já tem uma assinatura paga: troque de plano em vez de assinar de novo.',
  )
  @ApiProblem(422, 'plan-not-for-sale', 'O plano não está à venda no ciclo escolhido.')
  @ApiProblem(502, 'billing-gateway-unavailable', 'O gateway de pagamento não respondeu.')
  @ApiProblem(503, 'billing-unavailable', 'A assinatura online está desligada nesta instalação.')
  @Post('subscription/checkout')
  checkout(@Body({ schema: startCheckoutSchema }) input: StartCheckoutInput): Promise<CheckoutView> {
    return this.billing.startCheckout(input);
  }

  @RequirePermissions('subscription:manage')
  @HttpCode(HttpStatus.OK)
  @ApiResult(subscriptionDetailSchema)
  @ApiOperation({
    summary: 'Troca o plano da assinatura paga, no mesmo ciclo',
    description:
      'Upgrade vale na hora; downgrade, no fim do período pago. O gateway passa a cobrar o valor do plano novo a partir da próxima cobrança, sem cobrança proporcional. Escolher o plano atual desfaz um downgrade agendado.',
  })
  @ApiProblem(409, 'plan-change-unavailable', 'Sem assinatura paga e em dia para trocar de plano.')
  @ApiProblem(422, 'plan-not-for-sale', 'O plano não está à venda no ciclo da assinatura.')
  @ApiProblem(503, 'billing-unavailable', 'A assinatura online está desligada nesta instalação.')
  @Post('subscription/plan')
  changePlan(@Body({ schema: changePlanSchema }) input: ChangePlanInput): Promise<SubscriptionDetail> {
    return this.billing.changePlan(input);
  }

  // Parar de pagar precisa funcionar também no modo só leitura.
  @AllowedWhenReadOnly()
  @RequirePermissions('subscription:manage')
  @HttpCode(HttpStatus.OK)
  @ApiResult(subscriptionDetailSchema)
  @ApiOperation({
    summary: 'Cancela a assinatura paga',
    description:
      'Cancela a cobrança recorrente no gateway. A barbearia usa até o fim do período pago e depois fica só para consulta.',
  })
  @ApiProblem(409, 'subscription-not-active', 'A barbearia não tem assinatura paga para cancelar.')
  @ApiProblem(503, 'billing-unavailable', 'A assinatura online está desligada nesta instalação.')
  @Post('subscription/cancel')
  cancel(): Promise<SubscriptionDetail> {
    return this.billing.cancel();
  }

  @Public()
  @Throttle(WEBHOOK_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @ApiResult(webhookAckSchema)
  @ApiOperation({
    summary: 'Notificação do gateway de pagamento sobre uma assinatura ou uma cobrança dela',
    description:
      'Chamada pelo gateway, com assinatura HMAC conferida (401 se inválida). Só põe a consulta ao gateway na fila; notificação repetida é ignorada.',
  })
  @ApiProblem(
    502,
    'billing-gateway-unavailable',
    'O gateway não respondeu à consulta da cobrança; ele reenvia a notificação.',
  )
  @Post('billing/webhook')
  async webhook(@Req() request: Request): Promise<{ received: boolean }> {
    await this.billing.receiveNotification({
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
  @Get('billing/fake-checkout/:id')
  async fakeCheckout(@Param('id') id: string): Promise<{ url: string; statusCode: number }> {
    return { url: await this.billing.approveFakeCheckout(id), statusCode: HttpStatus.SEE_OTHER };
  }
}

/**
 * Cobrança recorrente da assinatura. Módulo separado do `SubscriptionsModule` (que o auth
 * importa) porque depende de e-mail, equipe e barbearia.
 */
@Module({
  imports: [BarbershopsModule, NotificationsModule, StaffModule],
  controllers: [BillingController],
  providers: [
    DisabledPaymentGateway,
    FakePaymentGateway,
    MercadoPagoGateway,
    {
      provide: PaymentGateway,
      inject: [ConfigService, DisabledPaymentGateway, FakePaymentGateway, MercadoPagoGateway],
      useFactory: (
        config: ConfigService<Env, true>,
        disabled: DisabledPaymentGateway,
        fake: FakePaymentGateway,
        mercadopago: MercadoPagoGateway,
      ) => ({ none: disabled, fake, mercadopago })[config.get('PAYMENT_PROVIDER') as Env['PAYMENT_PROVIDER']],
    },
    BillingService,
  ],
  exports: [PaymentGateway],
})
export class BillingModule {}
