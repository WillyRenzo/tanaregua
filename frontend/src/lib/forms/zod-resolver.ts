import type { FieldErrors, FieldValues, Resolver } from 'react-hook-form';
import type { z } from 'zod';

/**
 * Resolver Zod para react-hook-form. Escrito aqui (15 linhas) em vez de instalar
 * @hookform/resolvers, que traz dezenas de peers opcionais (supply chain).
 */
export function zodResolver<TSchema extends z.ZodType<FieldValues, FieldValues>>(
  schema: TSchema,
): Resolver<z.input<TSchema>, unknown, z.output<TSchema>> {
  return async (values) => {
    const result = await schema.safeParseAsync(values);
    if (result.success) return { values: result.data, errors: {} };

    const errors: Record<string, { type: string; message: string }> = {};
    for (const issue of result.error.issues) {
      const path = issue.path.join('.');
      errors[path] ??= { type: issue.code, message: issue.message };
    }
    return { values: {}, errors: errors as FieldErrors<z.input<TSchema>> };
  };
}
