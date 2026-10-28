'use client';

import { useState } from 'react';
import { CircleCheck, Unplug } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Field } from '@/components/form/field';
import { ErrorState, LoadingRows } from '@/components/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { errorMessage } from '@/lib/api/errors';
import { zodResolver } from '@/lib/forms/zod-resolver';
import {
  useBarbershop,
  useBirthdaySettings,
  useConnectWhatsApp,
  useDisconnectWhatsApp,
  useUpdateBirthdaySettings,
  useWhatsApp,
  useWhatsAppTemplates,
  type BirthdaySettings,
  type TemplateConfig,
} from '@/lib/queries';
import { TemplateFields } from './template-fields';

/** Conexão do WhatsApp e mensagem automática de aniversário (só quem configura a barbearia). */
export function MessagingSettings() {
  return (
    <div className="grid gap-10">
      <WhatsAppConnection />
      <BirthdaySettingsSection />
    </div>
  );
}

const metaId = z
  .string()
  .trim()
  .regex(/^\d{5,30}$/, 'Use o ID numérico do painel da Meta.');
const connectSchema = z.object({
  phoneNumberId: metaId,
  businessAccountId: metaId,
  accessToken: z.string().trim().min(20, 'Cole o token de acesso completo.'),
});

function WhatsAppConnection() {
  const whatsapp = useWhatsApp();
  const connect = useConnectWhatsApp();
  const disconnect = useDisconnectWhatsApp();
  const [replacing, setReplacing] = useState(false);
  const form = useForm({
    resolver: zodResolver(connectSchema),
    defaultValues: { phoneNumberId: '', businessAccountId: '', accessToken: '' },
  });
  const { errors, isSubmitting } = form.formState;
  const connection = whatsapp.data?.connection;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await connect.mutateAsync(values);
      toast.success('WhatsApp conectado.');
      form.reset();
      setReplacing(false);
    } catch (error) {
      form.setError('root', { message: errorMessage(error) });
    }
  });

  const runDisconnect = async () => {
    try {
      await disconnect.mutateAsync();
      toast.success('WhatsApp desconectado. O aniversário passa a sair só por e-mail.');
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <section aria-labelledby="whatsapp" className="grid max-w-lg gap-5">
      <div>
        <h2 id="whatsapp" className="text-2xl font-bold">
          WhatsApp
        </h2>
        <p className="text-muted-foreground text-sm">
          Conecte a conta do WhatsApp Business da barbearia (Cloud API da Meta). As mensagens saem do número
          dela, por modelos aprovados pela Meta, que cobra por mensagem enviada.
        </p>
      </div>

      {whatsapp.isLoading ? (
        <LoadingRows rows={2} />
      ) : whatsapp.error ? (
        <ErrorState error={whatsapp.error} onRetry={() => whatsapp.refetch()} />
      ) : connection && !replacing ? (
        <div className="grid gap-3">
          <Alert>
            <CircleCheck aria-hidden />
            <AlertDescription>
              <p className="text-foreground font-medium">
                Conectado: {connection.displayPhoneNumber} ({connection.verifiedName})
              </p>
              <p className="text-xs">ID do número {connection.phoneNumberId}</p>
            </AlertDescription>
          </Alert>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setReplacing(true)}>
              Trocar conta
            </Button>
            <Button
              variant="ghost"
              className="text-destructive"
              onClick={runDisconnect}
              disabled={disconnect.isPending}
            >
              <Unplug aria-hidden /> Desconectar
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          {errors.root && (
            <Alert variant="destructive">
              <AlertDescription>{errors.root.message}</AlertDescription>
            </Alert>
          )}
          <Field
            label="ID do número de telefone"
            error={errors.phoneNumberId?.message}
            hint="No painel de desenvolvedores da Meta: WhatsApp › Configuração da API."
          >
            <Input inputMode="numeric" autoComplete="off" {...form.register('phoneNumberId')} />
          </Field>
          <Field label="ID da conta do WhatsApp Business" error={errors.businessAccountId?.message}>
            <Input inputMode="numeric" autoComplete="off" {...form.register('businessAccountId')} />
          </Field>
          <Field
            label="Token de acesso"
            error={errors.accessToken?.message}
            hint="Use um token permanente de usuário do sistema. Ele fica guardado cifrado e não é mostrado de novo."
          >
            <Input type="password" autoComplete="off" {...form.register('accessToken')} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Conferindo na Meta…' : 'Conectar'}
            </Button>
            {replacing && (
              <Button type="button" variant="ghost" onClick={() => setReplacing(false)}>
                Cancelar
              </Button>
            )}
          </div>
        </form>
      )}
    </section>
  );
}

