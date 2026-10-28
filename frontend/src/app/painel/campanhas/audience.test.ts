import { describe, expect, it } from 'vitest';
import { describeAudience, MONTHS } from './audience';

describe('describeAudience', () => {
  const services = [{ id: 's1', name: 'Corte masculino' }];

  it('descreve cada filtro em português', () => {
    expect(describeAudience({ kind: 'all' }, services)).toBe('Todos os clientes');
    expect(describeAudience({ kind: 'inactive', days: 45 }, services)).toBe('Sem visita há 45 dias ou mais');
    expect(describeAudience({ kind: 'birthday-month', month: 3 }, services)).toBe('Aniversariantes de março');
    expect(describeAudience({ kind: 'service', serviceId: 's1', days: 30 }, services)).toBe(
      'Fizeram Corte masculino nos últimos 30 dias',
    );
  });

  it('serviço removido do catálogo não quebra a descrição', () => {
    expect(describeAudience({ kind: 'service', serviceId: 'sumiu', days: 30 }, services)).toBe(
      'Fizeram um serviço nos últimos 30 dias',
    );
  });

  it('tem os doze meses', () => {
    expect(MONTHS).toHaveLength(12);
    expect(MONTHS[0]).toBe('janeiro');
  });
});
