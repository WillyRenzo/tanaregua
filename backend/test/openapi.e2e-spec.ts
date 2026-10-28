import type { OpenAPIObject } from '@nestjs/swagger';
import request from 'supertest';
import { buildOpenApiDocument, setupSwagger } from '../src/app.setup.js';
import { API_TAGS } from '../src/common/http/openapi.js';
import { createTestApp, type TestApp } from './helpers/app.js';

type Operation = {
  summary?: string;
  description?: string;
  tags?: string[];
  security?: unknown[];
  responses: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }>;
  parameters?: { name: string; in: string }[];
  'x-public'?: boolean;
  'x-required-permissions'?: string[];
  'x-required-feature'?: string;
};

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

function operations(document: OpenAPIObject): { key: string; operation: Operation }[] {
  return Object.entries(document.paths).flatMap(([path, item]) =>
    METHODS.flatMap((method) => {
      const operation = (item as Record<string, Operation | undefined>)[method];
      return operation ? [{ key: `${method.toUpperCase()} ${path}`, operation }] : [];
    }),
  );
}

/**
 * Guarda da documentação (AFA 05): rota nova sem resumo, sem grupo ou sem contrato de
 * resposta quebra este teste — o Swagger nunca fica para trás do código.
 */
describe('Documentação OpenAPI (e2e)', () => {
  let app: TestApp;
  let document: OpenAPIObject;

  beforeAll(async () => {
    app = await createTestApp();
    document = buildOpenApiDocument(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('toda rota tem resumo, grupo conhecido e resposta de sucesso documentada', () => {
    const tagNames: string[] = Object.values(API_TAGS).map(([name]) => name);
    const problems = operations(document).flatMap(({ key, operation }) => {
      const issues: string[] = [];
      if (!operation.summary) issues.push('sem @ApiOperation({ summary })');
      if (operation.tags?.length !== 1 || !tagNames.includes(operation.tags[0]!))
        issues.push('sem @ApiTags válido');
      const success = Object.keys(operation.responses).filter((status) => status.startsWith('2'));
      const isHealth = key.includes('/health/');
      const isNoContent = success.includes('204');
      if (!isHealth && !isNoContent && success.length === 0) issues.push('sem @ApiResult');
      return issues.map((issue) => `${key}: ${issue}`);
    });
    expect(problems).toEqual([]);
  });

  it('rotas públicas saem sem cadeado; protegidas exigem token e listam as permissões', () => {
    for (const { key, operation } of operations(document)) {
      if (operation['x-public']) {
        expect(operation.security, key).toEqual([]);
        expect(operation.responses['401'], key).toBeUndefined();
      } else {
        expect(operation.security, key).toBeUndefined(); // herda o bearer global
        expect(operation.responses['401'], key).toBeDefined();
      }
      for (const permission of operation['x-required-permissions'] ?? []) {
        expect(operation.description, key).toContain(`\`${permission}\``);
      }
      const feature = operation['x-required-feature'];
      if (feature) {
        expect(operation.description, key).toContain(`**Recurso do plano:** \`${feature}\``);
        expect(operation.responses['403'], key).toBeDefined();
      }
    }
  });

  it('erros apontam para o schema ProblemDetails, que existe no documento', () => {
    expect(document.components?.schemas?.['ProblemDetails']).toBeDefined();
    const conflict = (document.paths['/v1/appointments'] as Record<string, Operation>)['post']!;
    expect(conflict.responses['409']?.content?.['application/problem+json']?.schema?.$ref).toBe(
      '#/components/schemas/ProblemDetails',
    );
  });

  it('POSTs idempotentes documentam o cabeçalho Idempotency-Key', () => {
    for (const path of ['/v1/appointments', '/v1/orders/{id}/close', '/v1/public/{slug}/bookings']) {
      const operation = (document.paths[path] as Record<string, Operation>)['post']!;
      expect(
        operation.parameters?.some((p) => p.in === 'header' && p.name === 'Idempotency-Key'),
        path,
      ).toBe(true);
    }
  });

  it('serve o Swagger UI e o JSON do contrato', async () => {
    const docsApp = await createTestApp();
    setupSwagger(docsApp);
    await docsApp.init();
    try {
      const page = await request(docsApp.getHttpServer()).get('/docs').expect(200);
      expect(page.text).toContain('<title>TaNaRegua API</title>');
      expect(page.text).toContain('swagger-ui');
      const json = await request(docsApp.getHttpServer()).get('/docs-json').expect(200);
      expect(json.body.info.title).toBe('TaNaRegua API');
    } finally {
      await docsApp.close();
    }
  });
});
