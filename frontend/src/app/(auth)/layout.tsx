import { Brand } from '@/components/brand';

/** Tela dividida: painel de marca escuro com faixas de barbearia + formulário. */
export default function AuthLayout({ children }: LayoutProps<'/'>) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_1.1fr]">
      <aside className="bg-sidebar text-sidebar-foreground relative hidden overflow-hidden p-12 lg:flex lg:flex-col lg:justify-between">
        <Brand onDark />
        <div className="relative z-10 max-w-md">
          <p className="font-heading text-sidebar-primary text-sm font-semibold tracking-[0.3em] uppercase">
            Agenda · Comanda · Comissão
          </p>
          <p className="font-heading mt-4 text-5xl leading-[0.95] font-bold tracking-wide uppercase">
            A barbearia inteira, no corte certo.
          </p>
        </div>
        {/* Faixas diagonais como num poste de barbearia, em cobre discreto. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -bottom-24 h-96 w-96 rotate-12 opacity-20"
          style={{
            backgroundImage:
              'repeating-linear-gradient(135deg, var(--sidebar-primary) 0 14px, transparent 14px 34px)',
          }}
        />
      </aside>
      <main className="flex flex-col justify-center px-4 py-10 sm:px-10">
        <Brand className="mb-10 lg:hidden" />
        <div className="mx-auto w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}
