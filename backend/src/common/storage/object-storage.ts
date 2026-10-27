import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { Global, Inject, Injectable, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';

export interface StoredObject {
  body: Buffer;
  contentType: string;
}

/**
 * Porta de armazenamento de arquivos (AFA 06; architecture.md, "Fornecedores externos").
 * Chaves são geradas pelo sistema (`barbershops/<id>/logo-<uuid>.webp`), nunca vindas do
 * usuário. Trocar de fornecedor (S3, R2…) = um adapter novo + `STORAGE_DRIVER`.
 */
export abstract class ObjectStorage {
  abstract put(key: string, object: StoredObject): Promise<void>;
  /** `null` quando a chave não existe. */
  abstract get(key: string): Promise<StoredObject | null>;
  /** Apagar chave inexistente não é erro. */
  abstract delete(key: string): Promise<void>;
}

const KEY_PATTERN = /^[a-z0-9][a-z0-9/_.-]*$/;

/**
 * Disco local (desenvolvimento e VPS com volume). O tipo de conteúdo vai num arquivo ao
 * lado (`.type`), para servir sempre o que foi gravado, nunca o que a extensão sugere.
 */
@Injectable()
export class LocalDiskStorage extends ObjectStorage {
  private readonly root: string;

  constructor(@Inject(ConfigService) config: ConfigService<Env, true>) {
    super();
    this.root = resolve(config.get('STORAGE_LOCAL_DIR'));
  }

  async put(key: string, object: StoredObject): Promise<void> {
    const path = this.pathOf(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, object.body);
    await writeFile(`${path}.type`, object.contentType);
  }

  async get(key: string): Promise<StoredObject | null> {
    const path = this.pathOf(key);
    try {
      const [body, contentType] = await Promise.all([readFile(path), readFile(`${path}.type`, 'utf8')]);
      return { body, contentType };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    const path = this.pathOf(key);
    await rm(path, { force: true });
    await rm(`${path}.type`, { force: true });
  }

  /** Defesa extra contra path traversal, mesmo com chaves geradas pelo sistema. */
  private pathOf(key: string): string {
    if (!KEY_PATTERN.test(key) || key.includes('..')) throw new Error(`Chave de storage inválida: ${key}`);
    const path = resolve(this.root, key);
    if (!path.startsWith(this.root + sep)) throw new Error(`Chave de storage inválida: ${key}`);
    return path;
  }
}

@Global()
@Module({
  providers: [
    LocalDiskStorage,
    // Só há o disco local por enquanto (STORAGE_DRIVER=local). Um adapter S3-compatível
    // entra aqui como useFactory escolhendo pelo STORAGE_DRIVER, como o MailSender.
    { provide: ObjectStorage, useExisting: LocalDiskStorage },
  ],
  exports: [ObjectStorage],
})
export class StorageModule {}
