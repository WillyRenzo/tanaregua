import { grantedFeatures, isFeature } from './features.js';

describe('recursos do plano', () => {
  it('reconhece só as chaves do catálogo', () => {
    expect(isFeature('assistant')).toBe(true);
    expect(isFeature('Assistant')).toBe(false);
    expect(isFeature('reports:read')).toBe(false);
  });

  it('libera os recursos do plano', () => {
    expect(grantedFeatures(['payroll', 'assistant'])).toEqual(['payroll', 'assistant']);
  });

  it('ignora chave desconhecida gravada no plano (dado de outra versão ou erro de digitação)', () => {
    expect(grantedFeatures(['payroll', 'folha', 'ASSISTANT'])).toEqual(['payroll']);
  });
});
