import type { Metadata } from 'next';
import { PackagesView } from './packages-view';

export const metadata: Metadata = { title: 'Pacotes' };

// Painel é bloqueado por sessão no cliente (PanelShell): fora da validação de navegação
// instantânea, como a doc recomenda para segmentos "gated by authentication".
export const instant = false;

export default function PackagesPage() {
  return <PackagesView />;
}
