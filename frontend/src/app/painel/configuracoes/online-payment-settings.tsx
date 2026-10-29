'use client';

import { useState } from 'react';
import { CircleCheck, Unplug } from 'lucide-react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { FeatureGate } from '@/components/feature-gate';
import { Field } from '@/components/form/field';
import { ErrorState, LoadingRows } from '@/components/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { errorMessage } from '@/lib/api/errors';
import { zodResolver } from '@/lib/forms/zod-resolver';
import { can } from '@/lib/permissions';
import {
  useConnectPaymentAccount,
  useDisconnectPaymentAccount,
  useOnlinePayment,
  useUpdateOnlinePaymentSettings,
  type OnlinePayment,
  type OnlinePaymentSettings,
} from '@/lib/queries';
import { useSession } from '@/lib/session/use-session';

const MODE_LABELS: Record<OnlinePaymentSettings['mode'], string> = {
  OFF: 'Desligado: o cliente paga no balcão',
  OPTIONAL: 'Opcional: o cliente escolhe pagar agora ou no balcão',
  REQUIRED: 'Exigido: a reserva só se confirma depois do pagamento',
};

const AMOUNT_LABELS: Record<OnlinePaymentSettings['amount'], string> = {
  FULL: 'O valor total dos serviços',
  DEPOSIT: 'Um sinal (percentual do total)',
};

/**
 * Pagamento da reserva online (business-rules §5): a barbearia conecta a conta dela no gateway
 * (o dinheiro cai direto nela) e escolhe como o cliente paga. Só quem configura a barbearia e
 * só nos planos com o recurso; a API revalida as duas coisas.
 */
export function OnlinePaymentSettingsSection() {
  const session = useSession();
  if (!can(session, 'barbershop:manage')) return null;
  return (
    <section aria-labelledby="pagamento-online" className="grid max-w-lg scroll-mt-6 gap-5" id="pagamento">
      <div>
        <h2 id="pagamento-online" className="text-2xl font-bold">
          Pagamento online
        </h2>
        <p className="text-muted-foreground text-sm">
          O cliente paga a reserva na página de agendamento, por Pix ou cartão. O dinheiro cai direto na conta
          da barbearia no serviço de pagamento, com as taxas dele.
        </p>
      </div>
      <FeatureGate feature="online-payment">
        <OnlinePaymentManager />
      </FeatureGate>
    </section>
  );
}

function OnlinePaymentManager() {
  const payment = useOnlinePayment();
  if (payment.isLoading) return <LoadingRows rows={2} />;
  if (payment.error) return <ErrorState error={payment.error} onRetry={() => payment.refetch()} />;
  const data = payment.data!;
  if (!data.available) {
    return (
      <p className="text-muted-foreground text-sm">
        O pagamento online ainda não está disponível. Fale com o suporte do TaNaRegua.
      </p>
    );
  }
  return (
    <div className="grid gap-8">
      <AccountConnection data={data} />
      {data.account && <PaymentSettingsForm key={data.account.connectedAt} settings={data.settings} />}
    </div>
  );
}

const connectSchema = z.object({
  accessToken: z.string().trim().min(16, 'Cole o access token completo.'),
  webhookSecret: z.string().trim().min(16, 'Cole a assinatura secreta completa.'),
});

