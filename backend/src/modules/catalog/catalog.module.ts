import { z } from 'zod';
import { API_TAGS, ApiResult } from '../../common/http/openapi.js';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { commissionRuleSchema, serviceViewSchema } from '../registry.responses.js';
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
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { RequirePermissions } from '../../common/auth/decorators.js';
import { ProductsModule } from '../products/products.module.js';
import { StaffModule } from '../staff/staff.module.js';
import {
  createServiceSchema,
  listServicesSchema,
  updateServiceSchema,
  upsertCommissionRuleSchema,
  type CreateServiceInput,
  type ListServicesQuery,
  type UpdateServiceInput,
  type UpsertCommissionRuleInput,
} from './catalog.schemas.js';
import { CatalogService } from './catalog.service.js';

@ApiTags(API_TAGS.catalog[0])
@Controller()
export class CatalogController {
  constructor(@Inject(CatalogService) private readonly catalog: CatalogService) {}

  @RequirePermissions('services:read')
  @ApiResult(z.array(serviceViewSchema))
  @ApiOperation({ summary: 'Lista serviços' })
  @Get('services')
  listServices(@Query({ schema: listServicesSchema }) query: ListServicesQuery) {
    return this.catalog.listServices(query);
  }

  @RequirePermissions('services:manage')
  @ApiResult(serviceViewSchema, 201)
  @ApiOperation({ summary: 'Cadastra serviço' })
  @Post('services')
  createService(@Body({ schema: createServiceSchema }) input: CreateServiceInput) {
    return this.catalog.createService(input);
  }

  @RequirePermissions('services:manage')
  @ApiResult(serviceViewSchema)
  @ApiOperation({ summary: 'Atualiza ou desativa serviço' })
  @Patch('services/:id')
  updateService(
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: updateServiceSchema }) input: UpdateServiceInput,
  ) {
    return this.catalog.updateService(id, input);
  }

  @RequirePermissions('services:manage')
  @ApiResult(z.array(commissionRuleSchema))
  @ApiOperation({ summary: 'Lista regras de comissão' })
  @Get('commission-rules')
  listCommissionRules() {
    return this.catalog.listCommissionRules();
  }

  @RequirePermissions('services:manage')
  @ApiResult(commissionRuleSchema)
  @ApiOperation({ summary: 'Cria ou atualiza regra de comissão (uma por alvo)' })
  @Put('commission-rules')
  upsertCommissionRule(@Body({ schema: upsertCommissionRuleSchema }) input: UpsertCommissionRuleInput) {
    return this.catalog.upsertCommissionRule(input);
  }

  @RequirePermissions('services:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove regra de comissão' })
  @Delete('commission-rules/:id')
  deleteCommissionRule(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.deleteCommissionRule(id);
  }
}

@Module({
  imports: [StaffModule, ProductsModule],
  controllers: [CatalogController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
