import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoadingRows } from '@/components/states';
import { PlatformShell } from './platform-shell';

export const metadata: Metadata = { title: 'Administração da plataforma', robots: { index: false } };

export default function PlatformLayout({ children }: LayoutProps<'/admin'>) {
  // Depende da sessão (dado de runtime): com Cache Components, precisa de Suspense.
  return (
    <Suspense
      fallback={
        <div className="mx-auto w-full max-w-3xl p-8">
          <LoadingRows rows={4} label="Carregando a administração" />
        </div>
      }
    >
      <PlatformShell>{children}</PlatformShell>
    </Suspense>
  );
}
