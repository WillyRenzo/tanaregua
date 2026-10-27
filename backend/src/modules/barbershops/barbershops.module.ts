import { randomUUID } from 'node:crypto';
import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Injectable,
  Logger,
  Module,
  Patch,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import { RequirePermissions } from '../../common/auth/decorators.js';
import { notFound, unprocessable } from '../../common/http/domain-error.js';
import { ObjectStorage, type StoredObject } from '../../common/storage/object-storage.js';
import { TenantDb } from '../../common/tenancy/tenant-db.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { Tx } from '../../prisma/prisma.service.js';
import { barbershopSettingsSchema, type BarbershopSettings } from '../registry.responses.js';
import { API_TAGS, ApiProblem, ApiResult } from '../../common/http/openapi.js';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { LOGO_CONTENT_TYPE, LOGO_MAX_BYTES, normalizeLogo } from './logo-image.js';

const timezoneSchema = z.string().refine((zone) => {
  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}, 'Fuso horário inválido.');

/** Só hex de 6 dígitos, gravado em minúsculas: vira CSS custom property no frontend. */
const brandColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Use uma cor no formato #RRGGBB.')
  .transform((color) => color.toLowerCase())
  .nullable();

export const updateBarbershopSchema = z.strictObject({
  name: z.string().trim().min(2).max(100).optional(),
  timezone: timezoneSchema.optional(),
  cancellationMinNoticeMinutes: z
    .number()
    .int()
    .min(0)
    .max(7 * 24 * 60)
    .optional(),
  rescheduleMinNoticeMinutes: z
    .number()
    .int()
    .min(0)
    .max(7 * 24 * 60)
    .optional(),
  bufferMinutes: z.number().int().min(0).max(120).optional(),
  /** `null` volta para a cor padrão do TaNaRegua. */
  brandPrimaryColor: brandColorSchema.optional(),
  brandSecondaryColor: brandColorSchema.optional(),
});
type UpdateBarbershopInput = z.infer<typeof updateBarbershopSchema>;

const settingsSelect = {
  id: true,
  name: true,
  slug: true,
  timezone: true,
  cancellationMinNoticeMinutes: true,
  rescheduleMinNoticeMinutes: true,
  bufferMinutes: true,
  brandPrimaryColor: true,
  brandSecondaryColor: true,
  logoKey: true,
} as const;

type SettingsRow = Prisma.BarbershopGetPayload<{ select: typeof settingsSelect }>;

/** A chave de storage não sai da API: só a versão do logo (o uuid do arquivo). */
const toSettings = ({
  brandPrimaryColor,
  brandSecondaryColor,
  logoKey,
  ...row
}: SettingsRow): BarbershopSettings => ({
  ...row,
  brand: {
    primaryColor: brandPrimaryColor,
    secondaryColor: brandSecondaryColor,
    logoVersion: logoKey ? (/logo-([0-9a-f-]+)\./.exec(logoKey)?.[1] ?? null) : null,
  },
});

/** O que o multer entrega (memória, nunca disco): só o necessário. */
interface UploadedLogo {
  buffer: Buffer;
  size: number;
}

export type { BarbershopSettings };

