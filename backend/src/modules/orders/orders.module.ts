import { API_TAGS, ApiProblem, ApiResult, Idempotent } from '../../common/http/openapi.js';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { orderPageSchema, orderViewSchema } from '../finance/finance.responses.js';
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
  Query,
} from '@nestjs/common';
import { RequirePermissions } from '../../common/auth/decorators.js';
import { AppointmentsModule } from '../appointments/appointments.module.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { ClientsModule } from '../clients/clients.module.js';
import { FinanceModule } from '../finance/finance.module.js';
import { StaffModule } from '../staff/staff.module.js';
import {
  closeOrderSchema,
  listOrdersSchema,
  openOrderSchema,
  orderItemInputSchema,
  updateOrderItemSchema,
  voidOrderSchema,
  type CloseOrderInput,
  type ListOrdersQuery,
  type OpenOrderInput,
  type OrderItemInput,
  type UpdateOrderItemInput,
  type VoidOrderInput,
} from './orders.schemas.js';
import { OrdersService } from './orders.service.js';

@ApiTags(API_TAGS.orders[0])
@Controller('orders')
export class OrdersController {
  constructor(@Inject(OrdersService) private readonly orders: OrdersService) {}

  @RequirePermissions('orders:read:any')
  @ApiResult(orderPageSchema)
  @ApiOperation({ summary: 'Lista comandas (paginado)' })
  @Get()
  list(@Query({ schema: listOrdersSchema }) query: ListOrdersQuery) {
    return this.orders.list(query);
  }

  @RequirePermissions('orders:read:any')
  @ApiResult(orderViewSchema)
  @ApiOperation({ summary: 'Detalhe da comanda (com comissão prevista)' })
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.orders.get(id);
  }

  @RequirePermissions('orders:manage')
  @ApiResult(orderViewSchema, 201)
  @ApiOperation({ summary: 'Abre comanda a partir do agendamento ou avulsa' })
  @ApiProblem(409, 'order-already-exists', 'O agendamento já tem comanda.')
  @ApiProblem(422, 'appointment-not-orderable', 'Agendamento cancelado ou com falta.')
  @Post()
  open(@Body({ schema: openOrderSchema }) input: OpenOrderInput) {
    return this.orders.open(input);
  }

  @RequirePermissions('orders:manage')
  @ApiResult(orderViewSchema, 201)
  @ApiOperation({ summary: 'Adiciona serviço à comanda' })
  @ApiProblem(422, 'order-not-open | discount-too-high', 'Comanda fechada ou desconto maior que o item.')
  @Post(':id/items')
  addItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: orderItemInputSchema }) input: OrderItemInput,
  ) {
    return this.orders.addItem(id, input);
  }

  @RequirePermissions('orders:manage')
  @ApiResult(orderViewSchema)
  @ApiOperation({ summary: 'Altera quantidade ou desconto do item' })
  @ApiProblem(422, 'order-not-open | discount-too-high', 'Comanda fechada ou desconto maior que o item.')
  @Patch(':id/items/:itemId')
  updateItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body({ schema: updateOrderItemSchema }) input: UpdateOrderItemInput,
  ) {
    return this.orders.updateItem(id, itemId, input);
  }

  @RequirePermissions('orders:manage')
  @ApiResult(orderViewSchema)
  @ApiOperation({ summary: 'Remove item da comanda' })
  @ApiProblem(422, 'order-not-open', 'Comanda fechada não pode ser alterada.')
  @Delete(':id/items/:itemId')
  removeItem(@Param('id', ParseUUIDPipe) id: string, @Param('itemId', ParseUUIDPipe) itemId: string) {
    return this.orders.removeItem(id, itemId);
  }

  @RequirePermissions('orders:manage')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @ApiResult(orderViewSchema)
  @ApiOperation({ summary: 'Fecha a comanda: lança caixa e comissões' })
  @ApiProblem(422, 'order-not-open | order-empty', 'Comanda já fechada ou sem itens.')
  @Post(':id/close')
  close(@Param('id', ParseUUIDPipe) id: string, @Body({ schema: closeOrderSchema }) input: CloseOrderInput) {
    return this.orders.close(id, input);
  }

  @RequirePermissions('orders:void')
  @HttpCode(HttpStatus.OK)
  @ApiResult(orderViewSchema)
  @ApiOperation({ summary: 'Estorna (fechada) ou descarta (aberta)' })
  @ApiProblem(422, 'order-already-voided', 'Comanda já estornada.')
  @Post(':id/void')
  void(@Param('id', ParseUUIDPipe) id: string, @Body({ schema: voidOrderSchema }) input: VoidOrderInput) {
    return this.orders.void(id, input);
  }
}

@Module({
  imports: [AppointmentsModule, CatalogModule, StaffModule, ClientsModule, FinanceModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
