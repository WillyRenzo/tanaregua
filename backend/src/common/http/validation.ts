import { BadRequestException, StandardSchemaValidationPipe } from '@nestjs/common';

/**
 * Pipe global: valida todo parâmetro que declara `schema` (Zod) no decorator,
 * ex.: `@Body({ schema: createClientSchema })`. Schemas de entrada usam
 * `z.strictObject`, então campos extras (como `barbershopId`) são rejeitados.
 */
export function createValidationPipe(): StandardSchemaValidationPipe {
  return new StandardSchemaValidationPipe({
    exceptionFactory: (issues) =>
      new BadRequestException(
        issues.map((issue) => {
          const path = issue.path
            ?.map((segment) => (typeof segment === 'object' ? segment.key : segment))
            .join('.');
          return path ? `${path}: ${issue.message}` : issue.message;
        }),
      ),
  });
}
