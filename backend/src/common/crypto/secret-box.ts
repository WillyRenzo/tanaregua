import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';

const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

/**
 * Cifra segredos de terceiros guardados no banco (ex.: token do WhatsApp da barbearia) com
 * AES-256-GCM. O `context` (o id da barbearia) entra como dado autenticado: o texto cifrado
 * de um tenant não decifra se for copiado para a linha de outro.
 */
export class SecretBox {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) throw new Error('A chave do SecretBox precisa ter 32 bytes');
  }

  seal(plaintext: string, context: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    cipher.setAAD(Buffer.from(context, 'utf8'));
    const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return [VERSION, iv, cipher.getAuthTag(), data].map((part) => encode(part)).join('.');
  }

  open(sealed: string, context: string): string {
    const [version, iv, tag, data] = sealed.split('.');
    if (version !== VERSION || !iv || !tag || data === undefined) {
      throw new Error('Segredo em formato desconhecido');
    }
    const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(context, 'utf8'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString(
      'utf8',
    );
  }
}

const encode = (part: string | Buffer) => (typeof part === 'string' ? part : part.toString('base64url'));

/**
 * SecretBox da aplicação, com a chave de SECRETS_ENCRYPTION_KEY. Em produção a chave é
 * obrigatória (validada no env); em desenvolvimento e testes, sem ela, usa uma chave fixa
 * conhecida, que só serve para dados de mentira.
 */
@Injectable()
export class AppSecretBox extends SecretBox {
  constructor(@Inject(ConfigService) config: ConfigService<Env, true>) {
    const configured = config.get('SECRETS_ENCRYPTION_KEY', { infer: true });
    if (!configured) {
      new Logger(AppSecretBox.name).warn(
        'SECRETS_ENCRYPTION_KEY ausente: usando a chave de desenvolvimento (nunca em produção)',
      );
    }
    super(
      configured
        ? Buffer.from(configured, 'base64')
        : createHash('sha256').update('tanaregua-dev-only-secret-box').digest(),
    );
  }
}
