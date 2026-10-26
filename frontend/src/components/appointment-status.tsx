import { Ban, CalendarClock, CheckCheck, CircleCheck, Scissors, UserX, type LucideIcon } from 'lucide-react';
import type { Appointment } from '@/lib/queries';
import { cn } from '@/lib/utils';

type Status = Appointment['status'];

/** Status sempre com ícone + texto + cor (nunca só cor — WCAG 1.4.1). */
export const STATUS_META: Record<Status, { label: string; icon: LucideIcon; className: string }> = {
  SCHEDULED: {
    label: 'Agendado',
    icon: CalendarClock,
    className: 'text-status-scheduled border-status-scheduled',
  },
  CONFIRMED: {
    label: 'Confirmado',
    icon: CircleCheck,
    className: 'text-status-confirmed border-status-confirmed',
  },
  IN_SERVICE: {
    label: 'Em atendimento',
    icon: Scissors,
    className: 'text-status-in-service border-status-in-service',
  },
  COMPLETED: {
    label: 'Concluído',
    icon: CheckCheck,
    className: 'text-status-completed border-status-completed',
  },
  NO_SHOW: { label: 'Não compareceu', icon: UserX, className: 'text-status-no-show border-status-no-show' },
  CANCELLED: { label: 'Cancelado', icon: Ban, className: 'text-muted-foreground border-muted-foreground' },
};

export function StatusBadge({ status, className }: { status: Status; className?: string }) {
  const meta = STATUS_META[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium',
        meta.className,
        className,
      )}
    >
      <meta.icon aria-hidden className="size-3.5" />
      {meta.label}
    </span>
  );
}
