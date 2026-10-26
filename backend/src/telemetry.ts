// Carregado ANTES da aplicação: `node --import ./dist/telemetry.js dist/main.js`.
// Em ESM, a instrumentação automática precisa do hook de loader registrado antes
// de qualquer import de express/pg; por isso não pode ser importado de main.ts.
import { register } from 'node:module';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { PrismaInstrumentation } from '@prisma/instrumentation';

if (process.env['OTEL_ENABLED'] === 'true') {
  register('@opentelemetry/instrumentation/hook.mjs', import.meta.url);

  // Exportador OTLP configurado pelas variáveis padrão (OTEL_EXPORTER_OTLP_ENDPOINT etc).
  const sdk = new NodeSDK({
    serviceName: 'tanaregua-api',
    instrumentations: [
      getNodeAutoInstrumentations({ '@opentelemetry/instrumentation-fs': { enabled: false } }),
      new PrismaInstrumentation(),
    ],
  });
  sdk.start();

  process.once('SIGTERM', () => void sdk.shutdown());
}
