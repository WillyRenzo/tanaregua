import { Banknote, CreditCard, QrCode, Wallet, type LucideIcon } from 'lucide-react';
import type { PaymentMethod } from '@/lib/queries';

export const PAYMENT_METHODS: { value: PaymentMethod; label: string; icon: LucideIcon }[] = [
  { value: 'PIX', label: 'Pix', icon: QrCode },
  { value: 'CASH', label: 'Dinheiro', icon: Banknote },
  { value: 'CARD_DEBIT', label: 'Débito', icon: CreditCard },
  { value: 'CARD_CREDIT', label: 'Crédito', icon: CreditCard },
  { value: 'OTHER', label: 'Outro', icon: Wallet },
];

export const paymentLabel = (method: string | null | undefined) =>
  PAYMENT_METHODS.find((item) => item.value === method)?.label ?? '—';
