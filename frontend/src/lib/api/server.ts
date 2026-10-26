import 'server-only';
import createClient from 'openapi-fetch';
import { cacheLife, cacheTag } from 'next/cache';
import type { components, paths } from './schema';

/** Cliente da API para Server Components: fala direto com o NestJS pela rede interna. */
const serverApi = createClient<paths>({ baseUrl: process.env.API_INTERNAL_URL ?? 'http://localhost:3333' });

export interface PublicBarbershopPage {
  barbershop: components['schemas']['PublicBarbershop'];
  services: components['schemas']['Service'][];
  professionals: components['schemas']['PublicProfessional'][];
}

/**
 * Dados públicos da página de agendamento. Cache de minutos: serviços e equipe mudam
 * pouco, e a disponibilidade (que muda o tempo todo) é buscada no cliente, sem cache.
 */
export async function getPublicBarbershop(slug: string): Promise<PublicBarbershopPage | null> {
  'use cache';
  cacheLife('minutes');
  cacheTag(`barbershop:${slug}`);

  const path = { params: { path: { slug } } };
  const [info, services, professionals] = await Promise.all([
    serverApi.GET('/v1/public/{slug}', path),
    serverApi.GET('/v1/public/{slug}/services', path),
    serverApi.GET('/v1/public/{slug}/professionals', path),
  ]);
  if (info.response.status === 404 || !info.data) return null;
  return { barbershop: info.data, services: services.data ?? [], professionals: professionals.data ?? [] };
}
