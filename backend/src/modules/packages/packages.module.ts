import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { RequirePermissions } from '../../common/auth/decorators.js';
import { API_TAGS, ApiProblem, ApiResult } from '../../common/http/openapi.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { FinanceModule } from '../finance/finance.module.js';
import { clientPackageSchema, servicePackageSchema } from './packages.responses.js';
import {
  createPackageSchema,
  listClientPackagesSchema,
  listPackagesSchema,
  refundPackageSchema,
  updatePackageSchema,
  type CreatePackageInput,
  type ListClientPackagesQuery,
  type ListPackagesQuery,
  type RefundPackageInput,
  type UpdatePackageInput,
} from './packages.schemas.js';
import { PackagesService } from './packages.service.js';

@ApiTags(API_TAGS.packages[0])
@Controller()
export class PackagesController {
  constructor(@Inject(PackagesService) private readonly packages: PackagesService) {}

  @RequirePermissions('packages:read')
  @ApiResult(z.array(servicePackageSchema))
  @ApiOperation({ summary: 'Lista pacotes à venda' })
  @Get('packages')
  list(@Query({ schema: listPackagesSchema }) query: ListPackagesQuery) {
    return this.packages.list(query);
  }

  @RequirePermissions('packages:manage')
  @ApiResult(servicePackageSchema, 201)
  @ApiOperation({ summary: 'Cadastra pacote (sessões por serviço, preço e validade em dias)' })
  @ApiProblem(422, 'invalid-service', 'Serviço inexistente.')
  @Post('packages')
  create(@Body({ schema: createPackageSchema }) input: CreatePackageInput) {
    return this.packages.create(input);
  }

  @RequirePermissions('packages:manage')
  @ApiResult(servicePackageSchema)
  @ApiOperation({ summary: 'Atualiza ou desativa pacote (vale só para vendas futuras)' })
  @Patch('packages/:id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: updatePackageSchema }) input: UpdatePackageInput,
  ) {
    return this.packages.update(id, input);
  }

  @RequirePermissions('packages:read')
  @ApiResult(z.array(clientPackageSchema))
  @ApiOperation({ summary: 'Pacotes vendidos (por cliente e situação; últimos 100)' })
  @Get('client-packages')
  listSold(@Query({ schema: listClientPackagesSchema }) query: ListClientPackagesQuery) {
    return this.packages.listSold(query);
  }

  @RequirePermissions('orders:void')
  @HttpCode(HttpStatus.OK)
  @ApiResult(clientPackageSchema)
  @ApiOperation({ summary: 'Reembolsa pacote pago (valor definido pela barbearia; encerra o pacote)' })
  @ApiProblem(
    422,
    'package-not-refundable | package-expired | refund-too-high',
    'Pacote já encerrado, vencido, ou valor acima do pago.',
  )
  @Post('client-packages/:id/refund')
  refund(
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: refundPackageSchema }) input: RefundPackageInput,
  ) {
    return this.packages.refund(id, input);
  }
}

@Module({
  imports: [CatalogModule, FinanceModule],
  controllers: [PackagesController],
  providers: [PackagesService],
  exports: [PackagesService],
})
export class PackagesModule {}
