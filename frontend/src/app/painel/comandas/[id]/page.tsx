import type { Metadata } from 'next';
import { Suspense } from 'react';
import { OrderDetail } from './order-detail';

export const metadata: Metadata = { title: 'Comanda' };

// Painel é bloqueado por sessão no cliente (PanelShell): fora da validação de navegação
// instantânea, como a doc recomenda para segmentos "gated by authentication".
export const instant = false;

export default function OrderPage() {
  // O id vem de useParams no cliente; Suspense porque é dado dinâmico (Cache Components).
  return (
    <Suspense>
      <OrderDetail />
    </Suspense>
  );
}
