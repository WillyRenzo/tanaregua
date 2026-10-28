import { describe, expect, it } from 'vitest';
import { brandCss, brandTheme, contrast, logoUrl } from './brand';

const BACKGROUND = '#f9f6f2';
const MUTED_FOREGROUND = '#645850';
const SIDEBAR = '#211813';
const SIDEBAR_FOREGROUND = '#f7f5f1';

/** Cor vista quando `color` com a opacidade dada é desenhada sobre `surface`. */
function blend(color: string, surface: string, opacity: number): string {
  const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [top, bottom] = [channels(color), channels(surface)];
  return `#${top
    .map((channel, i) => Math.round(channel * opacity + bottom[i]! * (1 - opacity)))
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')}`;
}

/** Cores difíceis: claras demais, escuras demais, saturadas e tons médios. */
const SAMPLES = [
  '#ffffff',
  '#000000',
  '#ffff00',
  '#00ff00',
  '#ff0000',
  '#0000ff',
  '#777777',
  '#f4d35e',
  '#1a5d3a',
  '#c0392b',
  '#87ceeb',
  '#2c3e50',
  '#ff69b4',
];

describe('contrast', () => {
  it('segue a fórmula WCAG', () => {
    expect(contrast('#ffffff', '#000000')).toBeCloseTo(21, 1);
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
    expect(contrast('#123456', '#123456')).toBe(1);
  });
});

describe('brandTheme', () => {
  it('sem cores escolhidas, não sobrescreve nada (vale o tema TaNaRegua)', () => {
    expect(brandTheme({ primaryColor: null, secondaryColor: null }).vars).toEqual({});
    expect(brandCss({ primaryColor: null, secondaryColor: null })).toBe('');
  });

  it.each(SAMPLES)('cor principal %s: botões, links e menu sempre com contraste AA', (color) => {
    const { vars } = brandTheme({ primaryColor: color, secondaryColor: null });
    expect(contrast(vars['--primary']!, BACKGROUND)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(vars['--primary-foreground']!, vars['--primary']!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(vars['--sidebar-primary']!, vars['--sidebar']!)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(SAMPLES)('cor principal %s: o fundo do menu segue a marca, com texto legível', (color) => {
    const { vars } = brandTheme({ primaryColor: color, secondaryColor: null });
    expect(vars['--sidebar']).toMatch(/^#[0-9a-f]{6}$/);
    expect(vars['--sidebar']).not.toBe(SIDEBAR);
    expect(contrast(SIDEBAR_FOREGROUND, vars['--sidebar']!)).toBeGreaterThanOrEqual(4.5);
    // Textos secundários da barra usam o texto claro a 70% de opacidade.
    expect(
      contrast(blend(SIDEBAR_FOREGROUND, vars['--sidebar']!, 0.7), vars['--sidebar']!),
    ).toBeGreaterThanOrEqual(4.5);
    // Hover e item ativo sem cor secundária: um tom acima do fundo, com o texto ainda legível.
    expect(vars['--sidebar-accent']).not.toBe(vars['--sidebar']);
    expect(contrast(SIDEBAR_FOREGROUND, vars['--sidebar-accent']!)).toBeGreaterThanOrEqual(4.5);
  });

  it('menu usa a cor principal como está quando o texto do menu já é legível nela', () => {
    expect(brandTheme({ primaryColor: '#2c3e50', secondaryColor: null }).vars['--sidebar']).toBe('#2c3e50');
    // Clara demais para o texto claro do menu: escurece mantendo o tom.
    expect(brandTheme({ primaryColor: '#87ceeb', secondaryColor: null }).vars['--sidebar']).not.toBe(
      '#87ceeb',
    );
  });

  it.each(SAMPLES)('cor secundária %s: destaques e item ativo do menu legíveis', (color) => {
    const { vars } = brandTheme({ primaryColor: null, secondaryColor: color });
    expect(contrast(MUTED_FOREGROUND, vars['--accent']!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(vars['--accent-foreground']!, vars['--accent']!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(SIDEBAR_FOREGROUND, vars['--sidebar-accent']!)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(SAMPLES.flatMap((primary) => SAMPLES.map((secondary) => [primary, secondary])))(
    'ícone ativo (%s) aparece sobre o item ativo (%s) do menu',
    (primary, secondary) => {
      const { vars } = brandTheme({ primaryColor: primary!, secondaryColor: secondary! });
      expect(contrast(vars['--sidebar-primary']!, vars['--sidebar-accent']!)).toBeGreaterThanOrEqual(3);
    },
  );

  it('mantém a cor quando ela já é acessível e avisa quando ajusta', () => {
    const dark = brandTheme({ primaryColor: '#1a5d3a', secondaryColor: null });
    expect(dark.primary).toBe('#1a5d3a');
    expect(dark.adjusted.primary).toBe(false);

    const yellow = brandTheme({ primaryColor: '#ffff00', secondaryColor: null });
    expect(yellow.primary).not.toBe('#ffff00');
    expect(yellow.adjusted.primary).toBe(true);
  });

  it('ignora valores fora do formato (nada de texto livre no CSS)', () => {
    const css = brandCss({ primaryColor: 'red;}body{display:none', secondaryColor: '#FFF' });
    expect(css).toBe('');
  });

  it('gera CSS só com tokens e hex', () => {
    expect(brandCss({ primaryColor: '#1a5d3a', secondaryColor: null })).toMatch(
      /^:root\{(--[a-z-]+:#[0-9a-f]{6};?)+\}$/,
    );
  });
});

describe('logoUrl', () => {
  it('aponta para a API com a versão do logo', () => {
    expect(logoUrl('barbearia-demo', 'abc')).toBe('/api/v1/public/barbearia-demo/logo?v=abc');
  });
});
