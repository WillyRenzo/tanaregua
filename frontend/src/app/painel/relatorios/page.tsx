import type { Metadata } from 'next';
import { ReportsView } from './reports-view';

export const metadata: Metadata = { title: 'Relatórios' };

// Painel é bloqueado por sessão no cliente (PanelShell): fora da validação de navegação
// instantânea, como a doc recomenda para segmentos "gated by authentication".
export const instant = false;

export default function ReportsPage() {
  return <ReportsView />;
}
