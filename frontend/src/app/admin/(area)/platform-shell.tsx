'use client';

import { useQueryClient } from '@tanstack/react-query';
import { LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { Brand } from '@/components/brand';
import { LoadingRows } from '@/components/states';
import { Button } from '@/components/ui/button';
import { refreshSession } from '@/lib/api/client';
import { platformLogout } from '@/lib/session/auth';
import { usePlatformSession } from '@/lib/session/use-session';

/** Reconstrói a sessão da plataforma pelo cookie httpOnly próprio dela. Só UX: a API revalida tudo. */
export function PlatformShell({ children }: { children: ReactNode }) {
  const session = usePlatformSession();
  const router = useRouter();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (session.status === 'loading') void refreshSession('platform');
    if (session.status === 'anonymous') router.replace('/admin/entrar');
  }, [session.status, router]);

  if (session.status !== 'authenticated') {
    return (
      <div className="mx-auto w-full max-w-3xl p-8">
        <LoadingRows rows={4} label="Carregando sua sessão" />
      </div>
    );
  }

  const handleLogout = async () => {
    await platformLogout();
    queryClient.removeQueries({ queryKey: ['platform'] });
    router.replace('/admin/entrar');
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="bg-sidebar text-sidebar-foreground">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-baseline gap-3">
            <Brand href="/admin" onDark />
            <span className="text-sidebar-foreground/70 text-sm">Administração da plataforma</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden truncate text-sm sm:inline">{session.profile.admin.name}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleLogout}
              className="hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              <LogOut aria-hidden /> Sair
            </Button>
          </div>
        </div>
      </header>
      <main id="conteudo" className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 lg:py-8">
        {children}
      </main>
    </div>
  );
}
