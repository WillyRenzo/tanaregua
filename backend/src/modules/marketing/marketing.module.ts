import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { RequirePermissions } from '../../common/auth/decorators.js';
import { AppSecretBox, SecretBox } from '../../common/crypto/secret-box.js';
import { API_TAGS, ApiProblem, ApiResult, Idempotent } from '../../common/http/openapi.js';
import type { Env } from '../../config/env.js';
import { AppointmentsModule } from '../appointments/appointments.module.js';
import { BarbershopsModule } from '../barbershops/barbershops.module.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { ClientsModule } from '../clients/clients.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { BirthdaysService } from './birthdays.service.js';
import { CampaignsService, MAX_CAMPAIGN_RECIPIENTS } from './campaigns.service.js';
import { MarketingDeliveryService } from './marketing-delivery.service.js';
import {
  birthdayEntrySchema,
  birthdaySettingsSchema,
  campaignDetailSchema,
  campaignPreviewSchema,
  campaignSchema,
  whatsappConnectionSchema,
  whatsappTemplateSchema,
} from './marketing.responses.js';
import {
  birthdaySettingsInputSchema,
  connectWhatsAppSchema,
  createCampaignSchema,
  listBirthdaysSchema,
  previewCampaignSchema,
  type BirthdaySettingsInput,
  type ConnectWhatsAppInput,
  type CreateCampaignInput,
  type ListBirthdaysQuery,
  type PreviewCampaignInput,
} from './marketing.schemas.js';
import { WhatsAppConnectionService } from './whatsapp/whatsapp-connection.service.js';
import { LogWhatsAppSender, MetaWhatsAppSender, WhatsAppSender } from './whatsapp/whatsapp-sender.js';

@ApiTags(API_TAGS.marketing[0])
@Controller()
export class MarketingController {
  constructor(
    @Inject(WhatsAppConnectionService) private readonly whatsapp: WhatsAppConnectionService,
    @Inject(BirthdaysService) private readonly birthdays: BirthdaysService,
    @Inject(CampaignsService) private readonly campaigns: CampaignsService,
  ) {}

  // ───────────── WhatsApp ─────────────

  @RequirePermissions('barbershop:manage', 'campaigns:manage')
  @ApiResult(whatsappConnectionSchema)
  @ApiOperation({ summary: 'Conta do WhatsApp conectada (o token nunca é devolvido)' })
  @Get('whatsapp')
  getWhatsApp() {
    return this.whatsapp.get();
  }

  @RequirePermissions('barbershop:manage')
  @ApiResult(whatsappConnectionSchema)
  @ApiOperation({ summary: 'Conecta ou troca a conta do WhatsApp Business (conferida na Meta)' })
  @ApiProblem(422, 'whatsapp-invalid-credentials', 'A Meta recusou o ID do número, o ID da conta ou o token.')
  @ApiProblem(502, 'whatsapp-unavailable', 'O WhatsApp não respondeu.')
  @Put('whatsapp')
  connectWhatsApp(@Body({ schema: connectWhatsAppSchema }) input: ConnectWhatsAppInput) {
    return this.whatsapp.connect(input);
  }

