import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { API_TAGS, zodOpenApiConverter } from './common/http/openapi.js';
import { createValidationPipe } from './common/http/validation.js';
import type { Env } from './config/env.js';

export const API_PREFIX = 'v1';

/** Configuração compartilhada entre main.ts, testes e2e e geração do OpenAPI. */
export function configureApp(app: INestApplication): void {
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  app.useLogger(app.get(Logger));
  const hops = config.get('TRUST_PROXY_HOPS');
  if (hops > 0) {
    (app as NestExpressApplication).set('trust proxy', hops);
  }
  app.use(
    helmet(
      config.get('NODE_ENV') === 'production'
        ? {}
        : // Fora de produção a API roda em HTTP: `upgrade-insecure-requests` faria o navegador
          // buscar os arquivos do Swagger UI via HTTPS e a página quebraria.
          // COOP só é honrado em HTTPS/localhost; fora disso o navegador só emite aviso.
          {
            contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } },
            crossOriginOpenerPolicy: false,
          },
    ),
  );
  app.use(cookieParser());
  app.enableCors({ origin: config.get('CORS_ORIGINS'), credentials: true });
  app.setGlobalPrefix(API_PREFIX, { exclude: ['health/{*path}'] });
  app.useGlobalPipes(createValidationPipe());
  app.enableShutdownHooks();
}

const DESCRIPTION = `
API do **TaNaRegua** — gestão para barbearias. Valores em **centavos**, percentuais em
**basis points** (4000 = 40%), datas em ISO 8601 (UTC) e erros no formato
[RFC 9457 Problem Details](https://www.rfc-editor.org/rfc/rfc9457).

### Como testar por aqui

1. **Autenticação → POST /v1/auth/register-barbershop** com o exemplo pronto (troque \`slug\` e \`email\` se já existirem).
2. Copie o \`accessToken\` da resposta, clique em **Authorize** (cadeado no topo) e cole. A autorização fica salva ao recarregar a página.
3. Cadastre o necessário: **Equipe → PUT /v1/staff/{id}/schedule** (use o \`profile.membership.id\` da resposta do cadastro), **Serviços → POST /v1/services** e **Clientes → POST /v1/clients**.
4. Agende em **Agenda → POST /v1/appointments**. Tente outro horário sobreposto para ver o \`409 appointment-conflict\`.
5. Feche o atendimento: **Comandas → POST /v1/orders** com o \`appointmentId\`, depois **POST /v1/orders/{id}/close**.

O access token vale 15 minutos. Quando expirar, chame **POST /v1/auth/refresh** (o cookie de refresh já
foi gravado pelo login) e atualize o **Authorize** com o novo token.

Rotas sem cadeado são públicas. As permissões exigidas aparecem na descrição de cada rota
(basta uma delas). Recurso de outra barbearia responde **404**.
`;

/** Contrato da API (AFA 05). Exportado para `contracts/openapi.json` por `npm run openapi:export`. */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const builder = new DocumentBuilder()
    .setTitle('TaNaRegua API')
    .setDescription(DESCRIPTION.trim())
    .setVersion('1.0.0')
    .addBearerAuth({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
      description: 'accessToken do login/cadastro',
    })
    .addSecurityRequirements('bearer');
  for (const [name, description] of Object.values(API_TAGS)) builder.addTag(name, description);

  const document = SwaggerModule.createDocument(app, builder.build(), {
    standardSchemaConverter: zodOpenApiConverter,
  });
  document.components = {
    ...document.components,
    schemas: { ...document.components?.schemas, ProblemDetails: PROBLEM_DETAILS_SCHEMA },
  };
  enrichOperations(document);
  return document;
}

/** Swagger UI em /docs (só fora de produção; ver main.ts). */
export function setupSwagger(app: INestApplication): void {
  SwaggerModule.setup('docs', app, buildOpenApiDocument(app), {
    customSiteTitle: 'TaNaRegua API',
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      docExpansion: 'none',
      filter: true,
      tryItOutEnabled: true,
    },
  });
}

const PROBLEM_DETAILS_SCHEMA = {
  type: 'object',
  description: 'Erro no formato RFC 9457. O final de `type` identifica o caso (ex.: appointment-conflict).',
  required: ['type', 'title', 'status'],
  properties: {
    type: { type: 'string', example: 'https://tanaregua.app/problems/appointment-conflict' },
    title: { type: 'string', example: 'Conflict' },
    status: { type: 'integer', example: 409 },
    detail: { type: 'string', example: 'O profissional já tem um atendimento às 10:00.' },
    instance: { type: 'string', example: '/v1/appointments' },
    errors: { type: 'array', items: { type: 'string' }, example: ['email: E-mail inválido.'] },
  },
};

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

interface Operation {
  description?: string;
  security?: unknown[];
  requestBody?: unknown;
  parameters?: { in?: string }[];
  responses?: Record<string, unknown>;
  'x-public'?: boolean;
  'x-required-permissions'?: string[];
  'x-required-feature'?: string;
  'x-platform'?: boolean;
  'x-allowed-when-read-only'?: boolean;
}

const problem = (description: string) => ({
  description,
  content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/ProblemDetails' } } },
});

/**
 * Completa cada operação a partir do que os decorators de acesso declararam (x-public,
 * x-required-permissions, x-required-feature): rota pública sem cadeado, permissões e
 * recurso do plano na descrição e as respostas de erro genéricas daquele tipo de rota.
 */
function enrichOperations(document: OpenAPIObject): void {
  for (const [path, item] of Object.entries(document.paths)) {
    for (const method of HTTP_METHODS) {
      const operation = (item as Record<string, Operation | undefined>)[method];
      if (!operation) continue;
      const isPublic = operation['x-public'] === true;
      const permissions = operation['x-required-permissions'];
      const feature = operation['x-required-feature'];
      const responses = (operation.responses ??= {});

      if (isPublic) operation.security = [];
      if (operation['x-platform']) {
        operation.description = [
          operation.description,
          '**Acesso:** administração da plataforma (token próprio; token de barbearia é recusado).',
        ]
          .filter(Boolean)
          .join('\n\n');
      }
      if (permissions) {
        const list = permissions.map((permission) => `\`${permission}\``).join(', ');
        operation.description = [operation.description, `**Permissões (basta uma):** ${list}`]
          .filter(Boolean)
          .join('\n\n');
      }
      if (feature) {
        operation.description = [operation.description, `**Recurso do plano:** \`${feature}\``]
          .filter(Boolean)
          .join('\n\n');
        responses['403'] = problem(
          'O papel não tem as permissões exigidas ou o recurso não está no plano da barbearia (`plan-upgrade-required`).',
        );
      }

      const hasInput = operation.requestBody || operation.parameters?.some((p) => p.in === 'query');
      if (hasInput)
        responses['400'] ??= problem(
          'Dados inválidos: campo ausente, formato errado ou campo não permitido.',
        );
      if (!isPublic) responses['401'] ??= problem('Sem token ou token expirado. Use **Authorize**.');
      if (permissions)
        responses['403'] ??= problem('O papel do usuário não tem nenhuma das permissões exigidas.');
      if (path.includes('{')) responses['404'] ??= problem('Recurso inexistente ou de outra barbearia.');
      if (isPublic) responses['429'] ??= problem('Muitas requisições do mesmo IP (rate limit).');
      if (!isPublic && !operation['x-platform'] && !operation['x-allowed-when-read-only'] && method !== 'get')
        responses['402'] ??= problem(
          'Painel só para consulta: teste grátis vencido, carência esgotada ou assinatura cancelada (`subscription-inactive`).',
        );
    }
  }
}
