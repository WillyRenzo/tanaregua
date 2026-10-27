import type { Metadata } from 'next';
import { ProductsView } from './products-view';

export const metadata: Metadata = { title: 'Produtos' };

// Painel é bloqueado por sessão no cliente (PanelShell): fora da validação de navegação
// instantânea, como a doc recomenda para segmentos "gated by authentication".
export const instant = false;

export default function ProductsPage() {
  return <ProductsView />;
}
