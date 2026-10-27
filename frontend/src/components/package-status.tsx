import { Ban, CircleCheck, Clock, Undo2, type LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { MyPackage } from '@/lib/queries';

export type PackageStatus = MyPackage['status'];

/** Situação do pacote vendido, com ícone + texto (nunca só cor). */
export const PACKAGE_STATUS: Record<
  PackageStatus,
  { label: string; icon: LucideIcon; variant: 'default' | 'secondary' | 'outline' }
> = {
  ACTIVE: { label: 'Ativo', icon: CircleCheck, variant: 'default' },
  EXPIRED: { label: 'Vencido', icon: Clock, variant: 'outline' },
  REFUNDED: { label: 'Reembolsado', icon: Undo2, variant: 'secondary' },
  VOIDED: { label: 'Estornado', icon: Ban, variant: 'outline' },
};

export function PackageStatusBadge({ status }: { status: PackageStatus }) {
  const { label, icon: Icon, variant } = PACKAGE_STATUS[status];
  return (
    <Badge variant={variant}>
      <Icon aria-hidden /> {label}
    </Badge>
  );
}

/** "Corte 3/4 · Barba 2/2": sessões restantes de cada serviço. */
export function formatBalances(balances: MyPackage['balances']): string {
  return balances
    .map((balance) => `${balance.name} ${balance.remaining}/${balance.initialQuantity}`)
    .join(' · ');
}
