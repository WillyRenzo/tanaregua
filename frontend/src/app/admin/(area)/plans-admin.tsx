'use client';

import { Check } from 'lucide-react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Field } from '@/components/form/field';
import { MoneyInput } from '@/components/money-input';
import { ErrorState, LoadingRows, PageHeader } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { errorMessage } from '@/lib/api/errors';
import { formatMoney, formatPercent } from '@/lib/format';
import { zodResolver } from '@/lib/forms/zod-resolver';
import { FEATURE_LABELS, yearlyDiscount, type Plan } from '@/lib/plans';
import { usePlatformPlans, useSetPlanPrices } from '@/lib/platform-queries';

/** Mesmos limites da API: em branco tira o plano de venda naquele ciclo. */
const priceSchema = z
  .number('Informe um valor em reais.')
  .int()
  .min(100, 'O mínimo é R$ 1,00.')
  .max(10_000_000, 'O máximo é R$ 100.000,00.')
  .nullable();

const schema = z.object({ monthlyCents: priceSchema, yearlyCents: priceSchema });

export function PlansAdmin() {
  const plans = usePlatformPlans();

  return (
    <>
      <PageHeader
        title="Planos e preços"
        description="O preço vale para as próximas contratações; quem já assina mantém o valor contratado."
      />
      {plans.isPending ? (
        <LoadingRows rows={3} label="Carregando os planos" />
      ) : plans.isError ? (
        <ErrorState error={plans.error} onRetry={() => void plans.refetch()} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {plans.data.map((plan) => (
            <PlanPricesCard key={plan.key} plan={plan} />
          ))}
        </div>
      )}
    </>
  );
}

function PlanPricesCard({ plan }: { plan: Plan }) {
  const setPrices = useSetPlanPrices();
  const form = useForm({ resolver: zodResolver(schema), defaultValues: plan.prices });
  const { errors, isDirty, isSubmitting } = form.formState;
  const [monthlyCents, yearlyCents] = useWatch({
    control: form.control,
    name: ['monthlyCents', 'yearlyCents'],
  });
  const discount = yearlyDiscount(monthlyCents, yearlyCents);

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const saved = await setPrices.mutateAsync({ key: plan.key, ...values });
      form.reset(saved.prices);
      toast.success(`Preços do plano ${plan.name} salvos.`);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  });

  const titleId = `plano-${plan.key}`;
  return (
    <Card role="region" aria-labelledby={titleId}>
      <CardHeader>
        <CardTitle id={titleId} className="text-2xl">
          {plan.name}
        </CardTitle>
        <CardDescription>
          {plan.prices.monthlyCents === null && plan.prices.yearlyCents === null
            ? 'Fora de venda: sem preço definido.'
            : [
                plan.prices.monthlyCents !== null && `${formatMoney(plan.prices.monthlyCents)}/mês`,
                plan.prices.yearlyCents !== null && `${formatMoney(plan.prices.yearlyCents)}/ano`,
              ]
                .filter(Boolean)
                .join(' · ')}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        <div>
          <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">Inclui</h3>
          <ul className="mt-2 grid gap-1 text-sm">
            <li className="flex items-center gap-2">
              <Check aria-hidden className="text-primary size-4" />
              Agenda, comanda, caixa, estoque, pacotes e campanhas
            </li>
            {plan.features.map((feature) => (
              <li key={feature} className="flex items-center gap-2">
                <Check aria-hidden className="text-primary size-4" />
                {FEATURE_LABELS[feature]}
              </li>
            ))}
          </ul>
        </div>

        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          <Controller
            control={form.control}
            name="monthlyCents"
            render={({ field }) => (
              <Field
                label="Preço mensal"
                hint="Em branco: não vende no mensal."
                error={errors.monthlyCents?.message}
              >
                <MoneyInput value={field.value} onChange={field.onChange} />
              </Field>
            )}
          />
          <Controller
            control={form.control}
            name="yearlyCents"
            render={({ field }) => (
              <Field label="Preço anual" hint={discountHint(discount)} error={errors.yearlyCents?.message}>
                <MoneyInput value={field.value} onChange={field.onChange} />
              </Field>
            )}
          />
          <Button type="submit" disabled={!isDirty || isSubmitting}>
            {isSubmitting ? 'Salvando…' : 'Salvar preços'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function discountHint(discount: number | null): string {
  if (discount === null) return 'Em branco: não vende no anual.';
  if (discount > 0) return `${formatPercent(discount)} mais barato que 12 mensalidades.`;
  if (discount < 0) return `Atenção: ${formatPercent(-discount)} mais caro que 12 mensalidades.`;
  return 'Igual a 12 mensalidades, sem desconto.';
}
