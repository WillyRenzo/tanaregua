import type { Audience } from '@/lib/queries';

export const MONTHS = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
] as const;

/** Filtro de público em texto, para a lista de campanhas e a confirmação. */
export function describeAudience(audience: Audience, services: { id: string; name: string }[]): string {
  switch (audience.kind) {
    case 'all':
      return 'Todos os clientes';
    case 'inactive':
      return `Sem visita há ${audience.days} dias ou mais`;
    case 'birthday-month':
      return `Aniversariantes de ${MONTHS[audience.month - 1]}`;
    case 'service': {
      const service = services.find((item) => item.id === audience.serviceId);
      return `Fizeram ${service?.name ?? 'um serviço'} nos últimos ${audience.days} dias`;
    }
  }
}
