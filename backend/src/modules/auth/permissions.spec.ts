import { canUsePanel, DEFAULT_ROLES } from './permissions.js';

describe('canUsePanel', () => {
  it('libera o painel para os papéis de equipe', () => {
    expect(canUsePanel(DEFAULT_ROLES.owner.permissions)).toBe(true);
    expect(canUsePanel(DEFAULT_ROLES.receptionist.permissions)).toBe(true);
    expect(canUsePanel(DEFAULT_ROLES.professional.permissions)).toBe(true);
  });

  it('não libera para quem só agenda para si (cliente final)', () => {
    expect(canUsePanel(DEFAULT_ROLES.client.permissions)).toBe(false);
  });

  it('ignora permissões que não existem mais no catálogo', () => {
    expect(canUsePanel(['bookings:self', 'permissao:antiga'])).toBe(false);
    expect(canUsePanel([])).toBe(false);
  });
});
