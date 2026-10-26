import { Global, Module } from '@nestjs/common';
import { TenantDb } from '../common/tenancy/tenant-db.service.js';
import { PrismaService } from './prisma.service.js';

@Global()
@Module({
  providers: [PrismaService, TenantDb],
  exports: [PrismaService, TenantDb],
})
export class PrismaModule {}
