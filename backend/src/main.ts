import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module.js';
import { configureApp, setupSwagger } from './app.setup.js';
import type { Env } from './config/env.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  configureApp(app);

  const config = app.get<ConfigService<Env, true>>(ConfigService);
  // Swagger UI (/docs) é ferramenta de desenvolvimento e teste: nunca em produção.
  if (config.get('NODE_ENV') !== 'production') {
    setupSwagger(app);
  }

  await app.listen(config.get('PORT'), '0.0.0.0');
}
await bootstrap();
