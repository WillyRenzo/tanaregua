import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';

/** Cabeçalho com que o servidor do Next se identifica nas chamadas SSR. */
export const INTERNAL_TOKEN_HEADER = 'x-internal-token';

/**
 * Chamada feita pelo servidor do Next (SSR), não por um visitante. Serve só para tirar essas
 * chamadas do rate limit por IP: todas saem do mesmo IP e esgotariam o limite de todos.
 * Comparação em tempo constante (sobre o hash, para não depender do tamanho).
 */
export function isInternalRequest(headers: IncomingHttpHeaders, token: string | undefined): boolean {
  const received = headers[INTERNAL_TOKEN_HEADER];
  if (!token || typeof received !== 'string') return false;
  return timingSafeEqual(digest(received), digest(token));
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}
