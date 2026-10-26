// Exporta o contrato OpenAPI sem subir o servidor: `npm run openapi:export`.
// O frontend gera o cliente tipado a partir do arquivo exportado (contracts/openapi.json).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { buildOpenApiDocument, configureApp } from './app.setup.js';

const output = process.argv[2] ?? 'contracts/openapi.json';

const app = await NestFactory.create(AppModule, { logger: ['error'] });
configureApp(app);
const document = buildOpenApiDocument(app);
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(document, null, 2)}\n`);
await app.close();
console.log(`OpenAPI exportado para ${output}`);
