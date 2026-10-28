'use client';

import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { TemplateConfig, WhatsAppTemplate } from '@/lib/queries';

type Source = TemplateConfig['parameters'][number]['source'];

const SOURCES: Record<Source, string> = {
  client_first_name: 'Primeiro nome do cliente',
  barbershop_name: 'Nome da barbearia',
};

const NONE = 'none';
const keyOf = (template: { name: string; language: string }) => `${template.name}|${template.language}`;

/** Exemplo de cada variável na prévia do texto. */
function sample(source: Source, barbershopName: string): string {
  return source === 'client_first_name' ? 'Carlos' : barbershopName;
}

/**
 * Escolha de um modelo aprovado do WhatsApp e do preenchimento das variáveis do corpo.
 * Só lista os modelos que o sistema consegue enviar (variáveis só no texto, sem mídia).
 */
export function TemplateFields({
  id,
  templates,
  value,
  onChange,
  barbershopName,
  noneLabel,
}: {
  id: string;
  templates: WhatsAppTemplate[];
  value: TemplateConfig | null;
  onChange: (value: TemplateConfig | null) => void;
  barbershopName: string;
  /** Com texto, permite "nenhum modelo" (ex.: aniversário só por e-mail). */
  noneLabel?: string;
}) {
  const supported = templates.filter((template) => template.supported);
  const unsupported = templates.length - supported.length;
  const selected = value ? supported.find((template) => keyOf(template) === keyOf(value)) : undefined;

  const choose = (key: string) => {
    const template = supported.find((item) => keyOf(item) === key);
    if (!template) return onChange(null);
    onChange({
      name: template.name,
      language: template.language,
      // Palpite inicial: a primeira variável costuma ser o nome do cliente.
      parameters: template.parameters.map((name, index) => ({
        name,
        source: index === 0 ? 'client_first_name' : 'barbershop_name',
      })),
    });
  };

  const setSource = (name: string, source: Source) =>
    value &&
    onChange({
      ...value,
      parameters: value.parameters.map((parameter) =>
        parameter.name === name ? { ...parameter, source } : parameter,
      ),
    });

  const previewText = selected
    ? value!.parameters.reduce(
        (text, parameter) =>
          text.replace(
            new RegExp(`\\{\\{\\s*${parameter.name}\\s*\\}\\}`, 'g'),
            sample(parameter.source, barbershopName),
          ),
        selected.body,
      )
    : null;

  return (
    <div className="grid gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor={id}>Modelo aprovado do WhatsApp</Label>
        <Select value={selected ? keyOf(selected) : NONE} onValueChange={choose}>
          <SelectTrigger id={id} className="w-full">
            <SelectValue placeholder="Escolha um modelo" />
          </SelectTrigger>
          <SelectContent>
            {noneLabel && <SelectItem value={NONE}>{noneLabel}</SelectItem>}
            {supported.map((template) => (
              <SelectItem key={keyOf(template)} value={keyOf(template)}>
                {template.name} ({template.language})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-muted-foreground text-xs">
          Mensagens iniciadas pela barbearia só saem por modelo aprovado pela Meta.
          {unsupported > 0 &&
            ` ${unsupported === 1 ? '1 modelo da conta não aparece' : `${unsupported} modelos da conta não aparecem`} por ter mídia ou variáveis fora do texto.`}
        </p>
      </div>

      {selected &&
        value!.parameters.map((parameter) => (
          <div key={parameter.name} className="grid gap-1.5">
            <Label htmlFor={`${id}-${parameter.name}`}>Variável {`{{${parameter.name}}}`}</Label>
            <Select
              value={parameter.source}
              onValueChange={(source) => setSource(parameter.name, source as Source)}
            >
              <SelectTrigger id={`${id}-${parameter.name}`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(SOURCES).map(([source, label]) => (
                  <SelectItem key={source} value={source}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}

      {previewText && (
        <figure className="bg-muted rounded-md p-3 text-sm">
          <figcaption className="text-muted-foreground mb-1 text-xs">Prévia</figcaption>
          {previewText}
        </figure>
      )}
    </div>
  );
}
