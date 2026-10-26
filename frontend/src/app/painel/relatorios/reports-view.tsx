'use client';

import { useState } from 'react';
import { StatusBadge } from '@/components/appointment-status';
import { BarList, ColumnChart } from '@/components/charts';
import { PeriodPicker, periodPresets } from '@/components/period-picker';
import { EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/states';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { addDays, formatMoney, todayIn } from '@/lib/format';
import { useBarbershop, useReportSummary, type Appointment } from '@/lib/queries';

const compactMoney = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  notation: 'compact',
  maximumFractionDigits: 1,
});

export function ReportsView() {
  const barbershop = useBarbershop();
  if (barbershop.isLoading) return <LoadingRows />;
  if (barbershop.error) return <ErrorState error={barbershop.error} onRetry={() => barbershop.refetch()} />;
  return <Reports today={todayIn(barbershop.data!.timezone)} />;
}

/** Todos os dias do período, com zero onde não houve movimento (série sem buracos). */
function fillDays(from: string, to: string, byDay: { day: string; netCents: number }[]) {
  const values = new Map(byDay.map((row) => [row.day, row.netCents]));
  const days: { key: string; label: string; value: number }[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    days.push({ key: day, label: `${day.slice(8, 10)}/${day.slice(5, 7)}`, value: values.get(day) ?? 0 });
  }
  return days;
}

function Reports({ today }: { today: string }) {
  const [period, setPeriod] = useState(periodPresets(today)[2]!.period);
  const report = useReportSummary(period.from, period.to);
  const data = report.data;
  const completed = data?.appointments.byStatus.COMPLETED ?? 0;

  return (
    <>
      <PageHeader
        title="Relatórios"
        description="Faturamento a partir de comandas fechadas (estornos já descontados)."
      />
      <div className="mb-8">
        <PeriodPicker value={period} onChange={setPeriod} today={today} />
      </div>

      {report.isLoading ? (
        <LoadingRows rows={6} />
      ) : report.error ? (
        <ErrorState error={report.error} onRetry={() => report.refetch()} />
      ) : (
        <div className="grid gap-10">
          {/* Hero figure + stat tiles */}
          <section aria-label="Resumo" className="grid gap-6 sm:grid-cols-[2fr_1fr_1fr]">
            <div>
              <p className="text-muted-foreground text-sm">Faturamento líquido</p>
              <p className="text-5xl font-semibold sm:text-6xl">{formatMoney(data!.revenue.netCents)}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-sm">Ticket médio</p>
              <p className="text-2xl font-semibold">
                {completed > 0 ? formatMoney(Math.round(data!.revenue.netCents / completed)) : '—'}
              </p>
              <p className="text-muted-foreground text-xs">{completed} atendimento(s) concluído(s)</p>
            </div>
            <div>
              <p className="text-muted-foreground text-sm">Taxa de não comparecimento</p>
              <p className="text-2xl font-semibold">
                {(data!.appointments.noShowRate * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%
              </p>
              <p className="text-muted-foreground text-xs">sobre concluídos + faltas</p>
            </div>
          </section>

          <section aria-labelledby="revenue-title">
            <h2 id="revenue-title" className="mb-3 text-xl font-bold">
              Receita por dia
            </h2>
            <ColumnChart
              label="Receita líquida por dia"
              data={fillDays(period.from, period.to, data!.revenue.byDay)}
              formatValue={formatMoney}
              formatTick={(cents) => compactMoney.format(cents / 100)}
            />
          </section>

          <div className="grid gap-10 lg:grid-cols-2">
            <section aria-labelledby="pros-title">
              <h2 id="pros-title" className="mb-3 text-xl font-bold">
                Faturamento por profissional
              </h2>
              {data!.professionals.length === 0 ? (
                <EmptyState title="Sem atendimentos fechados" />
              ) : (
                <BarList
                  label="Faturamento por profissional"
                  formatValue={formatMoney}
                  data={data!.professionals.map((row) => ({
                    key: row.professionalId,
                    label: `${row.name} · ${row.services} serviço(s)`,
                    value: row.revenueCents,
                  }))}
                />
              )}
            </section>

            <section aria-labelledby="services-title">
              <h2 id="services-title" className="mb-3 text-xl font-bold">
                Serviços mais vendidos
              </h2>
              {data!.topServices.length === 0 ? (
                <EmptyState title="Nada vendido no período" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Serviço</TableHead>
                      <TableHead className="text-right">Qtd.</TableHead>
                      <TableHead className="text-right">Receita</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data!.topServices.map((service) => (
                      <TableRow key={service.serviceId}>
                        <TableCell>{service.name}</TableCell>
                        <TableCell className="text-right">{service.quantity}</TableCell>
                        <TableCell className="text-right font-medium">
                          {formatMoney(service.revenueCents)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </section>
          </div>

          <section aria-labelledby="status-title">
            <h2 id="status-title" className="mb-3 text-xl font-bold">
              Agendamentos por situação
            </h2>
            <ul className="flex flex-wrap gap-4">
              {Object.entries(data!.appointments.byStatus).map(([status, count]) => (
                <li key={status} className="flex items-center gap-2">
                  <StatusBadge status={status as Appointment['status']} />
                  <span className="font-semibold">{count}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </>
  );
}
