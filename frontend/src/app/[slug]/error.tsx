'use client';

import { AlertTriangle } from 'lucide-react';
import { Brand } from '@/components/brand';
import { Button } from '@/components/ui/button';

/**
 * Falha passageira ao carregar a barbearia (API fora do ar, limite de requisições).
 * Diferente de "não encontrada": a página existe, só não carregou agora.
 */
export default function BarbershopError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4">
      <Brand />
      <h1 className="flex items-center gap-3 text-4xl font-bold">
        <AlertTriangle aria-hidden className="text-destructive size-8 shrink-0" />
        Não deu para carregar a agenda
      </h1>
      <p className="text-muted-foreground">
        A página da barbearia está com instabilidade. Tente de novo em alguns instantes.
      </p>
      <Button className="w-fit" onClick={() => retry()}>
        Tentar de novo
      </Button>
    </main>
  );
}
