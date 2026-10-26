import type { ClsStore } from 'nestjs-cls';
import type { Permission } from '../../modules/auth/permissions.js';

/** Identidade autenticada da requisição, extraída do access token. */
export interface AuthContext {
  userId: string;
  barbershopId: string;
  membershipId: string;
  permissions: readonly Permission[];
}

export interface RequestContext extends ClsStore {
  auth?: AuthContext;
}
