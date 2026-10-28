'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { addDays, formatDateLong, formatMoney, formatTime, todayIn } from '@/lib/format';
import { PAYMENT_METHODS, paymentLabel } from '@/lib/payment-methods';
import { useBarbershop, useCashDay } from '@/lib/queries';
import { cn } from '@/lib/utils';

export function CashView() {
  const barbershop = useBarbershop();
  if (barbershop.isLoading) return <LoadingRows />;
  if (barbershop.error) return <ErrorState error={barbershop.error} onRetry={() => barbershop.refetch()} />;
  return <CashDay timezone={barbershop.data!.timezone} />;
}

function CashDay({ timezone }: { timezone: string }) {
  const today = todayIn(timezone);
  const [date, setDate] = useState(today);
  const cash = useCashDay(date);

  return (
    <>
      <PageHeader
        title="Caixa do dia"
        description={formatDateLong(date, timezone)}
        actions={
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              aria-label="Dia anterior"
              onClick={() => setDate(addDays(date, -1))}
            >
              <ChevronLeft />
            </Button>
            <Button variant="outline" onClick={() => setDate(today)} disabled={date === today}>
              Hoje
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label="Próximo dia"
              disabled={date === today}
              onClick={() => setDate(addDays(date, 1))}
            >
              <ChevronRight />
            </Button>
          </div>
        }
      />

      {cash.isLoading ? (
        <LoadingRows />
      ) : cash.error ? (
        <ErrorState error={cash.error} onRetry={() => cash.refetch()} />
      ) : (
        <>
          <dl className="mb-8 grid grid-cols-2 gap-px overflow-hidden rounded-lg border sm:grid-cols-3 lg:grid-cols-6">
            <div className="bg-sidebar text-sidebar-foreground col-span-2 p-4 sm:col-span-1 lg:col-span-1">
              <dt className="text-sidebar-foreground/70 text-xs font-medium tracking-wide uppercase">
                Total líquido
              </dt>
              <dd className="font-heading mt-1 text-3xl font-bold">{formatMoney(cash.data!.netCents)}</dd>
            </div>
            {PAYMENT_METHODS.map((method) => (
              <div key={method.value} className="bg-card p-4">
                <dt className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium tracking-wide uppercase">
                  <method.icon aria-hidden className="size-3.5" /> {method.label}
                </dt>
                <dd className="mt-1 text-xl font-semibold">{formatMoney(cash.data!.totals[method.value])}</dd>
              </div>
            ))}
          </dl>

          {cash.data!.entries.length === 0 ? (
            <EmptyState title="Sem movimento">Nenhuma comanda fechada neste dia.</EmptyState>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Hora</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Forma</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cash.data!.entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>{formatTime(entry.occurredAt, timezone)}</TableCell>
                    <TableCell>
                      <Link
                        href={`/painel/comandas/${entry.orderId}`}
                        className="underline-offset-4 hover:underline"
                      >
                        {entry.clientName ?? 'Cliente balcão'}
                      </Link>
                      {entry.kind === 'REVERSAL' && (
                        <span className="text-destructive ml-2 text-xs font-medium">Estorno</span>
                      )}
                      {entry.kind === 'REFUND' && (
                        <span className="text-destructive ml-2 text-xs font-medium">Reembolso de pacote</span>
                      )}
                    </TableCell>
                    <TableCell>{paymentLabel(entry.method)}</TableCell>
                    <TableCell
                      className={cn('text-right font-medium', entry.amountCents < 0 && 'text-destructive')}
                    >
                      {formatMoney(entry.amountCents)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </>
      )}
    </>
  );
}
