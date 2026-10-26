import { HttpStatus } from '@nestjs/common';

/**
 * Erro de regra de negócio. O `code` vira o `type` do Problem Details,
 * permitindo ao frontend tratar casos específicos (ex.: conflito de horário).
 */
export class DomainError extends Error {
  constructor(
    readonly code: string,
    readonly title: string,
    message: string,
    readonly status: HttpStatus,
  ) {
    super(message);
  }
}

export const notFound = (resource: string) =>
  new DomainError('not-found', 'Not Found', `${resource} não encontrado.`, HttpStatus.NOT_FOUND);

export const conflict = (code: string, message: string) =>
  new DomainError(code, 'Conflict', message, HttpStatus.CONFLICT);

export const unprocessable = (code: string, message: string) =>
  new DomainError(code, 'Unprocessable Content', message, HttpStatus.UNPROCESSABLE_ENTITY);
