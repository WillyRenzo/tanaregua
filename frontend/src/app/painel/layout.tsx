import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoadingRows } from '@/components/states';
import { PanelShell } from './panel-shell';

export const metadata: Metadata = { title: 'Painel', robots: { index: false } };

export default function PanelLayout({ children }: LayoutProps<'/painel'>) {
  // O painel depende da sessão e da URL (dados de runtime): com Cache Components,
  // isso precisa de Suspense para não bloquear o pré-render.
  return (
    <Suspense
      fallback={
        <div className="mx-auto w-full max-w-3xl p-8">
          <LoadingRows rows={4} label="Carregando o painel" />
        </div>
      }
    >
      <PanelShell>{children}</PanelShell>
    </Suspense>
  );
}
