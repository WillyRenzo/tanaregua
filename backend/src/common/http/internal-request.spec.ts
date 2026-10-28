import { INTERNAL_TOKEN_HEADER, isInternalRequest } from './internal-request.js';

const token = 'segredo-interno-'.repeat(3);

describe('isInternalRequest', () => {
  it('reconhece o servidor do Next pelo token', () => {
    expect(isInternalRequest({ [INTERNAL_TOKEN_HEADER]: token }, token)).toBe(true);
  });

  it('recusa token errado, ausente ou repetido no cabeçalho', () => {
    expect(isInternalRequest({ [INTERNAL_TOKEN_HEADER]: `${token}x` }, token)).toBe(false);
    expect(isInternalRequest({ [INTERNAL_TOKEN_HEADER]: 'curto' }, token)).toBe(false);
    expect(isInternalRequest({}, token)).toBe(false);
    expect(isInternalRequest({ [INTERNAL_TOKEN_HEADER]: [token, token] }, token)).toBe(false);
  });

  it('sem token configurado, nenhuma requisição é interna', () => {
    expect(isInternalRequest({ [INTERNAL_TOKEN_HEADER]: '' }, undefined)).toBe(false);
    expect(isInternalRequest({ [INTERNAL_TOKEN_HEADER]: token }, undefined)).toBe(false);
  });
});
