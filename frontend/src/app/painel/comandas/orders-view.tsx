'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { ClientPicker, type PickedClient } from '@/components/client-picker';
import { EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { errorMessage } from '@/lib/api/errors';
import { formatDateTime, formatMoney } from '@/lib/format';
import { paymentLabel } from '@/lib/payment-methods';
import { can } from '@/lib/permissions';
import { useBarbershop, useOpenOrder, useOrders } from '@/lib/queries';
import { useAuthenticatedSession } from '@/lib/session/use-session';

type Status = 'OPEN' | 'CLOSED' | 'VOIDED';

export function OrdersView() {
  const session = useAuthenticatedSession();
  const [status, setStatus] = useState<Status>('OPEN');
  const [creating, setCreating] = useState(false);
  const barbershop = useBarbershop();
  const timezone = barbershop.data?.timezone ?? 'America/Sao_Paulo';

  return (
    <>
      <PageHeader
        title="Comandas"
        description="Abra pela agenda ou crie uma avulsa para quem chegou sem horário."
        actions={
          can(session, 'orders:manage') && (
            <Button onClick={() => setCreating(true)}>
              <Plus aria-hidden /> Comanda avulsa
            </Button>
          )
        }
      />

      <Tabs value={status} onValueChange={(value) => setStatus(value as Status)}>
        <TabsList>
          <TabsTrigger value="OPEN">Abertas</TabsTrigger>
          <TabsTrigger value="CLOSED">Fechadas</TabsTrigger>
          <TabsTrigger value="VOIDED">Estornadas</TabsTrigger>
        </TabsList>
        {(['OPEN', 'CLOSED', 'VOIDED'] as const).map((value) => (
          <TabsContent key={value} value={value} className="pt-4">
            <OrdersList status={value} timezone={timezone} />
          </TabsContent>
        ))}
      </Tabs>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>{creating && <NewWalkInOrder />}</DialogContent>
      </Dialog>
    </>
  );
}

/** Lista de uma aba (só a aba ativa fica montada, então só ela busca dados). */
function OrdersList({ status, timezone }: { status: Status; timezone: string }) {
  const orders = useOrders(status);
  const rows = orders.data?.pages.flatMap((page) => page.items) ?? [];

  return orders.isLoading ? (
    <LoadingRows />
  ) : orders.error ? (
    <ErrorState error={orders.error} onRetry={() => orders.refetch()} />
  ) : rows.length === 0 ? (
    <EmptyState title={status === 'OPEN' ? 'Nenhuma comanda aberta' : 'Nada por aqui'} />
  ) : (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Cliente</TableHead>
            <TableHead className="hidden sm:table-cell">Serviços</TableHead>
            <TableHead className="hidden sm:table-cell">
              {status === 'OPEN' ? 'Aberta em' : 'Pagamento'}
            </TableHead>
            <TableHead className="text-right">Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((order) => (
            <TableRow key={order.id}>
              <TableCell>
                <Link
                  href={`/painel/comandas/${order.id}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {order.client?.name ?? 'Cliente balcão'}
                </Link>
              </TableCell>
              <TableCell className="text-muted-foreground hidden max-w-xs truncate sm:table-cell">
                {order.items.map((item) => item.name).join(', ') || '—'}
              </TableCell>
              <TableCell className="hidden sm:table-cell">
                {status === 'OPEN'
                  ? formatDateTime(order.createdAt, timezone)
                  : `${paymentLabel(order.paymentMethod)} · ${order.closedAt ? formatDateTime(order.closedAt, timezone) : ''}`}
              </TableCell>
              <TableCell className="text-right font-medium">{formatMoney(order.totalCents)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {orders.hasNextPage && (
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => orders.fetchNextPage()}
          disabled={orders.isFetchingNextPage}
        >
          Carregar mais
        </Button>
      )}
    </>
  );
}

function NewWalkInOrder() {
  const router = useRouter();
  const open = useOpenOrder();
  const [client, setClient] = useState<PickedClient | null>(null);

  const submit = async () => {
    try {
      const order = await open.mutateAsync({ clientId: client?.id, items: [] });
      router.push(`/painel/comandas/${order.id}`);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <div className="grid gap-4">
      <DialogHeader>
        <DialogTitle className="font-heading text-2xl uppercase">Comanda avulsa</DialogTitle>
        <DialogDescription>O cliente é opcional (cliente balcão).</DialogDescription>
      </DialogHeader>
      <ClientPicker value={client} onChange={setClient} />
      <Button onClick={submit} disabled={open.isPending}>
        Abrir comanda
      </Button>
    </div>
  );
}
