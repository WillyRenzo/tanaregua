import { HomeView } from './home-view';

// Painel é bloqueado por sessão no cliente (PanelShell): fora da validação de navegação
// instantânea, como a doc recomenda para segmentos "gated by authentication".
export const instant = false;

export default function PanelHomePage() {
  return <HomeView />;
}
