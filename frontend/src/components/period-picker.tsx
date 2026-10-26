'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { addDays } from '@/lib/format';

export interface Period {
  from: string;
  to: string;
}

/** Atalhos de período (datas locais da barbearia; `to` inclusivo, máx. 93 dias na API). */
export function periodPresets(today: string): { label: string; period: Period }[] {
  const monthStart = `${today.slice(0, 8)}01`;
  return [
    { label: 'Hoje', period: { from: today, to: today } },
    { label: '7 dias', period: { from: addDays(today, -6), to: today } },
    { label: 'Este mês', period: { from: monthStart, to: today } },
    { label: '30 dias', period: { from: addDays(today, -29), to: today } },
  ];
}

export function PeriodPicker({
  value,
  onChange,
  today,
}: {
  value: Period;
  onChange: (period: Period) => void;
  today: string;
}) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="flex flex-wrap gap-1" role="group" aria-label="Atalhos de período">
        {periodPresets(today).map((preset) => {
          const active = preset.period.from === value.from && preset.period.to === value.to;
          return (
            <Button
              key={preset.label}
              size="sm"
              variant={active ? 'default' : 'outline'}
              aria-pressed={active}
              onClick={() => onChange(preset.period)}
            >
              {preset.label}
            </Button>
          );
        })}
      </div>
      <div className="flex items-end gap-2">
        <div className="grid gap-1">
          <Label htmlFor="period-from" className="text-xs">
            De
          </Label>
          <Input
            id="period-from"
            type="date"
            value={value.from}
            max={value.to}
            onChange={(event) => event.target.value && onChange({ ...value, from: event.target.value })}
            className="h-8 w-auto"
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="period-to" className="text-xs">
            Até
          </Label>
          <Input
            id="period-to"
            type="date"
            value={value.to}
            min={value.from}
            onChange={(event) => event.target.value && onChange({ ...value, to: event.target.value })}
            className="h-8 w-auto"
          />
        </div>
      </div>
    </div>
  );
}
