import type { Metadata } from 'next';
import { AgendaView } from './agenda-view';

export const metadata: Metadata = { title: 'Agenda' };

// Painel é bloqueado por sessão no cliente (PanelShell): fora da validação de navegação
// instantânea, como a doc recomenda para segmentos "gated by authentication".
export const instant = false;

export default function AgendaPage() {
  return <AgendaView />;
}
