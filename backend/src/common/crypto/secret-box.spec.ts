import { randomBytes } from 'node:crypto';
import { SecretBox } from './secret-box.js';

const box = new SecretBox(randomBytes(32));

describe('SecretBox', () => {
  it('cifra e decifra no mesmo contexto', () => {
    const sealed = box.seal('token-da-meta', 'barbearia-a');
    expect(sealed).not.toContain('token-da-meta');
    expect(box.open(sealed, 'barbearia-a')).toBe('token-da-meta');
  });

  it('usa IV novo a cada cifragem', () => {
    expect(box.seal('mesmo texto', 'ctx')).not.toBe(box.seal('mesmo texto', 'ctx'));
  });

  it('recusa decifrar em outro contexto (token copiado para outra barbearia)', () => {
    const sealed = box.seal('token-da-meta', 'barbearia-a');
    expect(() => box.open(sealed, 'barbearia-b')).toThrow();
  });

  it('recusa texto adulterado ou com outra chave', () => {
    const sealed = box.seal('token-da-meta', 'ctx');
    const [version, iv, tag, data] = sealed.split('.');
    const flipped = `${data!.slice(0, -2)}${data!.endsWith('AA') ? 'BB' : 'AA'}`;
    expect(() => box.open([version, iv, tag, flipped].join('.'), 'ctx')).toThrow();
    expect(() => new SecretBox(randomBytes(32)).open(sealed, 'ctx')).toThrow();
    expect(() => box.open('v0.formato.desconhecido.x', 'ctx')).toThrow();
  });

  it('exige chave de 32 bytes', () => {
    expect(() => new SecretBox(randomBytes(16))).toThrow();
  });
});
