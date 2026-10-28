'use client';

import { useState } from 'react';
import { Plus, Search, ShieldOff, TriangleAlert } from 'lucide-react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Field } from '@/components/form/field';
import { EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { errorMessage } from '@/lib/api/errors';
import { formatDate, formatDateLong, formatPhone, formatTime } from '@/lib/format';
import { zodResolver } from '@/lib/forms/zod-resolver';
import { can } from '@/lib/permissions';
import {
  useAnonymizeClient,
  useBarbershop,
  useClientNoShows,
  useClients,
  useCreateClient,
  useUpdateClient,
  type Client,
} from '@/lib/queries';
import { useAuthenticatedSession } from '@/lib/session/use-session';
import { useDebouncedValue } from '@/lib/use-debounced-value';

export function ClientsView() {
  const session = useAuthenticatedSession();
  const canManage = can(session, 'clients:manage');
  const [search, setSearch] = useState('');
  const debounced = useDebouncedValue(search.trim());
  const clients = useClients(debounced);
  const [editing, setEditing] = useState<Client | 'new' | null>(null);
  const rows = clients.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <>
      <PageHeader
        title="Clientes"
        actions={
          canManage && (
            <Button onClick={() => setEditing('new')}>
              <Plus aria-hidden /> Novo cliente
            </Button>
          )
        }
      />

      <div className="relative mb-4 max-w-md">
        <Label htmlFor="client-search" className="sr-only">
          Buscar cliente
        </Label>
        <Search
          aria-hidden
          className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2"
        />
        <Input
          id="client-search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar por nome ou telefone"
          className="pl-9"
        />
      </div>

      {clients.isLoading ? (
        <LoadingRows />
      ) : clients.error ? (
        <ErrorState error={clients.error} onRetry={() => clients.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title={debounced ? 'Nada encontrado' : 'Nenhum cliente ainda'}>
          {debounced
            ? 'Tente outro nome ou parte do telefone.'
            : 'Clientes aparecem aqui ao serem cadastrados ou agendarem online.'}
        </EmptyState>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Telefone</TableHead>
                <TableHead className="hidden sm:table-cell">Aniversário</TableHead>
                <TableHead className="hidden sm:table-cell">Marketing</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((client) => (
                <TableRow key={client.id}>
                  <TableCell>
                    {canManage ? (
                      <button
                        type="button"
                        className="text-left font-medium underline-offset-4 hover:underline"
                        onClick={() => setEditing(client)}
                      >
                        {client.name}
                      </button>
                    ) : (
                      <span className="font-medium">{client.name}</span>
                    )}
                    {client.hasAccount && (
                      <Badge variant="secondary" className="ml-2">
                        Agenda online
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>{formatPhone(client.phone)}</TableCell>
                  <TableCell className="hidden sm:table-cell">
                    {client.birthDate
                      ? client.birthDate.slice(8, 10) + '/' + client.birthDate.slice(5, 7)
                      : '—'}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">{consentSummary(client)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {clients.hasNextPage && (
            <Button
              variant="outline"
              className="mt-4"
              onClick={() => clients.fetchNextPage()}
              disabled={clients.isFetchingNextPage}
            >
              {clients.isFetchingNextPage ? 'Carregando…' : 'Carregar mais'}
            </Button>
          )}
        </>
      )}

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          {editing !== null && (
            <ClientForm client={editing === 'new' ? undefined : editing} onDone={() => setEditing(null)} />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Canais com consentimento, para a listagem (business-rules §9). */
function consentSummary(client: Client): string {
  const channels = [client.consents.email && 'E-mail', client.consents.whatsapp && 'WhatsApp'].filter(
    Boolean,
  );
  return channels.length > 0 ? channels.join(', ') : 'Não';
}

const clientSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome.'),
  phone: z
    .string()
    .refine((value) => value === '' || value.replace(/\D/g, '').length >= 10, 'Telefone com DDD.'),
  email: z.union([z.literal(''), z.email('E-mail inválido.')]),
  birthDate: z.string(),
  notes: z.string().max(1000),
  consentEmail: z.boolean(),
  consentWhatsapp: z.boolean(),
});

function ClientForm({ client, onDone }: { client?: Client; onDone: () => void }) {
  const create = useCreateClient();
  const update = useUpdateClient();
  const anonymize = useAnonymizeClient();
  const [confirmingAnonymize, setConfirmingAnonymize] = useState(false);
  const timezone = useBarbershop().data?.timezone;
  const form = useForm({
    resolver: zodResolver(clientSchema),
    defaultValues: {
      name: client?.name ?? '',
      phone: client?.phone ?? '',
      email: client?.email ?? '',
      birthDate: client?.birthDate ?? '',
      notes: client?.notes ?? '',
      consentEmail: Boolean(client?.consents.email),
      consentWhatsapp: Boolean(client?.consents.whatsapp),
    },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    const body = {
      name: values.name,
      phone: values.phone || null,
      email: values.email || null,
      birthDate: values.birthDate || null,
      notes: values.notes || null,
      // A API grava a data da concessão de cada canal e mantém a original se já havia (LGPD).
      consents: { email: values.consentEmail, whatsapp: values.consentWhatsapp },
    };
    try {
      if (client) await update.mutateAsync({ id: client.id, ...body });
      else await create.mutateAsync(body);
      toast.success('Cliente salvo.');
      onDone();
    } catch (error) {
      form.setError('root', { message: errorMessage(error) });
    }
  });

  const runAnonymize = async () => {
    try {
      await anonymize.mutateAsync(client!.id);
      toast.success('Dados pessoais removidos. O histórico foi mantido sem identificação.');
      onDone();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  if (client?.anonymized) {
    return (
      <DialogHeader>
        <DialogTitle className="font-heading text-2xl uppercase">Cliente anonimizado</DialogTitle>
        <DialogDescription>Os dados pessoais foram removidos a pedido do cliente (LGPD).</DialogDescription>
      </DialogHeader>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle className="font-heading text-2xl uppercase">
          {client ? 'Editar cliente' : 'Novo cliente'}
        </DialogTitle>
        <DialogDescription>
          Colete só o necessário. Aniversário e contato são dados pessoais.
        </DialogDescription>
      </DialogHeader>
      {errors.root && (
        <Alert variant="destructive">
          <AlertDescription>{errors.root.message}</AlertDescription>
        </Alert>
      )}
      {client && <NoShowHistory clientId={client.id} />}
      <Field label="Nome" error={errors.name?.message}>
        <Input autoFocus {...form.register('name')} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Telefone" error={errors.phone?.message}>
          <Input inputMode="tel" placeholder="(11) 99999-9999" {...form.register('phone')} />
        </Field>
        <Field label="Aniversário" error={errors.birthDate?.message}>
          <Input type="date" {...form.register('birthDate')} />
        </Field>
      </div>
      <Field label="E-mail" error={errors.email?.message} hint="Usado para confirmar agendamentos.">
        <Input type="email" {...form.register('email')} />
      </Field>
      <fieldset className="grid gap-2">
        <legend className="mb-1.5 text-sm font-medium">Aceita mensagens de aniversário e promoções?</legend>
        {(
          [
            ['consentEmail', 'Por e-mail', client?.consents.email],
            ['consentWhatsapp', 'Por WhatsApp', client?.consents.whatsapp],
          ] as const
        ).map(([name, label, grantedAt]) => (
          <div key={name} className="flex items-center gap-3">
            <Controller
              control={form.control}
              name={name}
              render={({ field }) => (
                <Checkbox
                  id={`client-${name}`}
                  checked={field.value}
                  onCheckedChange={(checked) => field.onChange(checked === true)}
                />
              )}
            />
            <Label htmlFor={`client-${name}`} className="font-normal">
              {label}
              {grantedAt && timezone && (
                <span className="text-muted-foreground text-xs">desde {formatDate(grantedAt, timezone)}</span>
              )}
            </Label>
          </div>
        ))}
        <p className="text-muted-foreground text-xs">
          Só marque o canal que o cliente aceitou. Sem consentimento, o aniversário fica só como lembrete
          interno.
        </p>
      </fieldset>
      <Field label="Observações" error={errors.notes?.message}>
        <Textarea rows={2} {...form.register('notes')} />
      </Field>
      <Button type="submit" disabled={isSubmitting}>
        Salvar
      </Button>

      {client && (
        <div className="border-border grid gap-2 border-t pt-4">
          {confirmingAnonymize ? (
            <>
              <p className="text-sm">
                Remove nome, contato e aniversário de <strong>{client.name}</strong> definitivamente. O
                histórico de atendimentos e o financeiro continuam, sem identificação.
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="destructive"
                  onClick={runAnonymize}
                  disabled={anonymize.isPending}
                >
                  Anonimizar definitivamente
                </Button>
                <Button type="button" variant="ghost" onClick={() => setConfirmingAnonymize(false)}>
                  Voltar
                </Button>
              </div>
            </>
          ) : (
            <Button
              type="button"
              variant="ghost"
              className="text-destructive justify-start"
              onClick={() => setConfirmingAnonymize(true)}
            >
              <ShieldOff aria-hidden /> Excluir dados pessoais (pedido do cliente)
            </Button>
          )}
        </div>
      )}
    </form>
  );
}

/** Faltas sem justificativa (business-rules §2): informação para a equipe, não bloqueia nada. */
function NoShowHistory({ clientId }: { clientId: string }) {
  const noShows = useClientNoShows(clientId);
  const barbershop = useBarbershop();
  const timezone = barbershop.data?.timezone;
  if (!noShows.data || noShows.data.length === 0 || !timezone) return null;

  const total = noShows.data.length;
  return (
    <Alert>
      <TriangleAlert aria-hidden />
      <AlertDescription>
        <p className="text-foreground font-medium">
          {total === 1 ? '1 falta sem justificativa' : `${total} faltas sem justificativa`}
        </p>
        <ul className="mt-1 grid gap-0.5 text-xs">
          {noShows.data.slice(0, 5).map((noShow) => (
            <li key={noShow.appointmentId}>
              {formatDateLong(
                new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date(noShow.startsAt)),
                timezone,
              )}{' '}
              às {formatTime(noShow.startsAt, timezone)} · {noShow.services.join(', ')} com{' '}
              {noShow.professional.name}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}