function BirthdaySettingsSection() {
  const settings = useBirthdaySettings();
  return (
    <section aria-labelledby="aniversario" className="grid max-w-lg gap-5">
      <div>
        <h2 id="aniversario" className="text-2xl font-bold">
          Mensagem de aniversário
        </h2>
        <p className="text-muted-foreground text-sm">
          Sai sozinha no dia do aniversário, só para quem aceitou receber. Pelo WhatsApp quando o cliente
          aceitou esse canal e há um modelo escolhido; senão, por e-mail.
        </p>
      </div>
      {settings.isLoading ? (
        <LoadingRows rows={3} />
      ) : settings.error ? (
        <ErrorState error={settings.error} onRetry={() => settings.refetch()} />
      ) : (
        <BirthdayForm settings={settings.data!} />
      )}
    </section>
  );
}

function BirthdayForm({ settings }: { settings: BirthdaySettings }) {
  const update = useUpdateBirthdaySettings();
  const barbershop = useBarbershop();
  const templates = useWhatsAppTemplates(settings.whatsappConnected);
  const [enabled, setEnabled] = useState(settings.enabled);
  const [emailText, setEmailText] = useState(settings.emailText ?? '');
  const [template, setTemplate] = useState<TemplateConfig | null>(settings.whatsappTemplate);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    try {
      await update.mutateAsync({
        enabled,
        emailText: emailText.trim() ? emailText.trim() : null,
        whatsappTemplate: settings.whatsappConnected ? template : null,
      });
      toast.success('Mensagem de aniversário salva.');
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  return (
    <div className="grid gap-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="flex items-center gap-3">
        <Switch id="birthday-enabled" checked={enabled} onCheckedChange={setEnabled} />
        <Label htmlFor="birthday-enabled" className="font-normal">
          Enviar mensagem no aniversário (a partir das {settings.sendHour}h)
        </Label>
      </div>
      <Field
        label="Texto do e-mail"
        hint="Use {nome} para o primeiro nome do cliente e {barbearia} para o nome da barbearia. Em branco, vale o texto padrão."
      >
        <Textarea
          rows={4}
          maxLength={1000}
          value={emailText}
          placeholder={settings.defaultEmailText}
          onChange={(event) => setEmailText(event.target.value)}
        />
      </Field>
      {settings.whatsappConnected ? (
        templates.isLoading ? (
          <LoadingRows rows={1} label="Carregando modelos" />
        ) : templates.error ? (
          <ErrorState error={templates.error} onRetry={() => templates.refetch()} />
        ) : (
          <TemplateFields
            id="birthday-template"
            templates={templates.data ?? []}
            value={template}
            onChange={setTemplate}
            barbershopName={barbershop.data?.name ?? 'sua barbearia'}
            noneLabel="Nenhum (só e-mail)"
          />
        )
      ) : (
        <p className="text-muted-foreground text-sm">
          Conecte o WhatsApp acima para também felicitar por lá.
        </p>
      )}
      <Button className="justify-self-start" onClick={save} disabled={update.isPending}>
        Salvar
      </Button>
    </div>
  );
}
