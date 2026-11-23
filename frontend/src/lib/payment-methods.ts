import { Banknote, CreditCard, Globe, QrCode, Wallet, type LucideIcon } from 'lucide-react';
import type { PaymentMethod } from '@/lib/queries';

/** Formas do balcão: as que a equipe escolhe. `ONLINE` (pago na reserva) só o sistema lança. */
export type CounterPaymentMethod = Exclude<PaymentMethod, 'ONLINE'>;

export const PAYMENT_METHODS: { value: CounterPaymentMethod; label: string; icon: LucideIcon }[] = [
  { value: 'PIX', label: 'Pix', icon: QrCode },
  { value: 'CASH', label: 'Dinheiro', icon: Banknote },
  { value: 'CARD_DEBIT', label: 'Débito', icon: CreditCard },
  { value: 'CARD_CREDIT', label: 'Crédito', icon: CreditCard },
  { value: 'OTHER', label: 'Outro', icon: Wallet },
];

/** Pago online na reserva (business-rules §5). */
export const ONLINE_METHOD: { value: 'ONLINE'; label: string; icon: LucideIcon } = {
  value: 'ONLINE',
  label: 'Online (reserva)',
  icon: Globe,
};

/** Todas as formas que aparecem no caixa. */
export const CASH_METHODS = [...PAYMENT_METHODS, ONLINE_METHOD];

export const paymentLabel = (method: string | null | undefined) =>
  CASH_METHODS.find((item) => item.value === method)?.label ?? '—';
