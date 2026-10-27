import createClient, { type Middleware } from 'openapi-fetch';
import { sessionStores, type SessionAudience, type SessionResponse } from '@/lib/session/session-store';
import { ApiError, isProblem } from './errors';
import type { paths } from './schema';

/**
 * Cliente único da API (regra do frontend: nada de fetch solto). Tipado a partir do
 * contrato OpenAPI do backend (`npm run api:generate`). O browser fala com `/api`,
 * que o Next reescreve para o NestJS no mesmo domínio.
 */
export const api = createClient<paths>({ baseUrl: '/api' });

const AUTH_PATHS = [
  '/v1/auth/login',
  '/v1/auth/refresh',
  '/v1/auth/register-barbershop',
  '/v1/auth/client/refresh',
  '/v1/public/{slug}/auth/login',
  '/v1/public/{slug}/auth/register',
];

const REFRESH_URLS: Record<SessionAudience, string> = {
  panel: '/api/v1/auth/refresh',
  client: '/api/v1/auth/client/refresh',
};

const refreshing: Record<SessionAudience, Promise<boolean> | null> = { panel: null, client: null };

/** Rotas do agendamento online usam a sessão do cliente; o resto, a do painel. */
const audienceOf = (schemaPath: string): SessionAudience =>
  schemaPath.startsWith('/v1/public/') ? 'client' : 'panel';

/**
 * Renova a sessão pelo cookie httpOnly. Uma única renovação por vez por sessão
 * (várias abas/queries); painel e cliente têm cookies e estados independentes.
 */
export function refreshSession(audience: SessionAudience = 'panel'): Promise<boolean> {
  const store = sessionStores[audience];
  refreshing[audience] ??= (async () => {
    try {
      const response = await fetch(REFRESH_URLS[audience], { method: 'POST', credentials: 'same-origin' });
      if (!response.ok) {
        store.set({ status: 'anonymous' });
        return false;
      }
      store.fromResponse((await response.json()) as SessionResponse);
      return true;
    } catch {
      store.set({ status: 'anonymous' });
      return false;
    } finally {
      refreshing[audience] = null;
    }
  })();
  return refreshing[audience];
}

const pendingRetries = new Map<string, Request>();

const authMiddleware: Middleware = {
  onRequest({ request, id, schemaPath }) {
    const token = sessionStores[audienceOf(schemaPath)].accessToken();
    if (token) request.headers.set('Authorization', `Bearer ${token}`);
    // Guarda uma cópia: o corpo de uma Request só pode ser lido uma vez.
    pendingRetries.set(id, request.clone());
    return request;
  },
  async onResponse({ response, id, schemaPath }) {
    const retry = pendingRetries.get(id);
    pendingRetries.delete(id);
    if (response.status !== 401 || !retry || AUTH_PATHS.includes(schemaPath)) return response;

    // Access token expirou (15 min): renova uma vez e repete a requisição original.
    const audience = audienceOf(schemaPath);
    if (!(await refreshSession(audience))) return response;
    retry.headers.set('Authorization', `Bearer ${sessionStores[audience].accessToken()}`);
    return fetch(retry);
  },
  onError({ id }) {
    pendingRetries.delete(id);
  },
};

api.use(authMiddleware);

/**
 * Desembrulha a resposta do openapi-fetch: devolve `data` ou lança ApiError com o
 * Problem Details da API (para React Query e formulários tratarem de forma uniforme).
 */
export async function unwrap<T>(
  call: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
  const { data, error, response } = await call;
  if (error !== undefined || !response.ok) {
    throw new ApiError(
      isProblem(error) ? error : { type: 'about:blank', title: response.statusText, status: response.status },
    );
  }
  return data as T;
}

/**
 * Chave de idempotência para POSTs sensíveis (duplo clique não agenda duas vezes).
 * `crypto.randomUUID` só existe em contexto seguro (HTTPS/localhost); acessando por
 * HTTP na rede local (ex.: testando no celular) caímos no getRandomValues, que existe
 * sempre, montando um UUID v4.
 */
export function idempotencyKey(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
