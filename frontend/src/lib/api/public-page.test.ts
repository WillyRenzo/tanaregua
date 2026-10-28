import { describe, expect, it } from 'vitest';
import { toPublicPage } from './public-page';

const ok = <T>(data: T) => ({ data, response: new Response(null, { status: 200 }) });
const failed = (status: number) => ({ data: undefined, response: new Response(null, { status }) });

const barbershop = { name: 'Barbearia do Zé' };

describe('toPublicPage', () => {
  it('monta a página com os três recursos', () => {
    expect(toPublicPage(ok(barbershop), ok([{ id: 's1' }]), ok([{ id: 'p1' }]))).toEqual({
      barbershop,
      services: [{ id: 's1' }],
      professionals: [{ id: 'p1' }],
    });
  });

  it('só trata 404 como barbearia inexistente', () => {
    expect(toPublicPage(failed(404), failed(404), failed(404))).toBeNull();
  });

  // O resultado fica em cache por minutos: uma falha passageira (limite de requisições,
  // API reiniciando no deploy) não pode virar "não encontrada" nem "agenda fechada".
  it.each([429, 500, 502, 503])('lança erro quando a barbearia responde %i', (status) => {
    expect(() => toPublicPage(failed(status), ok([]), ok([]))).toThrow(String(status));
  });

  it('lança erro quando serviços ou equipe falham, em vez de mostrar a agenda vazia', () => {
    expect(() => toPublicPage(ok(barbershop), failed(429), ok([]))).toThrow('429');
    expect(() => toPublicPage(ok(barbershop), ok([]), failed(503))).toThrow('503');
  });
});
