import { Global, Inject, Injectable, Logger, Module } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service.js';
import { IdempotencyInterceptor } from './idempotency.interceptor.js';

const RETENTION_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class IdempotencyCleanup {
  private readonly logger = new Logger(IdempotencyCleanup.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Chaves valem 24h; depois disso o mesmo valor pode ser reutilizado. */
  @Cron(CronExpression.EVERY_HOUR)
  async purgeExpired(): Promise<void> {
    const { count } = await this.prisma.idempotencyKey.deleteMany({
      where: { createdAt: { lt: new Date(Date.now() - RETENTION_MS) } },
    });
    if (count > 0) this.logger.log(`${count} chaves de idempotência expiradas removidas`);
  }
}

@Global()
@Module({
  providers: [IdempotencyInterceptor, IdempotencyCleanup],
  exports: [IdempotencyInterceptor],
})
export class IdempotencyModule {}
