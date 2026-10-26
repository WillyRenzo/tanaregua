import type { Metadata } from 'next';
import { SettingsView } from './settings-view';

export const metadata: Metadata = { title: 'Configurações' };

// Painel é bloqueado por sessão no cliente (PanelShell): fora da validação de navegação
// instantânea, como a doc recomenda para segmentos "gated by authentication".
export const instant = false;

export default function SettingsPage() {
  return <SettingsView />;
}
