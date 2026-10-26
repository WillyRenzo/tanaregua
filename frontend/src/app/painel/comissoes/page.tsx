import type { Metadata } from 'next';
import { CommissionsView } from './commissions-view';

export const metadata: Metadata = { title: 'Comissões' };

// Painel é bloqueado por sessão no cliente (PanelShell): fora da validação de navegação
// instantânea, como a doc recomenda para segmentos "gated by authentication".
export const instant = false;

export default function CommissionsPage() {
  return <CommissionsView />;
}
