import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/api/errors';

/** Estados que toda tela com dados precisa ter (skill frontend-design). */

export function LoadingRows({ rows = 5, label = 'Carregando' }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-label={label} className="grid gap-2">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-12 w-full" />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="border-border flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-12 text-center">
      <p className="font-heading text-xl font-semibold tracking-wide uppercase">{title}</p>
      {children && <div className="text-muted-foreground max-w-sm text-sm">{children}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="border-destructive/40 bg-destructive/5 flex flex-col items-center gap-3 rounded-lg border px-6 py-10 text-center"
    >
      <AlertTriangle aria-hidden className="text-destructive size-6" />
      <p className="text-sm">{errorMessage(error)}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Tentar de novo
        </Button>
      )}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="border-foreground/80 mb-6 flex flex-wrap items-end justify-between gap-4 border-b-2 pb-4">
      <div>
        <h1 className="text-3xl font-bold sm:text-4xl">{title}</h1>
        {description && <p className="text-muted-foreground mt-1 text-sm">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