function AccountConnection({ data }: { data: OnlinePayment }) {
  const connect = useConnectPaymentAccount();
  const disconnect = useDisconnectPaymentAccount();
  const [replacing, setReplacing] = useState(false);
  const form = useForm({
    resolver: zodResolver(connectSchema),
    defaultValues: { accessToken: '', webhookSecret: '' },
  });
  const { errors, isSubmitting } = form.formState;
  const account = data.account;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await connect.mutateAsync(values);
      toast.success('Conta de pagamento conectada.');
      form.reset();
      setReplacing(false);
    } catch (error) {
      form.setError('root', { message: errorMessage(error) });
    }
  });

  const runDisconnect = async () => {
    try {
      await disconnect.mutateAsync();
      toast.success('Conta desconectada. O pagamento online foi desligado.');
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  if (account && !replacing) {
    return (
      <div className="grid gap-3">
        <Alert>
          <CircleCheck aria-hidden />
          <AlertDescription>
            <p className="text-foreground font-medium">Conectada: {account.accountName}</p>
            <p className="text-xs">Conta {account.accountId}</p>
          </AlertDescription>
        </Alert>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setReplacing(true)}>
            Trocar credenciais
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
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      {errors.root && (
        <Alert variant="destructive">
          <AlertDescription>{errors.root.message}</AlertDescription>
        </Alert>
      )}
      <Field
        label="Access token de produção"
        error={errors.accessToken?.message}
        hint="Nas credenciais de produção da sua aplicação no serviço de pagamento. Fica guardado cifrado e não é mostrado de novo."
      >
        <Input type="password" autoComplete="off" {...form.register('accessToken')} />
      </Field>
      <Field
        label="Assinatura secreta das notificações"
        error={errors.webhookSecret?.message}
        hint="Confirma que os avisos de pagamento vieram mesmo do serviço de pagamento."
      >
        <Input type="password" autoComplete="off" {...form.register('webhookSecret')} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Conferindo a conta…' : 'Conectar'}
        </Button>
        {replacing && (
          <Button type="button" variant="ghost" onClick={() => setReplacing(false)}>
            Cancelar
          </Button>
        )}
      </div>
    </form>
  );
}

const settingsSchema = z
  .object({
    mode: z.enum(['OFF', 'OPTIONAL', 'REQUIRED']),
    amount: z.enum(['FULL', 'DEPOSIT']),
    depositPercent: z.string(),
  })
  .superRefine((values, ctx) => {
    if (values.amount !== 'DEPOSIT') return;
    const percent = Number(values.depositPercent.replace(',', '.'));
    if (!Number.isInteger(percent) || percent < 1 || percent > 99) {
      ctx.addIssue({
        code: 'custom',
        path: ['depositPercent'],
        message: 'Use um percentual inteiro de 1 a 99.',
      });
    }
  });

function PaymentSettingsForm({ settings }: { settings: OnlinePaymentSettings }) {
  const update = useUpdateOnlinePaymentSettings();
  const form = useForm({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      mode: settings.mode,
      amount: settings.amount,
      depositPercent: settings.depositBps ? String(settings.depositBps / 100) : '30',
    },
  });
  const { errors, isSubmitting } = form.formState;
  const amount = useWatch({ control: form.control, name: 'amount' });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await update.mutateAsync({
        mode: values.mode,
        amount: values.amount,
        // Percentual na tela, basis points na API (30% = 3000).
        depositBps: values.amount === 'DEPOSIT' ? Number(values.depositPercent) * 100 : null,
      });
      toast.success('Pagamento online atualizado.');
    } catch (error) {
      form.setError('root', { message: errorMessage(error) });
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      <h3 className="text-lg font-semibold">Como o cliente paga</h3>
      {errors.root && (
        <Alert variant="destructive">
          <AlertDescription>{errors.root.message}</AlertDescription>
        </Alert>
      )}
      <Controller
        control={form.control}
        name="mode"
        render={({ field }) => (
          <Field label="Pagamento na reserva online">
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(MODE_LABELS) as OnlinePaymentSettings['mode'][]).map((mode) => (
                  <SelectItem key={mode} value={mode}>
                    {MODE_LABELS[mode]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
      />
      <Controller
        control={form.control}
        name="amount"
        render={({ field }) => (
          <Field label="Valor cobrado online">
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(AMOUNT_LABELS) as OnlinePaymentSettings['amount'][]).map((value) => (
                  <SelectItem key={value} value={value}>
                    {AMOUNT_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
      />
      {amount === 'DEPOSIT' && (
        <Field
          label="Sinal (%)"
          error={errors.depositPercent?.message}
          hint="O resto é pago no balcão, no dia do atendimento."
        >
          <Input inputMode="numeric" className="max-w-32" {...form.register('depositPercent')} />
        </Field>
      )}
      <div>
        <Button type="submit" disabled={isSubmitting}>
          Salvar
        </Button>
      </div>
    </form>
  );
}
