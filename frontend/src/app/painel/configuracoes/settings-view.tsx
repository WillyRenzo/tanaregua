'use client';

import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Field } from '@/components/form/field';
import { ErrorState, LoadingRows, PageHeader } from '@/components/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { errorMessage } from '@/lib/api/errors';
import { zodResolver } from '@/lib/forms/zod-resolver';
import { useBarbershop, useUpdateBarbershop, type BarbershopSettings } from '@/lib/queries';
import { BrandSettings } from './brand-settings';
import { PlanSettings } from './plan-settings';

/** Fusos do Brasil (o Acre e o Amazonas ocidental têm fuso próprio). */
const TIMEZONES = [
  ['America/Sao_Paulo', 'Brasília (SP, RJ, MG, Sul, Nordeste…)'],
  ['America/Manaus', 'Amazonas, Mato Grosso, Rondônia, Roraima'],
  ['America/Cuiaba', 'Cuiabá'],
  ['America/Rio_Branco', 'Acre'],
  ['America/Noronha', 'Fernando de Noronha'],
] as const;

export function SettingsView() {
  const barbershop = useBarbershop();
  if (barbershop.isLoading) return <LoadingRows />;
  if (barbershop.error) return <ErrorState error={barbershop.error} onRetry={() => barbershop.refetch()} />;
  return (
    <div className="grid gap-10">
      <SettingsForm settings={barbershop.data!} />
      <BrandSettings settings={barbershop.data!} />
      <PlanSettings />
    </div>
  );
}

const schema = z.object({
  name: z.string().trim().min(2, 'Informe o nome.'),
  timezone: z.string(),
  cancellationHours: z.coerce.number<string>().min(0).max(168, 'Máximo de 7 dias.'),
  rescheduleHours: z.coerce.number<string>().min(0).max(168, 'Máximo de 7 dias.'),
  bufferMinutes: z.coerce.number<string>().int().min(0).max(120, 'Máximo de 120 minutos.'),
});

function SettingsForm({ settings }: { settings: BarbershopSettings }) {
  const update = useUpdateBarbershop();
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      name: settings.name,
      timezone: settings.timezone,
      cancellationHours: String(settings.cancellationMinNoticeMinutes / 60),
      rescheduleHours: String(settings.rescheduleMinNoticeMinutes / 60),
      bufferMinutes: String(settings.bufferMinutes),
    },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await update.mutateAsync({
        name: values.name,
        timezone: values.timezone,
        cancellationMinNoticeMinutes: Math.round(values.cancellationHours * 60),
        rescheduleMinNoticeMinutes: Math.round(values.rescheduleHours * 60),
        bufferMinutes: values.bufferMinutes,
      });
      toast.success('Configurações salvas.');
    } catch (error) {
      form.setError('root', { message: errorMessage(error) });
    }
  });

  return (
    <>
      <PageHeader title="Configurações" />
      <form onSubmit={onSubmit} noValidate className="grid max-w-lg gap-5">
        {errors.root && (
          <Alert variant="destructive">
            <AlertDescription>{errors.root.message}</AlertDescription>
          </Alert>
        )}
        <Field label="Nome da barbearia" error={errors.name?.message}>
          <Input {...form.register('name')} />
        </Field>
        <div className="grid gap-1.5">
          <p className="text-sm font-medium">Página de agendamento</p>
          <Link
            href={`/${settings.slug}`}
            target="_blank"
            className="text-primary inline-flex items-center gap-1 text-sm underline-offset-4 hover:underline"
          >
            tanaregua.app/{settings.slug} <ExternalLink aria-hidden className="size-3.5" />
          </Link>
        </div>
        <Controller
          control={form.control}
          name="timezone"
          render={({ field }) => (
            <Field label="Fuso horário" hint="Todos os horários da agenda são exibidos neste fuso.">
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIMEZONES.map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
        />
        <Field
          label="Antecedência mínima para o cliente cancelar online (horas)"
          error={errors.cancellationHours?.message}
          hint="Depois desse prazo, o cliente precisa falar com a barbearia."
        >
          <Input type="number" min={0} max={168} step={0.5} {...form.register('cancellationHours')} />
        </Field>
        <Field
          label="Antecedência mínima para o cliente reagendar online (horas)"
          error={errors.rescheduleHours?.message}
          hint="Padrão de 24 horas. Depois desse prazo, só a barbearia reagenda."
        >
          <Input type="number" min={0} max={168} step={0.5} {...form.register('rescheduleHours')} />
        </Field>
        <Field
          label="Intervalo entre atendimentos (minutos)"
          error={errors.bufferMinutes?.message}
          hint="Tempo de limpeza/preparo reservado depois de cada atendimento."
        >
          <Input type="number" min={0} max={120} step={5} {...form.register('bufferMinutes')} />
        </Field>
        <Button type="submit" disabled={isSubmitting} className="w-fit">
          Salvar
        </Button>
      </form>
    </>
  );
}