@Injectable()
export class BarbershopsService {
  private readonly logger = new Logger(BarbershopsService.name);

  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(ObjectStorage) private readonly storage: ObjectStorage,
  ) {}

  get(): Promise<BarbershopSettings> {
    return this.db.run((tx, auth) => this.settings(tx, auth.barbershopId));
  }

  /** Usado por outros módulos (agenda, relatórios) que precisam do fuso e das políticas. */
  async settings(tx: Tx, barbershopId: string): Promise<BarbershopSettings> {
    const barbershop = await tx.barbershop.findUnique({
      where: { id: barbershopId },
      select: settingsSelect,
    });
    if (!barbershop) throw notFound('Barbearia');
    return toSettings(barbershop);
  }

  findBySlug(slug: string): Promise<BarbershopSettings> {
    return this.db.runAs('', async (tx) => {
      const barbershop = await tx.barbershop.findUnique({ where: { slug }, select: settingsSelect });
      if (!barbershop) throw notFound('Barbearia');
      return toSettings(barbershop);
    });
  }

  update(input: UpdateBarbershopInput): Promise<BarbershopSettings> {
    return this.db.run(async (tx, auth) =>
      toSettings(
        await tx.barbershop.update({ where: { id: auth.barbershopId }, data: input, select: settingsSelect }),
      ),
    );
  }

  /**
   * Troca o logo: reprocessa a imagem, grava com nome gerado sob o prefixo da barbearia e
   * só depois de gravar no banco apaga o arquivo anterior.
   */
  async replaceLogo(upload: UploadedLogo | undefined): Promise<BarbershopSettings> {
    if (!upload || upload.size === 0) throw unprocessable('invalid-image', 'Envie o arquivo do logo.');
    const body = await normalizeLogo(upload.buffer);
    const { settings, previousKey } = await this.db.run(async (tx, auth) => {
      const key = `barbershops/${auth.barbershopId}/logo-${randomUUID()}.webp`;
      const current = await tx.barbershop.findUniqueOrThrow({
        where: { id: auth.barbershopId },
        select: { logoKey: true },
      });
      await this.storage.put(key, { body, contentType: LOGO_CONTENT_TYPE });
      const updated = await tx.barbershop.update({
        where: { id: auth.barbershopId },
        data: { logoKey: key },
        select: settingsSelect,
      });
      return { settings: toSettings(updated), previousKey: current.logoKey };
    });
    await this.deleteQuietly(previousKey);
    return settings;
  }

  async removeLogo(): Promise<BarbershopSettings> {
    const { settings, previousKey } = await this.db.run(async (tx, auth) => {
      const current = await tx.barbershop.findUniqueOrThrow({
        where: { id: auth.barbershopId },
        select: { logoKey: true },
      });
      const updated = await tx.barbershop.update({
        where: { id: auth.barbershopId },
        data: { logoKey: null },
        select: settingsSelect,
      });
      return { settings: toSettings(updated), previousKey: current.logoKey };
    });
    await this.deleteQuietly(previousKey);
    return settings;
  }

  /** Logo público da barbearia (página de agendamento e painel). */
  async logo(slug: string): Promise<StoredObject> {
    const key = await this.db.runAs('', async (tx) => {
      const barbershop = await tx.barbershop.findUnique({ where: { slug }, select: { logoKey: true } });
      return barbershop?.logoKey ?? null;
    });
    const object = key ? await this.storage.get(key) : null;
    if (!object) throw notFound('Logo');
    return object;
  }

  /** Arquivo órfão não quebra nada: falha ao apagar só vira log. */
  private async deleteQuietly(key: string | null): Promise<void> {
    if (!key) return;
    try {
      await this.storage.delete(key);
    } catch (error) {
      this.logger.warn(
        `Não foi possível apagar ${key}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

@ApiTags(API_TAGS.barbershop[0])
@Controller('barbershop')
export class BarbershopsController {
  constructor(@Inject(BarbershopsService) private readonly barbershops: BarbershopsService) {}

  @RequirePermissions('barbershop:manage', 'appointments:read:any', 'appointments:read:own')
  @ApiResult(barbershopSettingsSchema)
  @ApiOperation({ summary: 'Configurações da barbearia' })
  @Get()
  get(): Promise<BarbershopSettings> {
    return this.barbershops.get();
  }

  @RequirePermissions('barbershop:manage')
  @ApiResult(barbershopSettingsSchema)
  @ApiOperation({ summary: 'Atualiza as configurações (inclui as cores da marca)' })
  @Patch()
  update(@Body({ schema: updateBarbershopSchema }) input: UpdateBarbershopInput) {
    return this.barbershops.update(input);
  }

  @RequirePermissions('barbershop:manage')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: LOGO_MAX_BYTES, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary', description: 'PNG, JPEG ou WebP, até 1 MB' } },
    },
  })
  @ApiResult(barbershopSettingsSchema)
  @ApiOperation({ summary: 'Envia ou troca o logo (reprocessado para WebP, até 512×512)' })
  @ApiProblem(
    422,
    'invalid-image',
    'Arquivo ausente, corrompido ou fora de PNG/JPEG/WebP (SVG não é aceito).',
  )
  @ApiProblem(413, 'about:blank', 'Arquivo maior que 1 MB.')
  @Put('logo')
  uploadLogo(@UploadedFile() file: UploadedLogo | undefined) {
    return this.barbershops.replaceLogo(file);
  }

  @RequirePermissions('barbershop:manage')
  @ApiResult(barbershopSettingsSchema)
  @ApiOperation({ summary: 'Remove o logo (volta para a identidade TaNaRegua)' })
  @Delete('logo')
  removeLogo() {
    return this.barbershops.removeLogo();
  }
}

@Module({
  controllers: [BarbershopsController],
  providers: [BarbershopsService],
  exports: [BarbershopsService],
})
export class BarbershopsModule {}
