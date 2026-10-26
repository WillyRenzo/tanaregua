import type { Metadata } from 'next';
import { ServicesView } from './services-view';

export const metadata: Metadata = { title: 'Serviços' };

// Painel é bloqueado por sessão no cliente (PanelShell): fora da validação de navegação
// instantânea, como a doc recomenda para segmentos "gated by authentication".
export const instant = false;

export default function ServicesPage() {
  return <ServicesView />;
}
