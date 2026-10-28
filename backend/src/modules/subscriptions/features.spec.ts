import { grantedFeatures, isFeature } from './features.js';

describe('recursos do plano', () => {
  it('reconhece só as chaves do catálogo', () => {
    expect(isFeature('assistant')).toBe(true);
    expect(isFeature('Assistant')).toBe(false);
    expect(isFeature('reports:read')).toBe(false);
  });

  it('assinatura ativa, em teste ou em atraso libera os recursos do plano', () => {
    for (const status of ['ACTIVE', 'TRIALING', 'PAST_DUE'] as const) {
      expect(grantedFeatures(status, ['payroll', 'assistant'])).toEqual(['payroll', 'assistant']);
    }
  });

  it('assinatura cancelada não libera nenhum recurso', () => {
    expect(grantedFeatures('CANCELED', ['payroll', 'assistant'])).toEqual([]);
  });

  it('ignora chave desconhecida gravada no plano (dado de outra versão ou erro de digitação)', () => {
    expect(grantedFeatures('ACTIVE', ['payroll', 'folha', 'ASSISTANT'])).toEqual(['payroll']);
  });
});
