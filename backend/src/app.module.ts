import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type { Request } from 'express';
import { ClsModule } from 'nestjs-cls';
import { LoggerModule } from 'nestjs-pino';
import { AccessGuard } from './common/auth/access.guard.js';
import { ReadOnlyGuard } from './common/auth/read-only.js';
import { FeatureGuard } from './common/auth/requires-feature.js';
import { isInternalRequest } from './common/http/internal-request.js';
import { ProblemDetailsFilter } from './common/http/problem-details.filter.js';
import { validateEnv, type Env } from './config/env.js';
import { HealthModule } from './health/health.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { BarbershopsModule } from './modules/barbershops/barbershops.module.js';
import { CatalogModule } from './modules/catalog/catalog.module.js';
import { ClientsModule } from './modules/clients/clients.module.js';
import { StaffModule } from './modules/staff/staff.module.js';
import { IdempotencyModule } from './common/idempotency/idempotency.module.js';
import { AppointmentsModule } from './modules/appointments/appointments.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { OutboxModule } from './modules/notifications/outbox.service.js';
import { PublicBookingModule } from './modules/public-booking/public-booking.module.js';
import { FinanceModule } from './modules/finance/finance.module.js';
import { OrdersModule } from './modules/orders/orders.module.js';
import { ProductsModule } from './modules/products/products.module.js';
import { PackagesModule } from './modules/packages/packages.module.js';
import { ReportsModule } from './modules/reports/reports.module.js';
import { MarketingModule } from './modules/marketing/marketing.module.js';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module.js';
import { PlatformModule } from './modules/platform/platform.module.js';
import { BillingModule } from './modules/subscriptions/billing.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { ClockModule } from './common/time/clock.js';
import { StorageModule } from './common/storage/object-storage.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv, ignoreEnvFile: true }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL'),
          genReqId: (request, response) => {
            const header = request.headers['x-request-id'];
            const id = typeof header === 'string' && header.length <= 128 ? header : randomUUID();
            response.setHeader('x-request-id', id);
            return id;
          },
          // Nunca logar credenciais (security.md). Corpo de requisição não é logado.
          redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
          transport:
            config.get('NODE_ENV') === 'development'
              ? { target: 'pino-pretty', options: { singleLine: true } }
              : undefined,
        },
      }),
    }),
    ClsModule.forRoot({ global: true, middleware: { mount: true } }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        throttlers: [{ name: 'default', ttl: 60_000, limit: 120 }],
        // Testes (e2e do backend e Playwright) criam dezenas de contas por minuto do mesmo IP.
        // O SSR do Next sai sempre do mesmo IP e se identifica pelo token interno (security.md).
        skipIf: (context) =>
          config.get('NODE_ENV') === 'test' ||
          !config.get('RATE_LIMIT_ENABLED') ||
          isInternalRequest(
            context.switchToHttp().getRequest<Request>().headers,
            config.get('INTERNAL_API_TOKEN'),
          ),
      }),
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    ClockModule,
    StorageModule,
    HealthModule,
    AuthModule,
    BarbershopsModule,
    StaffModule,
    ClientsModule,
    CatalogModule,
    ProductsModule,
    PackagesModule,
    IdempotencyModule,
    OutboxModule,
    AppointmentsModule,
    NotificationsModule,
    PublicBookingModule,
    FinanceModule,
    OrdersModule,
    ReportsModule,
    MarketingModule,
    SubscriptionsModule,
    PlatformModule,
    BillingModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AccessGuard },
    // Depois do AccessGuard: precisa do tenant autenticado para ler a assinatura.
    { provide: APP_GUARD, useClass: FeatureGuard },
    // Modo só leitura da assinatura (§12): escrita barrada com teste vencido ou sem pagamento.
    { provide: APP_GUARD, useClass: ReadOnlyGuard },
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
  ],
})
export class AppModule {}
