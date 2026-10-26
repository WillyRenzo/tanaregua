import { useId, type ReactElement, cloneElement } from 'react';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

interface FieldProps {
  label: string;
  error?: string;
  hint?: string;
  className?: string;
  /** Um único controle (Input, Textarea…); recebe id e atributos ARIA automaticamente. */
  children: ReactElement<Record<string, unknown>>;
}

/** Label + controle + dica/erro ligados por ARIA (WCAG 2.2: leitores de tela anunciam o erro). */
export function Field({ label, error, hint, className, children }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cn('grid gap-1.5', className)}>
      <Label htmlFor={id}>{label}</Label>
      {cloneElement(children, {
        id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': describedBy,
      })}
      {hint && !error && (
        <p id={hintId} className="text-muted-foreground text-xs">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-destructive text-xs font-medium">
          {error}
        </p>
      )}
    </div>
  );
}
