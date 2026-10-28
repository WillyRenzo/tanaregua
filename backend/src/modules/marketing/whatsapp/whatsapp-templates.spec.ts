import {
  parseTemplate,
  templateParameters,
  toWhatsAppNumber,
  validateTemplateConfig,
  type RawTemplateComponent,
} from './whatsapp-templates.js';

describe('número do WhatsApp', () => {
  it('acrescenta o DDI do Brasil quando falta e mantém quando já tem', () => {
    expect(toWhatsAppNumber('11988887777')).toBe('5511988887777');
    expect(toWhatsAppNumber('1133334444')).toBe('551133334444');
    expect(toWhatsAppNumber('5511988887777')).toBe('5511988887777');
    expect(toWhatsAppNumber('123')).toBeNull();
    expect(toWhatsAppNumber(null)).toBeNull();
  });
});

describe('modelos aprovados', () => {
  const body = (text: string) => ({ type: 'BODY', text });
  const parse = (components: RawTemplateComponent[]) =>
    parseTemplate({ name: 't', language: 'pt_BR', category: 'MARKETING', components });

  it('lê as variáveis posicionais e nomeadas do corpo, na ordem e sem repetir', () => {
    expect(parse([body('Oi, {{1}}! A {{2}} deseja parabéns, {{1}}.')])).toMatchObject({
      parameters: ['1', '2'],
      supported: true,
      body: 'Oi, {{1}}! A {{2}} deseja parabéns, {{1}}.',
    });
    expect(parse([body('Oi, {{ nome }}! Desconto na {{barbearia}}.')]).parameters).toEqual([
      'nome',
      'barbearia',
    ]);
  });

  it('não dá suporte a cabeçalho de mídia, cabeçalho com variável, botão com variável ou sem corpo', () => {
    expect(parse([{ type: 'HEADER', format: 'IMAGE' }, body('Oi')]).supported).toBe(false);
    expect(parse([{ type: 'HEADER', format: 'TEXT', text: 'Oi {{1}}' }, body('Oi')]).supported).toBe(false);
    expect(
      parse([body('Oi'), { type: 'BUTTONS', buttons: [{ type: 'URL', url: 'https://x.test/{{1}}' }] }])
        .supported,
    ).toBe(false);
    expect(parse([{ type: 'HEADER', format: 'TEXT', text: 'Novidade' }]).supported).toBe(false);
    expect(
      parse([
        { type: 'HEADER', format: 'TEXT', text: 'Novidade' },
        body('Oi'),
        { type: 'FOOTER', text: 'Até logo' },
        { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Quero' }] },
      ]).supported,
    ).toBe(true);
  });

  const templates = [
    parseTemplate({
      name: 'aniversario',
      language: 'pt_BR',
      category: 'MARKETING',
      components: [body('{{1}} {{2}}')],
    }),
    parseTemplate({
      name: 'imagem',
      language: 'pt_BR',
      category: 'MARKETING',
      components: [{ type: 'HEADER', format: 'IMAGE' }, body('Oi')],
    }),
  ];
  const config = {
    name: 'aniversario',
    language: 'pt_BR',
    parameters: [
      { name: '1', source: 'client_first_name' as const },
      { name: '2', source: 'barbershop_name' as const },
    ],
  };

  it('valida a configuração contra os modelos da conta', () => {
    expect(validateTemplateConfig(config, templates)).toBeNull();
    expect(validateTemplateConfig({ ...config, name: 'sumiu' }, templates)).toMatch(/não está aprovado/);
    expect(validateTemplateConfig({ ...config, language: 'en_US' }, templates)).toMatch(/não está aprovado/);
    expect(
      validateTemplateConfig({ ...config, parameters: config.parameters.slice(0, 1) }, templates),
    ).toMatch(/variáveis/);
    expect(
      validateTemplateConfig({ ...config, parameters: [...config.parameters].reverse() }, templates),
    ).toMatch(/variáveis/);
    expect(validateTemplateConfig({ name: 'imagem', language: 'pt_BR', parameters: [] }, templates)).toMatch(
      /não é suportado/,
    );
  });

  it('preenche as variáveis a partir do cliente e da barbearia', () => {
    expect(
      templateParameters(config.parameters, { clientName: 'Carlos Souza', barbershopName: 'Barbearia Demo' }),
    ).toEqual([
      { name: '1', text: 'Carlos' },
      { name: '2', text: 'Barbearia Demo' },
    ]);
  });
});
