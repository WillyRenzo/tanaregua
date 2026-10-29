/**
 * Catálogo único de permissões. O código checa permissões, nunca nomes de papéis
 * (business-rules §8). Sufixos `:own`/`:any` indicam o escopo; o service aplica o filtro.
 */
export const PERMISSIONS = [
  'barbershop:manage',
  'subscription:manage',
  'roles:manage',
  'staff:read',
  'staff:manage',
  'clients:read',
  'clients:manage',
  'services:read',
  'services:manage',
  'products:read',
  'products:manage',
  'packages:read',
  'packages:manage',
  'campaigns:manage',
  'appointments:read:any',
  'appointments:read:own',
  'appointments:write:any',
  'appointments:write:own',
  'orders:read:any',
  'orders:manage',
  'orders:void',
  'cash:read',
  'commissions:read:any',
  'commissions:read:own',
  'reports:read',
  'bookings:self',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

/** Só agendar a si mesmo (cliente final) não dá acesso ao painel; qualquer outra permissão dá. */
export function canUsePanel(permissions: readonly string[]): boolean {
  return permissions.some((permission) => isPermission(permission) && permission !== 'bookings:self');
}

export interface DefaultRole {
  key: string;
  name: string;
  permissions: readonly Permission[];
}

/** Papéis criados automaticamente em toda barbearia nova. */
export const DEFAULT_ROLES = {
  owner: {
    key: 'owner',
    name: 'Dono',
    permissions: PERMISSIONS.filter((permission) => permission !== 'bookings:self'),
  },
  receptionist: {
    key: 'receptionist',
    name: 'Recepcionista',
    permissions: [
      'staff:read',
      'clients:read',
      'clients:manage',
      'services:read',
      'products:read',
      'products:manage',
      'packages:read',
      'packages:manage',
      'campaigns:manage',
      'appointments:read:any',
      'appointments:write:any',
      'orders:read:any',
      'orders:manage',
      'cash:read',
    ],
  },
  professional: {
    key: 'professional',
    name: 'Profissional',
    permissions: [
      'staff:read',
      'clients:read',
      'services:read',
      'products:read',
      'packages:read',
      'appointments:read:own',
      'appointments:write:own',
      'commissions:read:own',
    ],
  },
  client: {
    key: 'client',
    name: 'Cliente',
    permissions: ['bookings:self'],
  },
} as const satisfies Record<string, DefaultRole>;
