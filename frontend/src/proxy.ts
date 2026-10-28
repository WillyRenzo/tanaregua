import { NextResponse, type NextRequest } from 'next/server';

const PANEL_REFRESH_COOKIE = 'tnr_refresh';
const PLATFORM_REFRESH_COOKIE = 'tnr_platform_refresh';

/**
 * Só UX (regra do frontend): quem não tem cookie de sessão vai direto para o login,
 * sem piscar a tela protegida. NÃO é controle de acesso — a API revalida tudo.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith('/admin')) {
    if (pathname === '/admin/entrar' || request.cookies.has(PLATFORM_REFRESH_COOKIE)) {
      return NextResponse.next();
    }
    return NextResponse.redirect(new URL('/admin/entrar', request.url));
  }

  if (!request.cookies.has(PANEL_REFRESH_COOKIE)) {
    const login = new URL('/entrar', request.url);
    login.searchParams.set('next', pathname);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/painel/:path*', '/admin/:path*'],
};
