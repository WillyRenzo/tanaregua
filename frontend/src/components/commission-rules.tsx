'use client';

import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Field } from '@/components/form/field';
import { MoneyInput } from '@/components/money-input';
import { EmptyState, ErrorState, LoadingRows } from '@/components/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { errorMessage } from '@/lib/api/errors';
import { formatMoney, formatPercent } from '@/lib/format';
import { zodResolver } from '@/lib/forms/zod-resolver';
import {
  useCommissionRules,
  useDeleteCommissionRule,
  useStaff,
  useUpsertCommissionRule,
  type CommissionRule,
} from '@/lib/queries';

/**
 * Regras de comissão de serviços ou de produtos (business-rules §4).
 * - Serviço: profissional + serviço > serviço > padrão do profissional.
 * - Produto: profissional + produto > produto. O padrão do profissional não vale para
 *   produto, então aqui o produto é sempre obrigatório.
 */
export type CommissionTarget = 'service' | 'product';

const COPY = {
  service: {
    title: 'Regras de comissão',
    hint: 'Vale a mais específica: profissional + serviço, depois serviço, depois profissional.',
    empty: 'Sem regra, o atendimento não gera comissão.',
    column: 'Serviço',
    any: 'Qualquer serviço',
    unit: 'Valor por atendimento',
  },
  product: {
    title: 'Comissões de produtos',
    hint: 'Vale a mais específica: profissional + produto, depois produto. O padrão do profissional não vale para produtos, e venda de balcão não gera comissão.',
    empty: 'Sem regra, a venda de produto não gera comissão.',
    column: 'Produto',
    any: 'Escolha',
    unit: 'Valor por venda',
  },
} as const;

const ANY = '__any__';

