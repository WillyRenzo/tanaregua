import { Ban, CircleCheck, CircleX, Clock, type LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { MessageStatus } from '@/lib/queries';

/** Situação de uma mensagem de aniversário ou campanha, com ícone + texto (nunca só cor). */
const MESSAGE_STATUS: Record<
  MessageStatus,
  { label: string; icon: LucideIcon; variant: 'default' | 'secondary' | 'outline' | 'destructive' }
> = {
  PENDING: { label: 'Na fila', icon: Clock, variant: 'outline' },
  SENT: { label: 'Enviada', icon: CircleCheck, variant: 'default' },
  SKIPPED: { label: 'Não enviada', icon: Ban, variant: 'secondary' },
  FAILED: { label: 'Falhou', icon: CircleX, variant: 'destructive' },
};

/** Motivos que a API grava quando a mensagem não sai (códigos curtos, sem dado pessoal). */
const OUTCOMES: Record<string, string> = {
  'no-consent': 'cliente retirou o consentimento',
  'client-unavailable': 'cliente anonimizado',
  'whatsapp-not-connected': 'WhatsApp desconectado',
  'template-missing': 'sem modelo do WhatsApp',
  'provider-error': 'o provedor recusou o envio',
};

export const CHANNEL_LABEL = { EMAIL: 'E-mail', WHATSAPP: 'WhatsApp' } as const;

/** Badge da situação e, quando a mensagem não saiu, o motivo em texto. */
export function MessageStatusBadge({ status, outcome }: { status: MessageStatus; outcome?: string | null }) {
  const { label, icon: Icon, variant } = MESSAGE_STATUS[status];
  const reason = outcome ? OUTCOMES[outcome] : undefined;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <Badge variant={variant}>
        <Icon aria-hidden /> {label}
      </Badge>
      {reason && <span className="text-muted-foreground text-xs">{reason}</span>}
    </span>
  );
}
