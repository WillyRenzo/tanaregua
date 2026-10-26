import type { Metadata, Viewport } from 'next';
import { Barlow_Condensed, IBM_Plex_Sans } from 'next/font/google';
import { Providers } from './providers';
import './globals.css';

const heading = Barlow_Condensed({
  variable: '--font-barlow',
  subsets: ['latin'],
  weight: ['500', '600', '700'],
});

const body = IBM_Plex_Sans({
  variable: '--font-plex',
  subsets: ['latin'],
  weight: ['400', '500', '600'],
});

export const metadata: Metadata = {
  title: { default: 'TaNaRegua', template: '%s · TaNaRegua' },
  description: 'Gestão completa para barbearias: agenda, comandas, comissões e agendamento online.',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f7f3ec' },
    { media: '(prefers-color-scheme: dark)', color: '#1c1714' },
  ],
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="pt-BR" className={`${heading.variable} ${body.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
