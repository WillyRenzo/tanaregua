import { Body, Controller, Get, Inject, Injectable, Module, Patch } from '@nestjs/common';
import { z } from 'zod';
import { RequirePermissions } from '../../common/auth/decorators.js';
import { notFound } from '../../common/http/domain-error.js';
import { TenantDb } from '../../common/tenancy/tenant-db.service.js';
import type { Tx } from '../../prisma/prisma.service.js';
import { barbershopSettingsSchema, type BarbershopSettings } from '../registry.responses.js';
import { API_TAGS, ApiResult } from '../../common/http/openapi.js';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

const timezoneSchema = z.string().refine((zone) => {
  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}, 'Fuso horário inválido.');

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
} as const;

export type { BarbershopSettings };

@Injectable()
export class BarbershopsService {
  constructor(@Inject(TenantDb) private readonly db: TenantDb) {}

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
    return barbershop;
  }

  findBySlug(slug: string): Promise<BarbershopSettings> {
    return this.db.runAs('', async (tx) => {
      const barbershop = await tx.barbershop.findUnique({ where: { slug }, select: settingsSelect });
      if (!barbershop) throw notFound('Barbearia');
      return barbershop;
    });
  }

  update(input: UpdateBarbershopInput): Promise<BarbershopSettings> {
    return this.db.run((tx, auth) =>
      tx.barbershop.update({ where: { id: auth.barbershopId }, data: input, select: settingsSelect }),
    );
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
  @ApiOperation({ summary: 'Atualiza as configurações' })
  @Patch()
  update(@Body({ schema: updateBarbershopSchema }) input: UpdateBarbershopInput) {
    return this.barbershops.update(input);
  }
}

@Module({
  controllers: [BarbershopsController],
  providers: [BarbershopsService],
  exports: [BarbershopsService],
})
export class BarbershopsModule {}
