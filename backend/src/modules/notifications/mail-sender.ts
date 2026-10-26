import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/**
 * Porta de envio de e-mail (AFA 06): o domínio não conhece o fornecedor.
 * `idempotencyKey` garante que um reenvio (retry do outbox) não duplique o e-mail.
 */
export abstract class MailSender {
  abstract send(message: MailMessage, idempotencyKey: string): Promise<void>;
}

/** Desenvolvimento e testes: não envia nada, só registra. Mantém os últimos envios em memória. */
@Injectable()
export class LogMailSender extends MailSender {
  private readonly logger = new Logger('Mail');
  readonly sent: (MailMessage & { idempotencyKey: string })[] = [];

  async send(message: MailMessage, idempotencyKey: string): Promise<void> {
    if (this.sent.some((item) => item.idempotencyKey === idempotencyKey)) return;
    this.sent.push({ ...message, idempotencyKey });
    if (this.sent.length > 100) this.sent.shift();
    // Assunto apenas: destinatário é PII (AFA 20).
    this.logger.log(`E-mail simulado: "${message.subject}"`);
  }
}

const RESEND_TIMEOUT_MS = 10_000;

/** Adapter do Resend via HTTP (sem SDK: menos dependências na cadeia de suprimentos). */
@Injectable()
export class ResendMailSender extends MailSender {
  private readonly apiKey: string;
  private readonly from: string;

  constructor(@Inject(ConfigService) config: ConfigService<Env, true>) {
    super();
    this.apiKey = config.get('RESEND_API_KEY') ?? '';
    this.from = config.get('MAIL_FROM');
  }

  async send(message: MailMessage, idempotencyKey: string): Promise<void> {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({ from: this.from, to: message.to, subject: message.subject, text: message.text }),
      // Toda chamada externa tem timeout (AFA 14); o retry com backoff fica no outbox.
      signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Resend respondeu ${response.status}`);
    }
  }
}
