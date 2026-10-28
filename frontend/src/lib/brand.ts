/**
 * Identidade visual da barbearia (business-rules §10): a partir das duas cores escolhidas,
 * deriva os tokens de tema garantindo contraste WCAG AA. Se a cor escolhida não permitir,
 * ela é ajustada (escurecida ou clareada mantendo o tom) e a tela de configurações mostra
 * a prévia do resultado.
 *
 * Os tokens base em hex são os do `globals.css` (OKLCH convertido); se o tema mudar, atualize.
 */

const HEX = /^#[0-9a-f]{6}$/;

/** Superfícies do tema claro (globals.css). */
const BACKGROUND = '#f9f6f2';
const FOREGROUND = '#211813';
const MUTED_FOREGROUND = '#645850';
const SIDEBAR_FOREGROUND = '#f7f5f1';
const WHITE = '#ffffff';
const BLACK = '#000000';

/** Menor opacidade de texto sobre a barra escura (`text-sidebar-foreground/70`). */
const FADED_TEXT_OPACITY = 0.7;

/** AA: 4,5:1 para texto; 3:1 para elementos que não são texto (ícones, bordas). */
const TEXT = 4.5;
const NON_TEXT = 3;

export interface BrandColors {
  primaryColor: string | null;
  secondaryColor: string | null;
}

export interface BrandTheme {
  /** Tokens CSS a sobrescrever (só os da cor que a barbearia escolheu). */
  vars: Record<string, string>;
  /** Cor principal efetivamente usada em botões e links (pode ter sido escurecida). */
  primary: string | null;
  /** Cor de destaque efetivamente usada em fundos (pode ter sido clareada). */
  accent: string | null;
  adjusted: { primary: boolean; secondary: boolean };
}

type Rgb = [number, number, number];

const toRgb = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
const toHex = (rgb: Rgb): string =>
  `#${rgb.map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`;

function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** Razão de contraste WCAG 2.x entre duas cores (1 a 21). */
export function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}

function mix(color: string, target: string, amount: number): string {
  const from = toRgb(color);
  const to = toRgb(target);
  return toHex(from.map((channel, i) => channel + (to[i]! - channel) * amount) as Rgb);
}

/** Aproxima a cor do preto ou do branco, aos poucos, até passar em todas as checagens. */
function adjustUntil(color: string, toward: string, ok: (candidate: string) => boolean): string {
  for (let step = 0; step <= 50; step++) {
    const candidate = mix(color, toward, step / 50);
    if (ok(candidate)) return candidate;
  }
  return toward;
}

/** Texto sobre a cor: o que der mais contraste entre branco e o texto escuro do tema. */
const readableOn = (surface: string): string =>
  contrast(WHITE, surface) >= contrast(FOREGROUND, surface) ? WHITE : FOREGROUND;

export function isBrandColor(value: string | null | undefined): value is string {
  return typeof value === 'string' && HEX.test(value);
}

export function brandTheme(brand: BrandColors): BrandTheme {
  const vars: Record<string, string> = {};
  const theme: BrandTheme = {
    vars,
    primary: null,
    accent: null,
    adjusted: { primary: false, secondary: false },
  };

  if (isBrandColor(brand.primaryColor)) {
    // Botões e links sobre o fundo claro: texto da cor principal e texto sobre ela legíveis.
    const primary = adjustUntil(
      brand.primaryColor,
      BLACK,
      (c) => contrast(c, BACKGROUND) >= TEXT && contrast(readableOn(c), c) >= TEXT,
    );
    // Fundo do menu e do topo da página pública no tom da marca, escurecido só o necessário
    // para o texto claro do menu continuar legível.
    // A condição usa o texto mais fraco da barra: o claro a 70% de opacidade.
    const sidebar = adjustUntil(
      brand.primaryColor,
      BLACK,
      (c) => contrast(mix(SIDEBAR_FOREGROUND, c, 1 - FADED_TEXT_OPACITY), c) >= TEXT,
    );
    // Hover (e item ativo, sem cor secundária): um tom acima do fundo, com o texto legível.
    const sidebarAccent = adjustUntil(
      mix(sidebar, WHITE, 0.12),
      BLACK,
      (c) => contrast(SIDEBAR_FOREGROUND, c) >= TEXT,
    );
    // Sobre a barra, a cor da marca precisa ser clara (ícone ativo, foco).
    const onDark = adjustUntil(brand.primaryColor, WHITE, (c) => contrast(c, sidebar) >= TEXT);
    Object.assign(vars, {
      '--primary': primary,
      '--primary-foreground': readableOn(primary),
      '--ring': primary,
      '--sidebar': sidebar,
      '--sidebar-foreground': SIDEBAR_FOREGROUND,
      '--sidebar-accent': sidebarAccent,
      '--sidebar-accent-foreground': SIDEBAR_FOREGROUND,
      '--sidebar-border': mix(sidebar, WHITE, 0.15),
      '--sidebar-primary': onDark,
      '--sidebar-primary-foreground': readableOn(onDark),
      '--sidebar-ring': onDark,
    });
    theme.primary = primary;
    theme.adjusted.primary = primary !== brand.primaryColor;
  }

  if (isBrandColor(brand.secondaryColor)) {
    // Fundo de destaque (seleção, hover): até o texto secundário precisa ser legível nele.
    const accent = adjustUntil(brand.secondaryColor, WHITE, (c) => contrast(MUTED_FOREGROUND, c) >= TEXT);
    // Texto sobre o destaque, no tom da marca.
    const accentText = adjustUntil(brand.secondaryColor, BLACK, (c) => contrast(c, accent) >= TEXT);
    // Item ativo do menu escuro: fundo no tom da marca com o texto claro legível.
    const activeItem = adjustUntil(
      brand.secondaryColor,
      BLACK,
      (c) => contrast(SIDEBAR_FOREGROUND, c) >= TEXT,
    );
    Object.assign(vars, {
      '--accent': accent,
      '--accent-foreground': accentText,
      '--sidebar-accent': activeItem,
      '--sidebar-accent-foreground': SIDEBAR_FOREGROUND,
    });
    theme.accent = accent;
    theme.adjusted.secondary = accent !== brand.secondaryColor;
  }

  // O ícone ativo do menu (cor principal) também precisa aparecer sobre o item ativo.
  const onDark = vars['--sidebar-primary'];
  const activeItem = vars['--sidebar-accent'];
  if (onDark && activeItem && contrast(onDark, activeItem) < NON_TEXT) {
    vars['--sidebar-primary'] = adjustUntil(onDark, WHITE, (c) => contrast(c, activeItem) >= NON_TEXT);
    vars['--sidebar-primary-foreground'] = readableOn(vars['--sidebar-primary']);
  }

  return theme;
}

/** CSS que sobrescreve os tokens no `:root` (vale também para diálogos em portal). */
export function brandCss(brand: BrandColors): string {
  const entries = Object.entries(brandTheme(brand).vars).filter(([, value]) => HEX.test(value));
  if (entries.length === 0) return '';
  return `:root{${entries.map(([name, value]) => `${name}:${value}`).join(';')}}`;
}

/** URL do logo servido pela API; a versão muda a cada upload e fura o cache. */
export function logoUrl(slug: string, logoVersion: string): string {
  return `/api/v1/public/${encodeURIComponent(slug)}/logo?v=${encodeURIComponent(logoVersion)}`;
}
