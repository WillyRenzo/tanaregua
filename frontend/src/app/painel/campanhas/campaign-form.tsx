'use client';

import { useState } from 'react';
import { Send, Users } from 'lucide-react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Field } from '@/components/form/field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { zodResolver } from '@/lib/forms/zod-resolver';
import {
  useBarbershop,
  useCreateCampaign,
  usePreviewCampaign,
  useServices,
  useWhatsApp,
  useWhatsAppTemplates,
  type Audience,
  type TemplateConfig,
} from '@/lib/queries';
import { describeAudience, MONTHS } from './audience';
import { TemplateFields } from './template-fields';

const AUDIENCES = {
  all: 'Todos os clientes',
  inactive: 'Sem visita há um tempo',
  'birthday-month': 'Aniversariantes de um mês',
  service: 'Fizeram um serviço',
} as const;

const schema = z
  .object({
    name: z.string().trim().min(3, 'Dê um nome para achar a campanha depois.').max(100),
    channel: z.enum(['EMAIL', 'WHATSAPP']),
    audienceKind: z.enum(['all', 'inactive', 'birthday-month', 'service']),
    days: z.coerce.number<string>().int('Use dias inteiros.').min(1).max(730, 'Até 730 dias.'),
    month: z.string(),
    serviceId: z.string(),
    subject: z.string().trim().max(150),
    body: z.string().trim().max(2000),
    template: z.custom<TemplateConfig | null>(),
  })
  .superRefine((values, context) => {
    const issue = (path: string, message: string) =>
      context.addIssue({ code: 'custom', path: [path], message });
    if (values.audienceKind === 'inactive' && values.days < 15) issue('days', 'Use pelo menos 15 dias.');
    if (values.audienceKind === 'service' && !values.serviceId) issue('serviceId', 'Escolha o serviço.');
    if (values.channel === 'EMAIL') {
      if (values.subject.length < 3) issue('subject', 'Escreva o assunto.');
      if (values.body.length < 10) issue('body', 'Escreva o texto (mínimo de 10 caracteres).');
    }
    if (values.channel === 'WHATSAPP' && !values.template) issue('template', 'Escolha o modelo aprovado.');
  });

type Values = z.input<typeof schema>;

function toAudience(values: Pick<Values, 'audienceKind' | 'days' | 'month' | 'serviceId'>): Audience {
  const days = Number(values.days);
  switch (values.audienceKind) {
    case 'all':
      return { kind: 'all' };
    case 'inactive':
      return { kind: 'inactive', days };
    case 'birthday-month':
      return { kind: 'birthday-month', month: Number(values.month) };
    case 'service':
      return { kind: 'service', serviceId: values.serviceId, days };
  }
}

interface PreviewState {
  /** Canal + público da prévia: se o formulário mudar, a prévia deixa de valer. */
  key: string;
  matched: number;
  recipients: number;
  sample: { id: string; name: string }[];
}

