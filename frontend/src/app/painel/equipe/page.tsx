import type { Metadata } from 'next';
import { StaffView } from './staff-view';

export const metadata: Metadata = { title: 'Equipe' };

// Painel é bloqueado por sessão no cliente (PanelShell): fora da validação de navegação
// instantânea, como a doc recomenda para segmentos "gated by authentication".
export const instant = false;

export default function StaffPage() {
  return <StaffView />;
}