export function CommissionRules({
  target,
  items,
}: {
  target: CommissionTarget;
  items: { id: string; name: string }[];
}) {
  const rules = useCommissionRules();
  const staff = useStaff();
  const remove = useDeleteCommissionRule();
  const [editing, setEditing] = useState<CommissionRule | 'new' | null>(null);
  const copy = COPY[target];
  const targetId = (rule: CommissionRule) => (target === 'service' ? rule.serviceId : rule.productId);
  // Cada tela mostra só as regras do seu tipo; o padrão do profissional fica com os serviços.
  const visible = (rules.data ?? []).filter((rule) =>
    target === 'service' ? rule.productId === null : rule.productId !== null,
  );

  const itemName = (id: string | null) =>
    id ? (items.find((item) => item.id === id)?.name ?? '—') : copy.any;
  const staffName = (id: string | null) =>
    id ? (staff.data?.find((member) => member.id === id)?.name ?? '—') : 'Qualquer profissional';

  return (
    <section className="mt-12" aria-labelledby={`commission-title-${target}`}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id={`commission-title-${target}`} className="text-2xl font-bold">
            {copy.title}
          </h2>
          <p className="text-muted-foreground text-sm">{copy.hint}</p>
        </div>
        <Button variant="outline" onClick={() => setEditing('new')}>
          <Plus aria-hidden /> Nova regra
        </Button>
      </div>

      {rules.isLoading ? (
        <LoadingRows rows={3} />
      ) : rules.error ? (
        <ErrorState error={rules.error} onRetry={() => rules.refetch()} />
      ) : visible.length === 0 ? (
        <EmptyState title="Sem regras">{copy.empty}</EmptyState>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Profissional</TableHead>
              <TableHead>{copy.column}</TableHead>
              <TableHead className="text-right">Comissão</TableHead>
              <TableHead className="w-24">
                <span className="sr-only">Ações</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((rule) => (
              <TableRow key={rule.id}>
                <TableCell>{staffName(rule.membershipId)}</TableCell>
                <TableCell>{itemName(targetId(rule))}</TableCell>
                <TableCell className="text-right font-medium">
                  {rule.type === 'PERCENT' ? formatPercent(rule.value) : formatMoney(rule.value)}
                </TableCell>
                <TableCell className="flex justify-end gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Editar regra"
                    onClick={() => setEditing(rule)}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Remover regra"
                    disabled={remove.isPending}
                    onClick={() =>
                      remove.mutate(rule.id, { onError: (error) => toast.error(errorMessage(error)) })
                    }
                  >
                    <Trash2 />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          {editing !== null && (
            <RuleForm
              target={target}
              rule={editing === 'new' ? undefined : editing}
              items={items}
              staff={(staff.data ?? []).filter((member) => member.isProfessional)}
              onDone={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

const ruleSchema = z
  .object({
    target: z.enum(['service', 'product']),
    membershipId: z.string(),
    itemId: z.string(),
    type: z.enum(['PERCENT', 'FIXED']),
    percent: z.string(),
    fixedCents: z.number().nullable(),
  })
  .refine((rule) => rule.target === 'service' || rule.itemId !== ANY, {
    path: ['itemId'],
    message: 'Escolha o produto.',
  })
  .refine((rule) => rule.membershipId !== ANY || rule.itemId !== ANY, {
    path: ['itemId'],
    message: 'Escolha o profissional, o serviço ou ambos.',
  })
  .refine((rule) => rule.type !== 'PERCENT' || /^\d{1,3}([.,]\d{1,2})?$/.test(rule.percent), {
    path: ['percent'],
    message: 'Informe um percentual entre 0 e 100.',
  })
  .refine((rule) => rule.type !== 'FIXED' || rule.fixedCents !== null, {
    path: ['fixedCents'],
    message: 'Informe o valor.',
  });

function RuleForm({
  target,
  rule,
  items,
  staff,
  onDone,
}: {
  target: CommissionTarget;
  rule?: CommissionRule;
  items: { id: string; name: string }[];
  staff: { id: string; name: string }[];
  onDone: () => void;
}) {
  const upsert = useUpsertCommissionRule();
  const copy = COPY[target];
  const form = useForm({
    resolver: zodResolver(ruleSchema),
    defaultValues: {
      target,
      membershipId: rule?.membershipId ?? ANY,
      itemId: (target === 'service' ? rule?.serviceId : rule?.productId) ?? ANY,
      type: rule?.type ?? 'PERCENT',
      percent: rule?.type === 'PERCENT' ? String(rule.value / 100).replace('.', ',') : '',
      fixedCents: rule?.type === 'FIXED' ? rule.value : null,
    },
  });
  const { errors, isSubmitting } = form.formState;
  const type = useWatch({ control: form.control, name: 'type' });

  const onSubmit = form.handleSubmit(async (values) => {
    // Percentual vira basis points: 40% = 4000 (sem float no domínio).
    const value =
      values.type === 'PERCENT'
        ? Math.round(Number(values.percent.replace(',', '.')) * 100)
        : values.fixedCents!;
    if (values.type === 'PERCENT' && value > 10_000) {
      form.setError('percent', { message: 'Máximo de 100%.' });
      return;
    }
    const itemId = values.itemId === ANY ? null : values.itemId;
    try {
      await upsert.mutateAsync({
        membershipId: values.membershipId === ANY ? null : values.membershipId,
        serviceId: target === 'service' ? itemId : null,
        productId: target === 'product' ? itemId : null,
        type: values.type,
        value,
      });
      toast.success('Regra salva.');
      onDone();
    } catch (error) {
      form.setError('root', { message: errorMessage(error) });
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle className="font-heading text-2xl uppercase">{copy.title}</DialogTitle>
        <DialogDescription>A comissão é calculada e congelada quando a comanda é fechada.</DialogDescription>
      </DialogHeader>
      {errors.root && (
        <Alert variant="destructive">
          <AlertDescription>{errors.root.message}</AlertDescription>
        </Alert>
      )}
      <Controller
        control={form.control}
        name="membershipId"
        render={({ field }) => (
          <Field label="Profissional">
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Qualquer profissional</SelectItem>
                {staff.map((member) => (
                  <SelectItem key={member.id} value={member.id}>
                    {member.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
      />
      <Controller
        control={form.control}
        name="itemId"
        render={({ field }) => (
          <Field label={copy.column} error={errors.itemId?.message}>
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>{copy.any}</SelectItem>
                {items.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
      />
      <Controller
        control={form.control}
        name="type"
        render={({ field }) => (
          <Field label="Tipo">
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PERCENT">Percentual do valor</SelectItem>
                <SelectItem value="FIXED">Valor fixo</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        )}
      />
      {type === 'PERCENT' ? (
        <Field label="Percentual (%)" error={errors.percent?.message}>
          <Input inputMode="decimal" placeholder="40" {...form.register('percent')} />
        </Field>
      ) : (
        <Controller
          control={form.control}
          name="fixedCents"
          render={({ field }) => (
            <Field label={copy.unit} error={errors.fixedCents?.message}>
              <MoneyInput value={field.value} onChange={field.onChange} />
            </Field>
          )}
        />
      )}
      <Button type="submit" disabled={isSubmitting}>
        Salvar regra
      </Button>
    </form>
  );
}
