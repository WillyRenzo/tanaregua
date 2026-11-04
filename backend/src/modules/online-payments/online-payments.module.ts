import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Module, Put } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/auth/decorators.js';
import { RequiresFeature } from '../../common/auth/requires-feature.js';
import { AppSecretBox, SecretBox } from '../../common/crypto/secret-box.js';
import { API_TAGS, ApiProblem, ApiResult } from '../../common/http/openapi.js';
import type { Env } from '../../config/env.js';
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

/** Configuração da barbearia: quem configura a barbearia (`barbershop:manage`), e só nos planos com o recurso. */
@ApiTags(API_TAGS.onlinePayments[0])
@Controller('online-payments')
export class OnlinePaymentsController {
  constructor(@Inject(OnlinePaymentsService) private readonly payments: OnlinePaymentsService) {}

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
}

@Module({
  controllers: [OnlinePaymentsController],
  providers: [
    OnlinePaymentsService,
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
  exports: [OnlinePaymentsService],
})
export class OnlinePaymentsModule {}
