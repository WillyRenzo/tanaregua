'use client';

import { useId, useRef, useState, type CSSProperties } from 'react';
import { ImageUp, Info, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { BarbershopLogo } from '@/components/barbershop-brand';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { errorMessage } from '@/lib/api/errors';
import { brandTheme, isBrandColor } from '@/lib/brand';
import { useRemoveLogo, useUpdateBarbershop, useUploadLogo, type BarbershopSettings } from '@/lib/queries';

const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const LOGO_MAX_BYTES = 1024 * 1024;

/** Identidade visual (business-rules §10): logo e cores, com prévia já ajustada para AA. */
export function BrandSettings({ settings }: { settings: BarbershopSettings }) {
  return (
    <section aria-labelledby="identidade-visual" className="grid max-w-lg gap-5">
      <div>
        <h2 id="identidade-visual" className="text-2xl font-bold">
          Identidade visual
        </h2>
        <p className="text-muted-foreground text-sm">
          Logo e cores aparecem na página de agendamento e no painel da equipe. A página pública pode levar
          alguns minutos para mostrar a mudança.
        </p>
      </div>
      <LogoField settings={settings} />
      <ColorsForm settings={settings} />
    </section>
  );
}

function LogoField({ settings }: { settings: BarbershopSettings }) {
  const upload = useUploadLogo();
  const remove = useRemoveLogo();
  const input = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const [error, setError] = useState<string | null>(null);
  const logoVersion = settings.brand.logoVersion;

  const choose = async (file: File | undefined) => {
    setError(null);
    if (!file) return;
    // Só para avisar rápido: quem valida de verdade (pelos bytes) é a API.
    if (!LOGO_TYPES.includes(file.type)) return setError('Envie o logo em PNG, JPEG ou WebP.');
    if (file.size > LOGO_MAX_BYTES) return setError('O logo pode ter no máximo 1 MB.');
    try {
      await upload.mutateAsync(file);
      toast.success('Logo atualizado.');
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      if (input.current) input.current.value = '';
    }
  };

  const handleRemove = async () => {
    try {
      await remove.mutateAsync();
      toast.success('Logo removido.');
    } catch (reason) {
      toast.error(errorMessage(reason));
    }
  };

  return (
    <div className="grid gap-2">
      <Label htmlFor={inputId}>Logo</Label>
      <div className="flex flex-wrap items-center gap-4">
        <div className="bg-sidebar grid h-20 w-40 place-items-center rounded-md p-2">
          {logoVersion ? (
            <BarbershopLogo
              slug={settings.slug}
              name={settings.name}
              logoVersion={logoVersion}
              className="h-16"
            />
          ) : (
            <span className="text-sidebar-foreground/70 text-xs">Sem logo</span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => input.current?.click()}
            disabled={upload.isPending}
          >
            <ImageUp aria-hidden />{' '}
            {upload.isPending ? 'Enviando…' : logoVersion ? 'Trocar logo' : 'Enviar logo'}
          </Button>
          {logoVersion && (
            <Button type="button" variant="ghost" onClick={handleRemove} disabled={remove.isPending}>
              <Trash2 aria-hidden /> Remover
            </Button>
          )}
        </div>
      </div>
      <input
        ref={input}
        id={inputId}
        type="file"
        accept={LOGO_TYPES.join(',')}
        className="sr-only"
        aria-describedby={`${inputId}-hint`}
        onChange={(event) => choose(event.target.files?.[0])}
      />
      <p id={`${inputId}-hint`} className="text-muted-foreground text-xs">
        PNG, JPEG ou WebP, até 1 MB. Fundo transparente fica melhor; a imagem é ajustada para até 512 px.
      </p>
      {error && (
        <p role="alert" className="text-destructive text-xs font-medium">
          {error}
        </p>
      )}
    </div>
  );
}

function ColorsForm({ settings }: { settings: BarbershopSettings }) {
  const update = useUpdateBarbershop();
  const [primary, setPrimary] = useState(settings.brand.primaryColor ?? '');
  const [secondary, setSecondary] = useState(settings.brand.secondaryColor ?? '');
  const [error, setError] = useState<string | null>(null);

  const normalized = (value: string) => (value.trim() === '' ? null : value.trim().toLowerCase());
  const primaryValue = normalized(primary);
  const secondaryValue = normalized(secondary);
  const invalid =
    (primaryValue !== null && !isBrandColor(primaryValue)) ||
    (secondaryValue !== null && !isBrandColor(secondaryValue));
  const theme = brandTheme({
    primaryColor: isBrandColor(primaryValue) ? primaryValue : null,
    secondaryColor: isBrandColor(secondaryValue) ? secondaryValue : null,
  });

  const save = async () => {
    setError(null);
    try {
      await update.mutateAsync({ brandPrimaryColor: primaryValue, brandSecondaryColor: secondaryValue });
      toast.success('Cores salvas.');
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <ColorField
          label="Cor principal"
          hint="Botões, links e fundo do menu (escurecido se preciso para a leitura)."
          value={primary}
          onChange={setPrimary}
        />
        <ColorField
          label="Cor secundária"
          hint="Fundos de seleção e item ativo do menu."
          value={secondary}
          onChange={setSecondary}
        />
      </div>

      {(theme.adjusted.primary || theme.adjusted.secondary) && (
        <Alert>
          <Info aria-hidden />
          <AlertDescription>
            Para manter a leitura acessível, ajustamos o tom
            {theme.adjusted.primary && theme.adjusted.secondary
              ? ' das duas cores'
              : theme.adjusted.primary
                ? ' da cor principal'
                : ' da cor secundária'}
            . A prévia abaixo mostra como vai ficar.
          </AlertDescription>
        </Alert>
      )}

      <BrandPreview vars={theme.vars} name={settings.name} />

      {error && (
        <p role="alert" className="text-destructive text-xs font-medium">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={save} disabled={invalid || update.isPending}>
          Salvar cores
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setPrimary('');
            setSecondary('');
          }}
        >
          Usar cores padrão
        </Button>
      </div>
    </div>
  );
}

function ColorField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const valid = value.trim() === '' || isBrandColor(value.trim().toLowerCase());
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label}: seletor`}
          value={isBrandColor(value.toLowerCase()) ? value.toLowerCase() : '#000000'}
          onChange={(event) => onChange(event.target.value)}
          className="border-input h-9 w-12 shrink-0 cursor-pointer rounded-md border bg-transparent p-1"
        />
        <Input
          id={id}
          value={value}
          placeholder="Padrão"
          maxLength={7}
          aria-invalid={valid ? undefined : true}
          aria-describedby={`${id}-hint`}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
      <p id={`${id}-hint`} className={valid ? 'text-muted-foreground text-xs' : 'text-destructive text-xs'}>
        {valid ? hint : 'Use o formato #RRGGBB.'}
      </p>
    </div>
  );
}

/** Prévia com os tokens já ajustados, aplicados só dentro do quadro. */
function BrandPreview({ vars, name }: { vars: Record<string, string>; name: string }) {
  return (
    <div
      style={vars as CSSProperties}
      className="border-border grid gap-3 rounded-lg border p-4"
      aria-label="Prévia"
    >
      <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Prévia</p>
      <div className="bg-sidebar text-sidebar-foreground flex items-center gap-2 rounded-md p-2 text-sm">
        <span className="bg-sidebar-accent text-sidebar-accent-foreground rounded px-2 py-1">
          <span className="text-sidebar-primary">●</span> Agenda
        </span>
        <span className="px-2 py-1">Clientes</span>
      </div>
      <div className="bg-accent border-primary rounded-md border p-3">
        <p className="text-accent-foreground font-medium">Corte masculino</p>
        <p className="text-muted-foreground text-sm">30 min · selecionado</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="bg-primary text-primary-foreground rounded-md px-3 py-2 text-sm font-medium">
          Agendar em {name}
        </span>
        <span className="text-primary text-sm underline underline-offset-4">Meus agendamentos</span>
      </div>
    </div>
  );
}
