import type { Metadata } from 'next';
import { CampaignsView } from './campaigns-view';

export const metadata: Metadata = { title: 'Campanhas' };

// Painel é bloqueado por sessão no cliente (PanelShell): fora da validação de navegação
// instantânea, como a doc recomenda para segmentos "gated by authentication".
export const instant = false;

export default function CampaignsPage() {
  return <CampaignsView />;
}
