import { conflict, DomainError, notFound, unprocessable } from './domain-error.js';

// Com driver adapter (Prisma 7 + @prisma/adapter-pg) o SQLSTATE original do Postgres
// chega em `meta.driverAdapterError.cause.originalCode`.
const EXCLUSION_VIOLATION = '23P01';
const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';

interface PrismaLikeError {
  code?: unknown;
  meta?: {
    driverAdapterError?: {
      cause?: { originalCode?: unknown; originalMessage?: unknown; constraint?: unknown };
    };
  };
}

export function postgresErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const code = (error as PrismaLikeError).meta?.driverAdapterError?.cause?.originalCode;
  return typeof code === 'string' ? code : undefined;
}

function postgresMessage(error: unknown): string | undefined {
  const message = (error as PrismaLikeError).meta?.driverAdapterError?.cause?.originalMessage;
  return typeof message === 'string' ? message : undefined;
}

/**
 * Traduz erros de banco em erros de domínio. Retorna undefined quando o erro
 * não é reconhecido (vira 500 no filtro).
 */
export function mapDatabaseError(error: unknown): DomainError | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const prismaCode = (error as PrismaLikeError).code;
  const pgCode = postgresErrorCode(error);

  if (pgCode === EXCLUSION_VIOLATION) {
    return conflict('appointment-conflict', 'O profissional já tem um atendimento nesse horário.');
  }
  if (prismaCode === 'P2002' || pgCode === UNIQUE_VIOLATION) {
    return conflict('already-exists', 'Já existe um registro com esses dados.');
  }
  // Saldo negativo barrado pelo banco (business-rules §7): normalmente a checagem prévia,
  // com o produto travado, já responde antes; isto cobre o que escapar dela.
  if (pgCode === CHECK_VIOLATION && postgresMessage(error)?.includes('products_stock_quantity_check')) {
    return unprocessable('insufficient-stock', 'Estoque insuficiente para concluir a operação.');
  }
  if (prismaCode === 'P2025') {
    return notFound('Registro');
  }
  return undefined;
}
