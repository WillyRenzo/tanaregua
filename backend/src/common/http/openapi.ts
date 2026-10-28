import { applyDecorators, UseInterceptors } from '@nestjs/common';
import {
  ApiHeader,
  ApiResponse,
  type StandardSchemaConverter,
  type StandardSchemaObject,
} from '@nestjs/swagger';
import { z } from 'zod';
import { IdempotencyInterceptor } from '../idempotency/idempotency.interceptor.js';

/**
 * Converte schemas Zod para o OpenAPI (AFA 05: o contrato sai do mesmo schema que
 * valida a entrada e tipa a resposta). `Date` vira string date-time, que é como o JSON
 * de fato trafega.
 */
export const zodOpenApiConverter: StandardSchemaConverter = (schema, { schemaType }) => {
  if (!(schema instanceof z.ZodType)) return undefined;
  const json = z.toJSONSchema(schema, {
    io: schemaType,
    target: 'openapi-3.0',
    unrepresentable: 'any',
    override: (context) => {
      if (context.zodSchema._zod.def.type === 'date') {
        context.jsonSchema.type = 'string';
        context.jsonSchema.format = 'date-time';
      }
    },
  });
  // Schemas com `.meta({ id })` saem em `definitions`; viram components compartilhados
  // (o cliente gerado no frontend ganha tipos nomeados: Appointment, Order…).
  const { definitions, ...root } = JSON.parse(
    JSON.stringify(json).replaceAll('#/definitions/', '#/components/schemas/'),
  ) as { definitions?: Record<string, unknown> } & Record<string, unknown>;
  return { schema: root, components: definitions };
};

/** Página de resultados com cursor (ver common/http/pagination.ts). */
export const pageSchema = <T extends z.ZodType>(item: T, id: string) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() }).meta({ id });

/** Declara o contrato de resposta de uma rota a partir de um schema Zod. */
export const ApiResult = (schema: z.ZodType, status = 200) =>
  ApiResponse({ status, description: 'Sucesso', standardSchema: schema as StandardSchemaObject });

/**
 * Erro de regra de negócio documentado (RFC 9457). `code` é o final do `type` do
 * Problem Details — o mesmo valor que o frontend usa para tratar o caso.
 */
export const ApiProblem = (status: number, code: string, description: string) =>
  ApiResponse({
    status,
    description: `\`${code}\`: ${description}`,
    content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/ProblemDetails' } } },
  });

/**
 * POST protegido contra duplicidade: aplica o interceptor e documenta o cabeçalho.
 * A mesma chave reenviada devolve a resposta original em vez de executar de novo.
 */
export const Idempotent = () =>
  applyDecorators(
    UseInterceptors(IdempotencyInterceptor),
    ApiHeader({
      name: 'Idempotency-Key',
      required: false,
      description:
        'Opcional (8–100 caracteres, ex.: um UUID). Reenviar a mesma chave devolve a resposta original; a mesma chave com outro corpo responde 422.',
      schema: { type: 'string', example: '3f1c2b8e-6d4a-4e1f-9a7b-2c5d8e0f1a2b' },
    }),
  );

/** Grupos do Swagger, na ordem do fluxo de uso. Todo controller usa um deles em @ApiTags. */
export const API_TAGS = {
  auth: ['Autenticação', 'Cadastro da barbearia, login e sessão (refresh token em cookie httpOnly).'],
  barbershop: [
    'Barbearia',
    'Configurações: fuso, antecedência de cancelamento e intervalo entre atendimentos.',
  ],
  staff: ['Equipe', 'Funcionários, papéis, expediente semanal e folgas.'],
  clients: ['Clientes', 'Cadastro de clientes com consentimento e anonimização (LGPD).'],
  catalog: ['Serviços e comissões', 'Serviços (preço em centavos, duração) e regras de comissão.'],
  products: [
    'Produtos e estoque',
    'Produtos vendidos na comanda, entradas, ajustes e saldo (nunca negativo).',
  ],
  packages: [
    'Pacotes',
    'Pacotes de sessões por serviço: venda na comanda, saldo nunca negativo, validade e reembolso.',
  ],
  agenda: [
    'Agenda',
    'Agenda do dia, horários livres e agendamentos. Conflito de horário é barrado pelo banco.',
  ],
  orders: ['Comandas', 'Itens, fechamento (lança caixa e comissões) e estorno.'],
  finance: ['Financeiro', 'Caixa do dia e comissões por profissional.'],
  reports: ['Relatórios', 'Faturamento, profissionais, serviços e taxa de não comparecimento.'],
  publicBooking: [
    'Agendamento online',
    'Página pública de cada barbearia (/{slug}). Leitura sem login; reservar exige conta de cliente.',
  ],
  marketing: [
    'Aniversários e campanhas',
    'Mensagem automática de aniversário e campanhas por e-mail ou WhatsApp (modelos aprovados da Meta), só para quem consentiu no canal.',
  ],
  subscription: [
    'Assinatura e planos',
    'Planos da plataforma e os recursos de cada um. Recurso fora do plano responde 403 `plan-upgrade-required`.',
  ],
  health: ['Saúde', 'Probes de liveness e readiness.'],
} as const;
