'use client';

import { forwardRef, useState, type ComponentProps } from 'react';
import { Input } from '@/components/ui/input';
import { parseMoney } from '@/lib/format';

type MoneyInputProps = Omit<ComponentProps<typeof Input>, 'value' | 'onChange'> & {
  /** Valor em centavos. */
  value: number | null;
  onChange: (cents: number | null) => void;
};

/** Campo em reais que entrega centavos (dinheiro nunca trafega como float). */
export const MoneyInput = forwardRef<HTMLInputElement, MoneyInputProps>(function MoneyInput(
  { value, onChange, ...props },
  ref,
) {
  const [text, setText] = useState(value === null ? '' : (value / 100).toFixed(2).replace('.', ','));
  return (
    <div className="relative">
      <span aria-hidden className="text-muted-foreground absolute top-1/2 left-3 -translate-y-1/2 text-sm">
        R$
      </span>
      <Input
        ref={ref}
        inputMode="decimal"
        className="pl-9"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          onChange(parseMoney(event.target.value));
        }}
        {...props}
      />
    </div>
  );
});