/** Nova campanha (business-rules §9): filtro, conteúdo, prévia de quem recebe e confirmação. */
export function CampaignForm({
  currentMonth,
  onDone,
}: {
  currentMonth: number;
  onDone: (id: string) => void;
}) {
  const barbershop = useBarbershop();
  const services = useServices(true);
  const whatsapp = useWhatsApp();
  const connected = Boolean(whatsapp.data?.connection);
  const previewCampaign = usePreviewCampaign();
  const create = useCreateCampaign();
  const [preview, setPreview] = useState<PreviewState | null>(null);

  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      channel: 'EMAIL',
      audienceKind: 'all',
      days: '45',
      month: String(currentMonth),
      serviceId: '',
      subject: '',
      body: '',
      template: null,
    },
  });
  const { errors, isSubmitting } = form.formState;
  const [channel, audienceKind, days, month, serviceId] = useWatch({
    control: form.control,
    name: ['channel', 'audienceKind', 'days', 'month', 'serviceId'],
  });
  const templates = useWhatsAppTemplates(connected && channel === 'WHATSAPP');
  const currentKey = JSON.stringify([channel, toAudience({ audienceKind, days, month, serviceId })]);
  const validPreview = preview?.key === currentKey ? preview : null;

  const runPreview = async (values: z.output<typeof schema>) => {
    const audience = toAudience({ ...values, days: String(values.days) });
    const result = await previewCampaign.mutateAsync({ channel: values.channel, audience });
    setPreview({ key: JSON.stringify([values.channel, audience]), ...result });
    return result;
  };

  const onPreview = form.handleSubmit(async (values) => {
    try {
      await runPreview(values);
    } catch (error) {
      form.setError('root', { message: errorMessage(error) });
    }
  });

  const onSend = form.handleSubmit(async (values) => {
    if (!validPreview) return;
    const audience = toAudience({ ...values, days: String(values.days) });
    try {
      const campaign = await create.mutateAsync({
        name: values.name,
        channel: values.channel,
        audience,
        ...(values.channel === 'EMAIL'
          ? { email: { subject: values.subject, body: values.body } }
          : { whatsapp: values.template! }),
        confirmRecipients: validPreview.recipients,
      });
      toast.success(
        campaign.recipientCount === 1
          ? 'Campanha na fila: 1 mensagem.'
          : `Campanha na fila: ${campaign.recipientCount} mensagens.`,
      );
      onDone(campaign.id);
    } catch (error) {
      form.setError('root', { message: errorMessage(error) });
      // O público mudou desde a prévia: mostra o número novo para confirmar de novo.
      if (error instanceof ApiError && error.code === 'audience-changed')
        await runPreview(values).catch(() => null);
    }
  });

  const channelLabel = channel === 'EMAIL' ? 'e-mail' : 'WhatsApp';

  return (
    <form onSubmit={onPreview} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle className="font-heading text-2xl uppercase">Nova campanha</DialogTitle>
        <DialogDescription>
          Só recebe quem aceitou mensagens pelo canal escolhido. Você confere quantos antes de enviar.
        </DialogDescription>
      </DialogHeader>
      {errors.root && (
        <Alert variant="destructive">
          <AlertDescription>{errors.root.message}</AlertDescription>
        </Alert>
      )}

      <Field label="Nome da campanha" error={errors.name?.message} hint="Só a equipe vê.">
        <Input autoFocus {...form.register('name')} />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Controller
          control={form.control}
          name="channel"
          render={({ field }) => (
            <div className="grid gap-1.5">
              <Label htmlFor="campaign-channel">Canal</Label>
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="campaign-channel" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="EMAIL">E-mail</SelectItem>
                  <SelectItem value="WHATSAPP" disabled={!connected}>
                    WhatsApp{connected ? '' : ' (conecte nas configurações)'}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        />
        <Controller
          control={form.control}
          name="audienceKind"
          render={({ field }) => (
            <div className="grid gap-1.5">
              <Label htmlFor="campaign-audience">Público</Label>
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="campaign-audience" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(AUDIENCES).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        />
      </div>

      {audienceKind === 'birthday-month' && (
        <Controller
          control={form.control}
          name="month"
          render={({ field }) => (
            <div className="grid gap-1.5">
              <Label htmlFor="campaign-month">Mês do aniversário</Label>
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="campaign-month" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MONTHS.map((name, index) => (
                    <SelectItem key={name} value={String(index + 1)}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        />
      )}
      {audienceKind === 'service' && (
        <Controller
          control={form.control}
          name="serviceId"
          render={({ field }) => (
            <div className="grid gap-1.5">
              <Label htmlFor="campaign-service">Serviço</Label>
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger
                  id="campaign-service"
                  className="w-full"
                  aria-invalid={Boolean(errors.serviceId)}
                >
                  <SelectValue placeholder="Escolha o serviço" />
                </SelectTrigger>
                <SelectContent>
                  {(services.data ?? []).map((service) => (
                    <SelectItem key={service.id} value={service.id}>
                      {service.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.serviceId && (
                <p role="alert" className="text-destructive text-xs font-medium">
                  {errors.serviceId.message}
                </p>
              )}
            </div>
          )}
        />
      )}
      {(audienceKind === 'inactive' || audienceKind === 'service') && (
        <Field
          label={audienceKind === 'inactive' ? 'Sem visita há pelo menos (dias)' : 'Nos últimos (dias)'}
          error={errors.days?.message}
        >
          <Input type="number" min={1} max={730} {...form.register('days')} />
        </Field>
      )}

      {channel === 'EMAIL' ? (
        <>
          <Field label="Assunto" error={errors.subject?.message}>
            <Input maxLength={150} {...form.register('subject')} />
          </Field>
          <Field
            label="Texto"
            error={errors.body?.message}
            hint="Use {nome} para o primeiro nome e {barbearia} para o nome da barbearia. O e-mail sai com um rodapé dizendo por que o cliente recebe."
          >
            <Textarea rows={5} maxLength={2000} {...form.register('body')} />
          </Field>
        </>
      ) : templates.isLoading ? (
        <p className="text-muted-foreground text-sm">Carregando modelos…</p>
      ) : templates.error ? (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage(templates.error)}</AlertDescription>
        </Alert>
      ) : (
        <Controller
          control={form.control}
          name="template"
          render={({ field }) => (
            <div className="grid gap-1.5">
              <TemplateFields
                id="campaign-template"
                templates={templates.data ?? []}
                value={field.value}
                onChange={field.onChange}
                barbershopName={barbershop.data?.name ?? 'sua barbearia'}
              />
              {errors.template && (
                <p role="alert" className="text-destructive text-xs font-medium">
                  {errors.template.message}
                </p>
              )}
            </div>
          )}
        />
      )}

      {validPreview && (
        <Alert>
          <Users aria-hidden />
          <AlertDescription>
            <p className="text-foreground font-medium">
              {validPreview.recipients === 1
                ? '1 cliente vai receber'
                : `${validPreview.recipients} clientes vão receber`}{' '}
              por {channelLabel}.
            </p>
            <p className="text-xs">
              {describeAudience(toAudience({ audienceKind, days, month, serviceId }), services.data ?? [])}:{' '}
              {validPreview.matched} {validPreview.matched === 1 ? 'cliente' : 'clientes'}; os demais não
              aceitaram mensagens por {channelLabel} ou não têm contato nele.
            </p>
            {validPreview.sample.length > 0 && (
              <p className="text-xs">
                Entre eles: {validPreview.sample.map((client) => client.name).join(', ')}
                {validPreview.recipients > validPreview.sample.length ? '…' : '.'}
              </p>
            )}
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          variant={validPreview ? 'outline' : 'default'}
          disabled={previewCampaign.isPending}
        >
          <Users aria-hidden /> {validPreview ? 'Atualizar prévia' : 'Ver quem recebe'}
        </Button>
        {validPreview && validPreview.recipients > 0 && (
          <Button type="button" onClick={onSend} disabled={isSubmitting || create.isPending}>
            <Send aria-hidden />
            Enviar para {validPreview.recipients} {validPreview.recipients === 1 ? 'cliente' : 'clientes'}
          </Button>
        )}
      </div>
    </form>
  );
}
