import {
  Body,
  Controller,
  Get,
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
import { StaffModule } from '../staff/staff.module.js';
import { productViewSchema, stockMovementSchema } from './products.responses.js';
import {
  createProductSchema,
  listProductsSchema,
  stockAdjustmentSchema,
  stockEntrySchema,
  updateProductSchema,
  type CreateProductInput,
  type ListProductsQuery,
  type StockAdjustmentInput,
  type StockEntryInput,
  type UpdateProductInput,
} from './products.schemas.js';
import { ProductsService } from './products.service.js';

@ApiTags(API_TAGS.products[0])
@Controller('products')
export class ProductsController {
  constructor(@Inject(ProductsService) private readonly products: ProductsService) {}

  @RequirePermissions('products:read')
  @ApiResult(z.array(productViewSchema))
  @ApiOperation({ summary: 'Lista produtos com saldo (custo e valor em estoque só para quem gerencia)' })
  @Get()
  list(@Query({ schema: listProductsSchema }) query: ListProductsQuery) {
    return this.products.list(query);
  }

  @RequirePermissions('products:read')
  @ApiResult(productViewSchema)
  @ApiOperation({ summary: 'Detalhe do produto' })
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.products.get(id);
  }

  @RequirePermissions('products:manage')
  @ApiResult(productViewSchema, 201)
  @ApiOperation({ summary: 'Cadastra produto (o saldo começa em zero; use uma entrada)' })
  @Post()
  create(@Body({ schema: createProductSchema }) input: CreateProductInput) {
    return this.products.create(input);
  }

  @RequirePermissions('products:manage')
  @ApiResult(productViewSchema)
  @ApiOperation({ summary: 'Atualiza ou desativa produto (o saldo não muda por aqui)' })
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: updateProductSchema }) input: UpdateProductInput,
  ) {
    return this.products.update(id, input);
  }

  @RequirePermissions('products:manage')
  @ApiResult(z.array(stockMovementSchema))
  @ApiOperation({ summary: 'Histórico de movimentações do produto (últimas 100)' })
  @Get(':id/movements')
  movements(@Param('id', ParseUUIDPipe) id: string) {
    return this.products.movements(id);
  }

  @RequirePermissions('products:manage')
  @ApiResult(productViewSchema, 201)
  @ApiOperation({ summary: 'Registra entrada de mercadoria' })
  @Post(':id/stock-entries')
  addEntry(
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: stockEntrySchema }) input: StockEntryInput,
  ) {
    return this.products.addEntry(id, input);
  }

  @RequirePermissions('products:manage')
  @ApiResult(productViewSchema, 201)
  @ApiOperation({ summary: 'Registra ajuste de estoque (inventário, perda, quebra)' })
  @ApiProblem(422, 'insufficient-stock', 'O ajuste deixaria o saldo negativo.')
  @Post(':id/stock-adjustments')
  adjust(
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: stockAdjustmentSchema }) input: StockAdjustmentInput,
  ) {
    return this.products.adjust(id, input);
  }
}

@Module({
  imports: [StaffModule],
  controllers: [ProductsController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
