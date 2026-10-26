'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * Gráficos mínimos seguindo a skill dataviz: série única em --chart-1 (cobre, validado
 * nos dois modos), colunas ≤ 24px com ponta arredondada de 4px e base reta, 2px de
 * respiro entre marcas, grade em linha fina, tooltip no hover/foco e tabela equivalente.
 * Texto nunca usa a cor da série.
 */

export interface Datum {
  key: string;
  label: string;
  value: number;
}

/** Topo "redondo" do eixo: 1, 2, 2,5 ou 5 × 10ⁿ. */
export function niceMax(value: number): number {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((multiplier) => multiplier * power >= value)!;
  return step * power;
}

export function ColumnChart({
  data,
  formatValue,
  formatTick,
  label,
}: {
  data: Datum[];
  formatValue: (value: number) => string;
  formatTick: (value: number) => string;
  /** Nome acessível do gráfico (o título visível fica fora). */
  label: string;
}) {
  const [active, setActive] = useState<string | null>(null);
  const [showTable, setShowTable] = useState(false);
  const max = niceMax(Math.max(...data.map((datum) => datum.value), 0));
  const ticks = [0, 0.5, 1].map((fraction) => max * fraction);

  return (
    <figure className="grid gap-2">
      <div className="flex justify-end">
        <button
          type="button"
          className="text-muted-foreground text-xs underline-offset-4 hover:underline"
          onClick={() => setShowTable((value) => !value)}
          aria-pressed={showTable}
        >
          {showTable ? 'Ver gráfico' : 'Ver como tabela'}
        </button>
      </div>

      {showTable ? (
        <DataTable data={data} formatValue={formatValue} />
      ) : (
        <div className="grid grid-cols-[auto_1fr] gap-2">
          {/* Eixo Y */}
          <div
            className="text-muted-foreground relative h-48 w-14 text-right text-xs tabular-nums"
            aria-hidden
          >
            {ticks.map((tick) => (
              <span
                key={tick}
                className="absolute right-0 -translate-y-1/2"
                style={{ bottom: `${(tick / max) * 100}%` }}
              >
                {formatTick(tick)}
              </span>
            ))}
          </div>
          <div className="relative h-48">
            {ticks.map((tick) => (
              <div
                key={tick}
                aria-hidden
                className="bg-border absolute inset-x-0 h-px"
                style={{ bottom: `${(tick / max) * 100}%` }}
              />
            ))}
            <ul aria-label={label} className="absolute inset-0 flex items-end gap-0.5">
              {data.map((datum) => {
                const height = (Math.max(datum.value, 0) / max) * 100;
                const isActive = active === datum.key;
                return (
                  <li
                    key={datum.key}
                    tabIndex={0}
                    aria-label={`${datum.label}: ${formatValue(datum.value)}`}
                    className="group relative flex h-full flex-1 items-end justify-center focus-visible:outline-none"
                    onMouseEnter={() => setActive(datum.key)}
                    onMouseLeave={() => setActive(null)}
                    onFocus={() => setActive(datum.key)}
                    onBlur={() => setActive(null)}
                  >
                    {/* Alvo de hover = coluna inteira, maior que a marca. */}
                    <span
                      className={cn(
                        'bg-chart-1 block w-full max-w-6 rounded-t-[4px] transition-opacity',
                        active && !isActive && 'opacity-50',
                        'group-focus-visible:ring-ring group-focus-visible:ring-2',
                      )}
                      style={{ height: `${height}%`, minHeight: datum.value > 0 ? 2 : 0 }}
                    />
                    {isActive && (
                      <span
                        role="tooltip"
                        className="bg-popover text-popover-foreground border-border pointer-events-none absolute bottom-full z-10 mb-2 rounded-md border px-2 py-1 text-xs whitespace-nowrap shadow-md"
                      >
                        <span className="text-muted-foreground block">{datum.label}</span>
                        <span className="font-semibold">{formatValue(datum.value)}</span>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
          <div />
          {/* Rótulos do eixo X: só o primeiro e o último, para não poluir. */}
          <div className="text-muted-foreground flex justify-between text-xs" aria-hidden>
            <span>{data[0]?.label}</span>
            <span>{data.length > 1 ? data[data.length - 1]?.label : ''}</span>
          </div>
        </div>
      )}
    </figure>
  );
}

/** Ranking horizontal com o valor na ponta da barra. */
export function BarList({
  data,
  formatValue,
  label,
}: {
  data: Datum[];
  formatValue: (value: number) => string;
  label: string;
}) {
  const max = Math.max(...data.map((datum) => datum.value), 1);
  return (
    <ul aria-label={label} className="grid gap-3">
      {data.map((datum) => (
        <li key={datum.key} className="grid gap-1">
          <span className="text-sm">{datum.label}</span>
          <span className="flex items-center gap-2">
            <span
              aria-hidden
              className="bg-chart-1 block h-3 max-w-[80%] rounded-r-[4px]"
              style={{
                width: `${(Math.max(datum.value, 0) / max) * 80}%`,
                minWidth: datum.value > 0 ? 2 : 0,
              }}
            />
            <span className="text-sm font-semibold tabular-nums">{formatValue(datum.value)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function DataTable({ data, formatValue }: { data: Datum[]; formatValue: (value: number) => string }) {
  return (
    <table className="w-full text-sm">
      <tbody>
        {data.map((datum) => (
          <tr key={datum.key} className="border-border border-b">
            <th scope="row" className="py-1.5 text-left font-normal">
              {datum.label}
            </th>
            <td className="py-1.5 text-right tabular-nums">{formatValue(datum.value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