  @RequirePermissions('barbershop:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Desconecta o WhatsApp (o aniversário passa a sair só por e-mail)' })
  @Delete('whatsapp')
  async disconnectWhatsApp(): Promise<void> {
    await this.whatsapp.disconnect();
  }

  @RequirePermissions('barbershop:manage', 'campaigns:manage')
  @ApiResult(z.array(whatsappTemplateSchema))
  @ApiOperation({ summary: 'Modelos aprovados pela Meta na conta conectada' })
  @ApiProblem(422, 'whatsapp-not-connected', 'A barbearia ainda não conectou o WhatsApp.')
  @ApiProblem(502, 'whatsapp-unavailable', 'O WhatsApp não respondeu.')
  @Get('whatsapp/templates')
  templates() {
    return this.whatsapp.templates();
  }

  // ───────────── Aniversários ─────────────

  @RequirePermissions('barbershop:manage')
  @ApiResult(birthdaySettingsSchema)
  @ApiOperation({ summary: 'Configuração da mensagem automática de aniversário' })
  @Get('birthday-settings')
  birthdaySettings() {
    return this.birthdays.settings();
  }

  @RequirePermissions('barbershop:manage')
  @ApiResult(birthdaySettingsSchema)
  @ApiOperation({ summary: 'Liga/desliga a mensagem de aniversário e define o texto e o modelo' })
  @ApiProblem(
    422,
    'whatsapp-not-connected | whatsapp-template-invalid',
    'WhatsApp não conectado, ou modelo não aprovado/suportado ou com variáveis erradas.',
  )
  @Put('birthday-settings')
  updateBirthdaySettings(@Body({ schema: birthdaySettingsInputSchema }) input: BirthdaySettingsInput) {
    return this.birthdays.updateSettings(input);
  }

  @RequirePermissions('clients:read')
  @ApiResult(z.array(birthdayEntrySchema))
  @ApiOperation({ summary: 'Aniversariantes do mês, com os canais consentidos e a mensagem deste ano' })
  @Get('birthdays')
  listBirthdays(@Query({ schema: listBirthdaysSchema }) query: ListBirthdaysQuery) {
    return this.birthdays.list(query);
  }

  // ───────────── Campanhas ─────────────

  @RequirePermissions('campaigns:manage')
  @ApiResult(z.array(campaignSchema))
  @ApiOperation({ summary: 'Últimas campanhas, com a situação das mensagens' })
  @Get('campaigns')
  listCampaigns() {
    return this.campaigns.list();
  }

  @RequirePermissions('campaigns:manage')
  @HttpCode(HttpStatus.OK)
  @ApiResult(campaignPreviewSchema)
  @ApiOperation({ summary: 'Prévia: quantos clientes atendem ao filtro e quantos podem receber no canal' })
  @ApiProblem(422, 'invalid-service', 'Serviço inexistente.')
  @Post('campaigns/preview')
  previewCampaign(@Body({ schema: previewCampaignSchema }) input: PreviewCampaignInput) {
    return this.campaigns.preview(input);
  }

  @RequirePermissions('campaigns:manage')
  @Idempotent()
  @ApiResult(campaignDetailSchema, 201)
  @ApiOperation({
    summary: `Cria e envia a campanha (confirmando o número da prévia; até ${MAX_CAMPAIGN_RECIPIENTS} clientes)`,
  })
  @ApiProblem(409, 'audience-changed', 'O público mudou desde a prévia: confirme o novo número.')
  @ApiProblem(
    422,
    'empty-audience | audience-too-large | invalid-service | whatsapp-not-connected | whatsapp-template-invalid',
    'Ninguém para receber, público grande demais, serviço inexistente ou problema com o WhatsApp.',
  )
  @Post('campaigns')
  createCampaign(@Body({ schema: createCampaignSchema }) input: CreateCampaignInput) {
    return this.campaigns.create(input);
  }

  @RequirePermissions('campaigns:manage')
  @ApiResult(campaignDetailSchema)
  @ApiOperation({ summary: 'Detalhe da campanha, com a situação de cada destinatário' })
  @Get('campaigns/:id')
  getCampaign(@Param('id', ParseUUIDPipe) id: string) {
    return this.campaigns.get(id);
  }
}

@Module({
  imports: [AppointmentsModule, BarbershopsModule, CatalogModule, ClientsModule, NotificationsModule],
  controllers: [MarketingController],
  providers: [
    { provide: SecretBox, useClass: AppSecretBox },
    LogWhatsAppSender,
    MetaWhatsAppSender,
    {
      provide: WhatsAppSender,
      inject: [ConfigService, LogWhatsAppSender, MetaWhatsAppSender],
      useFactory: (config: ConfigService<Env, true>, log: LogWhatsAppSender, meta: MetaWhatsAppSender) =>
        config.get('WHATSAPP_PROVIDER') === 'meta' ? meta : log,
    },
    WhatsAppConnectionService,
    BirthdaysService,
    CampaignsService,
    MarketingDeliveryService,
  ],
  exports: [BirthdaysService, CampaignsService, WhatsAppConnectionService],
})
export class MarketingModule {}
