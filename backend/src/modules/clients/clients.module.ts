import { API_TAGS, ApiProblem, ApiResult } from '../../common/http/openapi.js';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { clientPageSchema, clientViewSchema } from '../registry.responses.js';
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
import { RequirePermissions } from '../../common/auth/decorators.js';
import {
  createClientSchema,
  listClientsSchema,
  updateClientSchema,
  type CreateClientInput,
  type ListClientsQuery,
  type UpdateClientInput,
} from './clients.schemas.js';
import { ClientsService } from './clients.service.js';

@ApiTags(API_TAGS.clients[0])
@Controller('clients')
export class ClientsController {
  constructor(@Inject(ClientsService) private readonly clients: ClientsService) {}

  @RequirePermissions('clients:read')
  @ApiResult(clientPageSchema)
  @ApiOperation({ summary: 'Busca clientes por nome ou telefone (paginado)' })
  @Get()
  list(@Query({ schema: listClientsSchema }) query: ListClientsQuery) {
    return this.clients.list(query);
  }

  @RequirePermissions('clients:read')
  @ApiResult(clientViewSchema)
  @ApiOperation({ summary: 'Detalhe do cliente' })
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.clients.get(id);
  }

  @RequirePermissions('clients:manage')
  @ApiResult(clientViewSchema, 201)
  @ApiOperation({ summary: 'Cadastra cliente' })
  @Post()
  create(@Body({ schema: createClientSchema }) input: CreateClientInput) {
    return this.clients.create(input);
  }

  @RequirePermissions('clients:manage')
  @ApiResult(clientViewSchema)
  @ApiOperation({ summary: 'Atualiza cliente (inclusive consentimento)' })
  @ApiProblem(422, 'client-anonymized', 'Cliente anonimizado não pode ser editado.')
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: updateClientSchema }) input: UpdateClientInput,
  ) {
    return this.clients.update(id, input);
  }

  @RequirePermissions('clients:manage')
  @ApiResult(clientViewSchema, 201)
  @ApiOperation({ summary: 'Remove os dados pessoais (pedido LGPD)' })
  @Post(':id/anonymize')
  anonymize(@Param('id', ParseUUIDPipe) id: string) {
    return this.clients.anonymize(id);
  }
}

@Module({
  controllers: [ClientsController],
  providers: [ClientsService],
  exports: [ClientsService],
})
export class ClientsModule {}
