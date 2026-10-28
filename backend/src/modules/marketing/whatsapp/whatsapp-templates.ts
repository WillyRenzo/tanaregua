import type { TemplateConfig, TemplateParameterSource } from '../marketing.schemas.js';
import { firstName, type TextValues } from '../message-text.js';

/** Modelo aprovado da conta, no formato que o painel usa. */
export interface WhatsAppTemplate {
  name: string;
  language: string;
  category: string;
  /** Texto do corpo com as variáveis ({{1}} ou {{nome}}), para a prévia. */
  body: string;
  /** Variáveis do corpo, na ordem em que aparecem. */
  parameters: string[];
  /**
   * Só modelos cujas variáveis estão todas no corpo: cabeçalho de mídia, cabeçalho com
   * variável e botão com variável pedem dados que o sistema não tem.
   */
  supported: boolean;
}

/** Componente de modelo como a Graph API devolve (só o que lemos). */
export interface RawTemplateComponent {
  type: string;
  format?: string;
  text?: string;
  buttons?: { type: string; text?: string; url?: string }[];
}

export interface RawTemplate {
  name: string;
  language: string;
  category: string;
  components: RawTemplateComponent[];
}

const VARIABLE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

const variablesOf = (text = '') => [...new Set([...text.matchAll(VARIABLE)].map((match) => match[1]!))];

export function parseTemplate(raw: RawTemplate): WhatsAppTemplate {
  const body = raw.components.find((component) => component.type === 'BODY');
  const header = raw.components.find((component) => component.type === 'HEADER');
  const buttons = raw.components.find((component) => component.type === 'BUTTONS')?.buttons ?? [];
  const headerOk = !header || (header.format === 'TEXT' && variablesOf(header.text).length === 0);
  const buttonsOk = buttons.every((button) => variablesOf(button.url).length === 0);
  return {
    name: raw.name,
    language: raw.language,
    category: raw.category,
    body: body?.text ?? '',
    parameters: variablesOf(body?.text),
    supported: Boolean(body) && headerOk && buttonsOk,
  };
}

/**
 * Confere a configuração escolhida contra os modelos aprovados da conta. Devolve a mensagem
 * de erro para o usuário, ou null se estiver tudo certo.
 */
export function validateTemplateConfig(config: TemplateConfig, templates: WhatsAppTemplate[]): string | null {
  const template = templates.find((item) => item.name === config.name && item.language === config.language);
  if (!template) return `O modelo "${config.name}" (${config.language}) não está aprovado nesta conta.`;
  if (!template.supported) {
    return `O modelo "${config.name}" não é suportado: use um sem mídia e com variáveis só no texto.`;
  }
  const names = config.parameters.map((parameter) => parameter.name);
  if (names.join('|') !== template.parameters.join('|')) {
    return `Preencha as variáveis do modelo na ordem: ${template.parameters.join(', ') || 'nenhuma'}.`;
  }
  return null;
}

const SOURCES: Record<TemplateParameterSource, (values: TextValues) => string> = {
  client_first_name: (values) => firstName(values.clientName),
  barbershop_name: (values) => values.barbershopName,
};

export function templateParameters(
  parameters: TemplateConfig['parameters'],
  values: TextValues,
): { name: string; text: string }[] {
  return parameters.map((parameter) => ({ name: parameter.name, text: SOURCES[parameter.source](values) }));
}

/**
 * Número no formato da Cloud API (só dígitos, com DDI). O cadastro guarda 10–13 dígitos:
 * sem DDI (10–11) assume o Brasil.
 */
export function toWhatsAppNumber(phone: string | null): string | null {
  const digits = phone?.replace(/\D/g, '') ?? '';
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  if (digits.length === 12 || digits.length === 13) return digits;
  return null;
}
