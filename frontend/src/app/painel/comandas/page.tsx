import type { Metadata } from 'next';
import { OrdersView } from './orders-view';

export const metadata: Metadata = { title: 'Comandas' };

// Painel é bloqueado por sessão no cliente (PanelShell): fora da validação de navegação
// instantânea, como a doc recomenda para segmentos "gated by authentication".
export const instant = false;

export default function OrdersPage() {
  return <OrdersView />;
}
