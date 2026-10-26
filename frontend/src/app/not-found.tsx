import Link from 'next/link';
import { Brand } from '@/components/brand';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4">
      <Brand />
      <h1 className="text-5xl font-bold">Página não encontrada</h1>
      <p className="text-muted-foreground">
        Confira o endereço. Se for a página de uma barbearia, peça o link para ela.
      </p>
      <Button asChild className="w-fit">
        <Link href="/">Ir para o início</Link>
      </Button>
    </main>
  );
}
