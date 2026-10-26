import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ColumnChart, niceMax } from './charts';

describe('niceMax', () => {
  it.each([
    [0, 1],
    [7, 10],
    [12, 20],
    [230, 250],
    [4100, 5000],
  ])('arredonda %i para %i', (value, expected) => {
    expect(niceMax(value)).toBe(expected);
  });
});

describe('ColumnChart', () => {
  const data = [
    { key: '1', label: '01/03', value: 5000 },
    { key: '2', label: '02/03', value: 12000 },
  ];

  it('expõe cada coluna com nome acessível e mostra tooltip no foco', () => {
    render(
      <ColumnChart data={data} label="Receita" formatValue={(v) => `R$ ${v / 100}`} formatTick={String} />,
    );
    const column = screen.getByLabelText('02/03: R$ 120');
    fireEvent.focus(column);
    expect(screen.getByRole('tooltip')).toHaveTextContent('R$ 120');
  });

  it('oferece a mesma informação em tabela', () => {
    render(
      <ColumnChart data={data} label="Receita" formatValue={(v) => `R$ ${v / 100}`} formatTick={String} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Ver como tabela' }));
    expect(screen.getByRole('rowheader', { name: '01/03' })).toBeInTheDocument();
    expect(screen.getByText('R$ 50')).toBeInTheDocument();
  });
});
