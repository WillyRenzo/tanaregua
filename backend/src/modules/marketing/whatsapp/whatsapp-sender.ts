import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env.js';
import { parseTemplate, type RawTemplate, type WhatsAppTemplate } from './whatsapp-templates.js';

/** Credenciais da conta do WhatsApp Business da barbearia. */
export interface WhatsAppCredentials {
  phoneNumberId: string;
  businessAccountId: string;
  accessToken: string;
}

export interface WhatsAppAccount {
  displayPhoneNumber: string;
  verifiedName: string;
}

export interface TemplateMessage {
  /** Só dígitos, com DDI. */
  to: string;
  template: { name: string; language: string };
  parameters: { name: string; text: string }[];
}

/** Falha do provedor. A mensagem leva status e código do provedor, nunca o conteúdo. */
export class WhatsAppProviderError extends Error {
  constructor(
    readonly status: number,
    readonly providerCode?: number,
  ) {
    super(`WhatsApp respondeu ${status}${providerCode ? ` (código ${providerCode})` : ''}`);
  }
}

/**
 * Porta de envio pelo WhatsApp (AFA 06). Mensagem iniciada pela barbearia só sai por modelo
 * aprovado pela Meta; trocar de provedor (ou para o cadastro integrado) é trocar o adapter.
 */
export abstract class WhatsAppSender {
  /** Confere as credenciais (número e conta) e devolve os dados da conta. */
  abstract verify(credentials: WhatsAppCredentials): Promise<WhatsAppAccount>;
  /** Modelos aprovados da conta. */
  abstract listTemplates(credentials: WhatsAppCredentials): Promise<WhatsAppTemplate[]>;
  abstract sendTemplate(
    credentials: WhatsAppCredentials,
    message: TemplateMessage,
  ): Promise<{ messageId: string }>;
}

/** Token que o adapter simulado recusa, para testar o caminho de credencial inválida. */
export const LOG_WHATSAPP_INVALID_TOKEN = 'token-invalido-para-testes';

/** Desenvolvimento e testes: aceita qualquer conta, tem modelos fixos e não envia nada. */
@Injectable()
export class LogWhatsAppSender extends WhatsAppSender {
  private readonly logger = new Logger('WhatsApp');
  readonly sent: (TemplateMessage & { phoneNumberId: string })[] = [];

  async verify(credentials: WhatsAppCredentials): Promise<WhatsAppAccount> {
    if (credentials.accessToken === LOG_WHATSAPP_INVALID_TOKEN) throw new WhatsAppProviderError(401, 190);
    return {
      displayPhoneNumber: `+55 11 90000-${credentials.phoneNumberId.slice(-4)}`,
      verifiedName: 'Conta de teste',
    };
  }

  async listTemplates(): Promise<WhatsAppTemplate[]> {
    return LOG_TEMPLATES.map(parseTemplate);
  }

  async sendTemplate(credentials: WhatsAppCredentials, message: TemplateMessage) {
    this.sent.push({ ...message, phoneNumberId: credentials.phoneNumberId });
    if (this.sent.length > 100) this.sent.shift();
    // Só o modelo: destinatário e variáveis são dados pessoais (AFA 20).
    this.logger.log(`WhatsApp simulado: modelo "${message.template.name}"`);
    return { messageId: `log-${randomUUID()}` };
  }
}

const LOG_TEMPLATES: RawTemplate[] = [
  {
    name: 'feliz_aniversario',
    language: 'pt_BR',
    category: 'MARKETING',
    components: [{ type: 'BODY', text: 'Olá, {{1}}! A equipe da {{2}} deseja um feliz aniversário!' }],
  },
  {
    name: 'sentimos_sua_falta',
    language: 'pt_BR',
    category: 'MARKETING',
    components: [
      { type: 'HEADER', format: 'TEXT', text: 'Faz tempo!' },
      { type: 'BODY', text: 'Oi, {{nome}}! Que tal marcar um horário na {{barbearia}} esta semana?' },
      { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Quero agendar' }] },
    ],
  },
  {
    name: 'promocao_com_imagem',
    language: 'pt_BR',
    category: 'MARKETING',
    components: [
      { type: 'HEADER', format: 'IMAGE' },
      { type: 'BODY', text: 'Promoção do mês para você, {{1}}!' },
    ],
  },
];

const GRAPH_URL = 'https://graph.facebook.com';
const META_TIMEOUT_MS = 10_000;
/** Contas de barbearia têm poucos modelos; uma página basta. */
const TEMPLATE_PAGE_SIZE = 200;

/** Adapter da Cloud API da Meta via HTTP (sem SDK: menos dependências na cadeia de suprimentos). */
@Injectable()
export class MetaWhatsAppSender extends WhatsAppSender {
  private readonly version: string;

  constructor(@Inject(ConfigService) config: ConfigService<Env, true>) {
    super();
    this.version = config.get('META_GRAPH_API_VERSION');
  }

  async verify(credentials: WhatsAppCredentials): Promise<WhatsAppAccount> {
    const phone = await this.call<{ display_phone_number: string; verified_name: string }>(
      credentials,
      `${credentials.phoneNumberId}?fields=display_phone_number,verified_name`,
    );
    // O token também precisa enxergar a conta (WABA), de onde vêm os modelos.
    await this.call(credentials, `${credentials.businessAccountId}/message_templates?limit=1`);
    return { displayPhoneNumber: phone.display_phone_number, verifiedName: phone.verified_name };
  }

  async listTemplates(credentials: WhatsAppCredentials): Promise<WhatsAppTemplate[]> {
    const page = await this.call<{ data: (RawTemplate & { status: string })[] }>(
      credentials,
      `${credentials.businessAccountId}/message_templates` +
        `?fields=name,language,status,category,components&status=APPROVED&limit=${TEMPLATE_PAGE_SIZE}`,
    );
    return page.data.filter((template) => template.status === 'APPROVED').map(parseTemplate);
  }

  async sendTemplate(credentials: WhatsAppCredentials, message: TemplateMessage) {
    const named = message.parameters.some((parameter) => !/^\d+$/.test(parameter.name));
    const response = await this.call<{ messages: { id: string }[] }>(
      credentials,
      `${credentials.phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: message.to,
        type: 'template',
        template: {
          name: message.template.name,
          language: { code: message.template.language },
          components:
            message.parameters.length === 0
              ? []
              : [
                  {
                    type: 'body',
                    parameters: message.parameters.map((parameter) =>
                      named
                        ? { type: 'text', parameter_name: parameter.name, text: parameter.text }
                        : { type: 'text', text: parameter.text },
                    ),
                  },
                ],
        },
      },
    );
    const messageId = response.messages[0]?.id;
    if (!messageId) throw new WhatsAppProviderError(502);
    return { messageId };
  }

  private async call<T>(credentials: WhatsAppCredentials, path: string, body?: object): Promise<T> {
    const response = await fetch(`${GRAPH_URL}/${this.version}/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      // Toda chamada externa tem timeout (AFA 14); o retry com backoff fica no outbox.
      signal: AbortSignal.timeout(META_TIMEOUT_MS),
    });
    const payload = (await response.json().catch(() => null)) as { error?: { code?: number } } | null;
    if (!response.ok) throw new WhatsAppProviderError(response.status, payload?.error?.code);
    return payload as T;
  }
}
