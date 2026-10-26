'use client';

import { useState } from 'react';
import { PeriodPicker, periodPresets } from '@/components/period-picker';
import { EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/states';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatMoney, todayIn } from '@/lib/format';
import { can } from '@/lib/permissions';
import { useBarbershop, useCommissions } from '@/lib/queries';
import { useAuthenticatedSession } from '@/lib/session/use-session';

export function CommissionsView() {
  const barbershop = useBarbershop();
  if (barbershop.isLoading) return <LoadingRows />;
  if (barbershop.error) return <ErrorState error={barbershop.error} onRetry={() => barbershop.refetch()} />;
  return <Commissions today={todayIn(barbershop.data!.timezone)} />;
}

function Commissions({ today }: { today: string }) {
  const session = useAuthenticatedSession();
  const ownOnly = !can(session, 'commissions:read:any');
  const [period, setPeriod] = useState(periodPresets(today)[2]!.period);
  const commissions = useCommissions(period.from, period.to);
  const total = commissions.data?.professionals.reduce((sum, row) => sum + row.totalCents, 0) ?? 0;

  return (
    <>
      <PageHeader
        title={ownOnly ? 'Minhas comissões' : 'Comissões'}
        description="Calculadas no fechamento de cada comanda; estornos já descontados."
      />
      <div className="mb-6">
        <PeriodPicker value={period} onChange={setPeriod} today={today} />
      </div>

      {commissions.isLoading ? (
        <LoadingRows />
      ) : commissions.error ? (
        <ErrorState error={commissions.error} onRetry={() => commissions.refetch()} />
      ) : commissions.data!.professionals.length === 0 ? (
        <EmptyState title="Sem comissões no período" />
      ) : ownOnly ? (
        <div className="bg-card border-border max-w-sm rounded-lg border p-6">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            A receber no período
          </p>
          <p className="font-heading mt-1 text-5xl font-bold">{formatMoney(total)}</p>
          <p className="text-muted-foreground mt-2 text-sm">
            {commissions.data!.professionals[0]!.entries} lançamento(s)
          </p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Profissional</TableHead>
              <TableHead className="text-right">Lançamentos</TableHead>
              <TableHead className="text-right">A pagar</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {commissions.data!.professionals.map((row) => (
              <TableRow key={row.professionalId}>
                <TableCell className="font-medium">{row.name}</TableCell>
                <TableCell className="text-right">{row.entries}</TableCell>
                <TableCell className="text-right font-semibold">{formatMoney(row.totalCents)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={2} className="font-heading text-lg uppercase">
                Total
              </TableCell>
              <TableCell className="text-right text-lg font-bold">{formatMoney(total)}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      )}
    </>
  );
}
