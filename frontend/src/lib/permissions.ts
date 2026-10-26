import type { SessionState } from '@/lib/session/session-store';

/**
 * Só para a UX (esconder o que a pessoa não pode usar). A API revalida tudo;
 * isto nunca é controle de acesso (regra do frontend).
 */
export function can(session: SessionState, ...permissions: string[]): boolean {
  if (session.status !== 'authenticated') return false;
  return permissions.some((permission) => session.profile.permissions.includes(permission));
}
