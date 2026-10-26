import { NextResponse, type NextRequest } from 'next/server';

const REFRESH_COOKIE = 'tnr_refresh';

/**
 * Só UX (regra do frontend): quem não tem cookie de sessão vai direto para o login,
 * sem piscar a tela do painel. NÃO é controle de acesso — a API revalida tudo.
 */
export function proxy(request: NextRequest) {
  if (!request.cookies.has(REFRESH_COOKIE)) {
    const login = new URL('/entrar', request.url);
    login.searchParams.set('next', request.nextUrl.pathname);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/painel/:path*'],
};
