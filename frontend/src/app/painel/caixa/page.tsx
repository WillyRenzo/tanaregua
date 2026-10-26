import type { Metadata } from 'next';
import { CashView } from './cash-view';

export const metadata: Metadata = { title: 'Caixa' };

// Painel é bloqueado por sessão no cliente (PanelShell): fora da validação de navegação
// instantânea, como a doc recomenda para segmentos "gated by authentication".
export const instant = false;

export default function CashPage() {
  return <CashView />;
}
