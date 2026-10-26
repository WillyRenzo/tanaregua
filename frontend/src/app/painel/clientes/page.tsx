import type { Metadata } from 'next';
import { ClientsView } from './clients-view';

export const metadata: Metadata = { title: 'Clientes' };

// Painel é bloqueado por sessão no cliente (PanelShell): fora da validação de navegação
// instantânea, como a doc recomenda para segmentos "gated by authentication".
export const instant = false;

export default function ClientsPage() {
  return <ClientsView />;
}
