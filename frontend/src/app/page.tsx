import Link from 'next/link';
import { Brand } from '@/components/brand';
import { Button } from '@/components/ui/button';

const FEATURES = [
  [
    'Agenda integrada',
    'Cada profissional numa coluna. Conflito de horário é impossível — o sistema não deixa.',
  ],
  ['Agendamento online', 'Uma página só sua para o cliente marcar, a qualquer hora, sem ligar.'],
  ['Comanda e comissão', 'Fechou o atendimento, a comissão de cada um já está calculada.'],
  ['Caixa e relatórios', 'Faturamento do dia, por profissional e serviço, sem planilha.'],
] as const;

export default function Home() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-6">
        <Brand />
        <nav className="flex items-center gap-2">
          <Button asChild variant="ghost">
            <Link href="/entrar">Entrar</Link>
          </Button>
          <Button asChild>
            <Link href="/cadastro">Começar</Link>
          </Button>
        </nav>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4">
        <section className="border-foreground/80 border-b-4 py-16 sm:py-24">
          <p className="font-heading text-primary text-sm font-semibold tracking-[0.3em] uppercase">
            Para barbearias e salões
          </p>
          <h1 className="mt-4 max-w-3xl text-5xl leading-[0.95] font-bold sm:text-7xl">
            Tá na régua: agenda cheia, caixa conferido.
          </h1>
          <p className="text-muted-foreground mt-6 max-w-xl text-lg">
            Agenda, comandas, comissões e agendamento online num só lugar — por um preço que cabe no seu
            negócio.
          </p>
          <Button asChild size="lg" className="mt-8">
            <Link href="/cadastro">Cadastrar minha barbearia</Link>
          </Button>
        </section>

        <section className="grid gap-px py-16 sm:grid-cols-2" aria-label="Funcionalidades">
          {FEATURES.map(([title, text]) => (
            <article key={title} className="border-border border-t py-6 pr-8">
              <h2 className="text-2xl font-bold">{title}</h2>
              <p className="text-muted-foreground mt-2">{text}</p>
            </article>
          ))}
        </section>
      </main>
    </div>
  );
}
