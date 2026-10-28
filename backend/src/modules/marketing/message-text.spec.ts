import { firstName, renderText } from './message-text.js';

describe('texto das mensagens', () => {
  it('usa só o primeiro nome do cliente', () => {
    expect(firstName('  Carlos Eduardo Souza ')).toBe('Carlos');
    expect(firstName('Ana')).toBe('Ana');
  });

  it('troca {nome} e {barbearia} em todas as ocorrências e mantém o resto', () => {
    expect(
      renderText('Oi, {nome}! A {barbearia} lembrou de você, {nome}. {outro}', {
        clientName: 'Carlos Souza',
        barbershopName: 'Barbearia do Zé',
      }),
    ).toBe('Oi, Carlos! A Barbearia do Zé lembrou de você, Carlos. {outro}');
  });
});
