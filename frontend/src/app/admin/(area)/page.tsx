import type { Metadata } from 'next';
import { PlansAdmin } from './plans-admin';

export const metadata: Metadata = { title: 'Planos e preços' };

// Bloqueada por sessão no cliente (PlatformShell), como as páginas do painel.
export const instant = false;

export default function PlatformHomePage() {
  return <PlansAdmin />;
}
