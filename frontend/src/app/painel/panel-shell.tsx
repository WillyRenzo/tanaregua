'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { LogOut, Menu } from 'lucide-react';
import { Brand } from '@/components/brand';
import { LoadingRows } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { refreshSession } from '@/lib/api/client';
import { can } from '@/lib/permissions';
import { logout } from '@/lib/session/auth';
import type { SessionState } from '@/lib/session/session-store';
import { useSession } from '@/lib/session/use-session';
import { cn } from '@/lib/utils';
import { NAV_ITEMS } from './navigation';

/** Reconstrói a sessão pelo cookie httpOnly e protege a UX do painel. */
export function PanelShell({ children }: { children: ReactNode }) {
  const session = useSession();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (session.status === 'loading') void refreshSession();
  }, [session.status]);

  useEffect(() => {
    if (session.status === 'anonymous') {
      router.replace(`/entrar?next=${encodeURIComponent(pathname)}`);
    }
    // Cliente final não usa o painel: vai para a página da barbearia.
    if (
      session.status === 'authenticated' &&
      can(session, 'bookings:self') &&
      session.profile.permissions.length === 1
    ) {
      router.replace(`/${session.profile.barbershop.slug}`);
    }
  }, [session, router, pathname]);

  if (session.status !== 'authenticated') {
    return (
      <div className="mx-auto w-full max-w-3xl p-8">
        <LoadingRows rows={4} label="Carregando sua sessão" />
      </div>
    );
  }

  return (
    <div className="lg:grid lg:min-h-dvh lg:grid-cols-[15rem_1fr]">
      <aside className="bg-sidebar text-sidebar-foreground hidden flex-col lg:flex">
        <SidebarContent session={session} pathname={pathname} />
      </aside>

      <div className="flex min-w-0 flex-col">
        <MobileBar session={session} pathname={pathname} />
        <main id="conteudo" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}

function SidebarContent({
  session,
  pathname,
  onNavigate,
}: {
  session: Extract<SessionState, { status: 'authenticated' }>;
  pathname: string;
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const items = NAV_ITEMS.filter(
    (item) => item.permissions.length === 0 || can(session, ...item.permissions),
  );

  const handleLogout = async () => {
    await logout();
    router.replace('/entrar');
  };

  return (
    <div className="flex h-full flex-col gap-6 p-5">
      <Brand href="/painel" onDark />
      <p className="text-sidebar-foreground/70 -mt-3 truncate text-xs">{session.profile.barbershop.name}</p>

      <nav aria-label="Painel" className="flex-1">
        <ul className="grid gap-0.5">
          {items.map((item) => {
            const active = item.href === '/painel' ? pathname === '/painel' : pathname.startsWith(item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                    'hover:bg-sidebar-accent focus-visible:ring-sidebar-ring focus-visible:ring-2 focus-visible:outline-none',
                    active && 'bg-sidebar-accent text-sidebar-accent-foreground font-medium',
                  )}
                >
                  <item.icon aria-hidden className={cn('size-4', active && 'text-sidebar-primary')} />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-sidebar-border border-t pt-4">
        <p className="truncate text-sm font-medium">{session.profile.user.name}</p>
        <p className="text-sidebar-foreground/70 text-xs">{session.profile.membership.role.name}</p>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleLogout}
          className="hover:bg-sidebar-accent hover:text-sidebar-accent-foreground mt-3 -ml-2"
        >
          <LogOut aria-hidden /> Sair
        </Button>
      </div>
    </div>
  );
}

function MobileBar({
  session,
  pathname,
}: {
  session: Extract<SessionState, { status: 'authenticated' }>;
  pathname: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <header className="bg-sidebar text-sidebar-foreground flex items-center justify-between px-4 py-3 lg:hidden">
      <Brand href="/painel" onDark />
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Abrir menu" className="hover:bg-sidebar-accent">
            <Menu />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="bg-sidebar text-sidebar-foreground w-72 p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>Menu</SheetTitle>
          </SheetHeader>
          <SidebarContent session={session} pathname={pathname} onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
    </header>
  );
}
