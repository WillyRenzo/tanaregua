import { Ban, CircleAlert, CircleCheck, Clock, Undo2, type LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { formatMoney } from '@/lib/format';
import type { Schemas } from '@/lib/queries';

export type AppointmentPayment = Schemas['AppointmentPayment'];

/** Situação do pagamento online da reserva (business-rules §5), com ícone + texto (nunca só cor). */
export const PAYMENT_STATUS: Record<
  AppointmentPayment['status'],
  { label: string; icon: LucideIcon; variant: 'default' | 'secondary' | 'outline' | 'destructive' }
> = {
  PENDING: { label: 'Pagamento pendente', icon: Clock, variant: 'outline' },
  PAID: { label: 'Pago online', icon: CircleCheck, variant: 'default' },
  REFUND_PENDING: { label: 'Reembolso em andamento', icon: Undo2, variant: 'secondary' },
  REFUNDED: { label: 'Reembolsado', icon: Undo2, variant: 'secondary' },
  REFUND_FAILED: { label: 'Reembolso não concluído', icon: CircleAlert, variant: 'destructive' },
  EXPIRED: { label: 'Pagamento não feito no prazo', icon: Ban, variant: 'outline' },
  CANCELLED: { label: 'Pagamento encerrado', icon: Ban, variant: 'outline' },
};

/** Só o que muda algo para quem olha: encerrado sem dinheiro não aparece. */
export function hasVisiblePayment(payment: AppointmentPayment | null): payment is AppointmentPayment {
  return payment !== null && payment.status !== 'CANCELLED' && payment.status !== 'EXPIRED';
}

/** Pago e já no caixa (§5): usado na comanda ou retido pela barbearia (falta, cancelamento fora do prazo). */
const SETTLED_LABEL: Record<NonNullable<AppointmentPayment['settlement']>, string> = {
  ORDER: 'Pago online · usado na comanda',
  RETAINED: 'Pago online · retido',
};

export function PaymentBadge({ payment }: { payment: AppointmentPayment }) {
  const { label, icon: Icon, variant } = PAYMENT_STATUS[payment.status];
  const text = payment.status === 'PAID' && payment.settlement ? SETTLED_LABEL[payment.settlement] : label;
  return (
    <Badge variant={variant}>
      <Icon aria-hidden /> {text} · {formatMoney(payment.amountCents)}
    </Badge>
  );
}

const REFUND_TEXT: Record<AppointmentPayment['refunds'][number]['kind'], string> = {
  DIFFERENCE: 'pago a mais que o total da comanda',
  MANUAL: 'reembolso pela barbearia',
};

const REFUND_STATUS: Record<AppointmentPayment['refunds'][number]['status'], string> = {
  PENDING: 'em andamento',
  DONE: 'devolvido',
  FAILED: 'não concluído',
};

/** Reembolsos parciais de um pagamento que já entrou no caixa, um por linha. */
export function PaymentRefunds({ payment }: { payment: AppointmentPayment }) {
  if (payment.refunds.length === 0) return null;
  return (
    <ul className="grid gap-1 text-xs">
      {payment.refunds.map((refund) => (
        <li
          key={refund.kind}
          className={refund.status === 'FAILED' ? 'text-destructive' : 'text-muted-foreground'}
        >
          <Undo2 aria-hidden className="mr-1 inline size-3.5" />
          {formatMoney(refund.amountCents)} ({REFUND_TEXT[refund.kind]}): {REFUND_STATUS[refund.status]}
        </li>
      ))}
    </ul>
  );
}

/** Valor cobrado online (o mesmo arredondamento da API: meio centavo para cima). Só para exibir. */
export function onlineChargeCents(
  totalCents: number,
  settings: { amount: 'FULL' | 'DEPOSIT'; depositBps: number | null },
): number {
  if (settings.amount === 'FULL' || settings.depositBps === null) return totalCents;
  return Math.round((totalCents * settings.depositBps) / 10_000);
}

/** "sinal de 30%" a partir de basis points. */
export function depositLabel(depositBps: number): string {
  return `sinal de ${(depositBps / 100).toLocaleString('pt-BR')}%`;
}
