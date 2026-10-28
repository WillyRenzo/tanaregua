'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { CHANNEL_LABEL, MessageStatusBadge } from '@/components/message-status';
import { EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatDate } from '@/lib/format';
import { can } from '@/lib/permissions';
import {
  useBarbershop,
  useBirthdays,
  useCampaign,
  useCampaigns,
  useServices,
  type Campaign,
} from '@/lib/queries';
import { useAuthenticatedSession } from '@/lib/session/use-session';
import { describeAudience, MONTHS } from './audience';
import { CampaignForm } from './campaign-form';
import { MessagingSettings } from './messaging-settings';

type Tab = 'birthdays' | 'campaigns' | 'settings';

/** Aniversários e campanhas (business-rules §9): sempre com consentimento do cliente por canal. */
export function CampaignsView() {
  const session = useAuthenticatedSession();
  const canCampaign = can(session, 'campaigns:manage');
  const canConfigure = can(session, 'barbershop:manage');
  const barbershop = useBarbershop();
  const [tab, setTab] = useState<Tab>('birthdays');
  const [creating, setCreating] = useState(false);
  const [openCampaign, setOpenCampaign] = useState<string | null>(null);

  const timezone = barbershop.data?.timezone;
  if (barbershop.isLoading) return <LoadingRows />;
  if (barbershop.error || !timezone) {
    return <ErrorState error={barbershop.error} onRetry={() => barbershop.refetch()} />;
  }
  const currentMonth = Number(
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date()).slice(5, 7),
  );

  return (
    <>
      <PageHeader
        title="Campanhas"
        description="Aniversários e mensagens para os clientes que aceitaram receber."
        actions={
          canCampaign && (
            <Button onClick={() => setCreating(true)}>
              <Plus aria-hidden /> Nova campanha
            </Button>
          )
        }
      />

      <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)}>
        <TabsList>
          <TabsTrigger value="birthdays">Aniversariantes</TabsTrigger>
          {canCampaign && <TabsTrigger value="campaigns">Campanhas</TabsTrigger>}
          {canConfigure && <TabsTrigger value="settings">WhatsApp e aniversário</TabsTrigger>}
        </TabsList>
        <TabsContent value="birthdays" className="pt-4">
          <Birthdays currentMonth={currentMonth} />
        </TabsContent>
        {canCampaign && (
          <TabsContent value="campaigns" className="pt-4">
            <CampaignList timezone={timezone} onOpen={setOpenCampaign} />
          </TabsContent>
        )}
        {canConfigure && (
          <TabsContent value="settings" className="pt-4">
            <MessagingSettings />
          </TabsContent>
        )}
      </Tabs>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          {creating && (
            <CampaignForm
              currentMonth={currentMonth}
              onDone={(id) => {
                setCreating(false);
                setTab('campaigns');
                setOpenCampaign(id);
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={openCampaign !== null} onOpenChange={(open) => !open && setOpenCampaign(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          {openCampaign && <CampaignDetail id={openCampaign} timezone={timezone} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Lembrete interno para a equipe; a mensagem automática só sai para quem consentiu. */
function Birthdays({ currentMonth }: { currentMonth: number }) {
  const [month, setMonth] = useState(currentMonth);
  const birthdays = useBirthdays(month);

  return (
    <div className="grid gap-4">
      <div className="grid max-w-xs gap-1.5">
        <Label htmlFor="birthday-month">Mês</Label>
        <Select value={String(month)} onValueChange={(value) => setMonth(Number(value))}>
          <SelectTrigger id="birthday-month" className="w-full capitalize">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MONTHS.map((name, index) => (
              <SelectItem key={name} value={String(index + 1)} className="capitalize">
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {birthdays.isLoading ? (
        <LoadingRows />
      ) : birthdays.error ? (
        <ErrorState error={birthdays.error} onRetry={() => birthdays.refetch()} />
      ) : birthdays.data!.length === 0 ? (
        <EmptyState title="Nenhum aniversariante">
          Cadastre a data de aniversário dos clientes para eles aparecerem aqui.
        </EmptyState>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">Dia</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Aceita receber</TableHead>
              <TableHead>Mensagem deste ano</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {birthdays.data!.map((entry) => {
              const channels = [
                entry.consents.email && 'E-mail',
                entry.consents.whatsapp && 'WhatsApp',
              ].filter(Boolean);
              return (
                <TableRow key={entry.clientId}>
                  <TableCell className="font-medium tabular-nums">
                    {String(entry.day).padStart(2, '0')}/{String(entry.month).padStart(2, '0')}
                  </TableCell>
                  <TableCell>{entry.name}</TableCell>
                  <TableCell>
                    {channels.length > 0 ? (
                      channels.join(', ')
                    ) : (
                      <span className="text-muted-foreground">Só lembrete interno</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {entry.message ? (
                      <span className="inline-flex flex-wrap items-center gap-2">
                        <MessageStatusBadge status={entry.message.status} outcome={entry.message.outcome} />
                        <span className="text-muted-foreground text-xs">
                          {CHANNEL_LABEL[entry.message.channel]}
                        </span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function CampaignList({ timezone, onOpen }: { timezone: string; onOpen: (id: string) => void }) {
  const campaigns = useCampaigns();
  const services = useServices(true);
  if (campaigns.isLoading) return <LoadingRows />;
  if (campaigns.error) return <ErrorState error={campaigns.error} onRetry={() => campaigns.refetch()} />;
  if (campaigns.data!.length === 0) {
    return (
      <EmptyState title="Nenhuma campanha ainda">
        Mande uma mensagem para quem não volta há um tempo ou para os aniversariantes do mês.
      </EmptyState>
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Campanha</TableHead>
          <TableHead className="hidden sm:table-cell">Público</TableHead>
          <TableHead>Envio</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {campaigns.data!.map((campaign) => (
          <TableRow key={campaign.id}>
            <TableCell>
              <button
                type="button"
                className="text-left font-medium underline-offset-4 hover:underline"
                onClick={() => onOpen(campaign.id)}
              >
                {campaign.name}
              </button>
              <p className="text-muted-foreground text-xs">
                {CHANNEL_LABEL[campaign.channel]} · {formatDate(campaign.createdAt, timezone)}
              </p>
            </TableCell>
            <TableCell className="hidden sm:table-cell">
              {describeAudience(campaign.audience, services.data ?? [])}
            </TableCell>
            <TableCell>
              <Progress campaign={campaign} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** "12 de 15 enviadas", com fila e falhas quando houver. */
function Progress({ campaign }: { campaign: Campaign }) {
  const { pending, sent, skipped, failed } = campaign.counts;
  return (
    <div className="grid gap-1 text-sm">
      <span>
        {sent} de {campaign.recipientCount} {campaign.recipientCount === 1 ? 'enviada' : 'enviadas'}
      </span>
      <span className="flex flex-wrap gap-1">
        {pending > 0 && <Badge variant="outline">{pending} na fila</Badge>}
        {skipped > 0 && <Badge variant="secondary">{skipped} não enviadas</Badge>}
        {failed > 0 && <Badge variant="destructive">{failed} com falha</Badge>}
      </span>
    </div>
  );
}

function CampaignDetail({ id, timezone }: { id: string; timezone: string }) {
  const campaign = useCampaign(id);
  const services = useServices(true);
  if (campaign.isLoading) return <LoadingRows />;
  if (campaign.error) return <ErrorState error={campaign.error} onRetry={() => campaign.refetch()} />;
  const data = campaign.data!;
  return (
    <div className="grid gap-4">
      <DialogHeader>
        <DialogTitle className="font-heading text-2xl uppercase">{data.name}</DialogTitle>
        <DialogDescription>
          {CHANNEL_LABEL[data.channel]} · {describeAudience(data.audience, services.data ?? [])} · criada em{' '}
          {formatDate(data.createdAt, timezone)}
        </DialogDescription>
      </DialogHeader>
      {data.channel === 'EMAIL' ? (
        <figure className="bg-muted rounded-md p-3 text-sm">
          <figcaption className="font-medium">{data.emailSubject}</figcaption>
          <p className="mt-1 whitespace-pre-line">{data.emailBody}</p>
        </figure>
      ) : (
        <p className="text-sm">
          Modelo do WhatsApp: <strong>{data.whatsappTemplateName}</strong>
        </p>
      )}
      <Progress campaign={data} />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Cliente</TableHead>
            <TableHead>Situação</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.messages.map((message) => (
            <TableRow key={message.clientId}>
              <TableCell>{message.clientName}</TableCell>
              <TableCell>
                <MessageStatusBadge status={message.status} outcome={message.outcome} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
