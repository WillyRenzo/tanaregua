'use client';

import { useId, useState } from 'react';
import { Check, Search, UserPlus, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { errorMessage } from '@/lib/api/errors';
import { formatPhone } from '@/lib/format';
import { useClients, useCreateClient } from '@/lib/queries';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { cn } from '@/lib/utils';

export interface PickedClient {
  id: string;
  name: string;
}

/**
 * Busca de cliente por nome ou telefone, com cadastro rápido (nome + telefone) sem
 * sair do fluxo — a recepção agenda com o cliente na frente ou no telefone.
 */
export function ClientPicker({
  value,
  onChange,
  error,
}: {
  value: PickedClient | null;
  onChange: (client: PickedClient | null) => void;
  error?: string;
}) {
  const id = useId();
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [phone, setPhone] = useState('');
  const debounced = useDebouncedValue(search.trim());
  const clients = useClients(debounced);
  const createClient = useCreateClient();
  const results = clients.data?.pages.flatMap((page) => page.items).slice(0, 8) ?? [];

  if (value) {
    return (
      <div className="grid gap-1.5">
        <Label>Cliente</Label>
        <div className="border-input flex items-center justify-between rounded-md border px-3 py-2 text-sm">
          <span className="flex items-center gap-2 font-medium">
            <Check aria-hidden className="text-primary size-4" /> {value.name}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Trocar cliente"
            onClick={() => onChange(null)}
          >
            <X />
          </Button>
        </div>
      </div>
    );
  }

  const quickCreate = async () => {
    try {
      const created = await createClient.mutateAsync({ name: search.trim(), phone: phone || undefined });
      onChange({ id: created.id, name: created.name });
      setCreating(false);
      setSearch('');
      setPhone('');
    } catch (cause) {
      toast.error(errorMessage(cause));
    }
  };

  return (
    <div className="grid gap-1.5">
      <Label htmlFor={`${id}-search`}>Cliente</Label>
      <div className="relative">
        <Search
          aria-hidden
          className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2"
        />
        <Input
          id={`${id}-search`}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Nome ou telefone"
          className="pl-9"
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
        />
      </div>

      {debounced.length > 0 && (
        <ul
          aria-label="Clientes encontrados"
          className="border-border max-h-56 overflow-y-auto rounded-md border"
        >
          {clients.isLoading && <li className="text-muted-foreground px-3 py-2 text-sm">Buscando…</li>}
          {results.map((client) => (
            <li key={client.id}>
              <button
                type="button"
                onClick={() => onChange({ id: client.id, name: client.name })}
                className={cn(
                  'hover:bg-accent focus-visible:bg-accent flex w-full items-center justify-between px-3 py-2 text-left text-sm',
                  'focus-visible:outline-none',
                )}
              >
                <span className="font-medium">{client.name}</span>
                <span className="text-muted-foreground text-xs">{formatPhone(client.phone)}</span>
              </button>
            </li>
          ))}
          {!clients.isLoading && (
            <li className="border-border border-t">
              {creating ? (
                <div className="grid gap-2 p-3">
                  <p className="text-sm">
                    Novo cliente: <strong>{search.trim()}</strong>
                  </p>
                  <Label htmlFor={`${id}-phone`} className="sr-only">
                    Telefone
                  </Label>
                  <Input
                    id={`${id}-phone`}
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                    placeholder="Telefone (opcional)"
                    inputMode="tel"
                  />
                  <div className="flex gap-2">
                    <Button type="button" size="sm" onClick={quickCreate} disabled={createClient.isPending}>
                      Cadastrar e usar
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setCreating(false)}>
                      Cancelar
                    </Button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setCreating(true)}
                  disabled={search.trim().length < 2}
                  className="text-primary hover:bg-accent flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium disabled:opacity-50"
                >
                  <UserPlus aria-hidden className="size-4" /> Cadastrar &ldquo;{search.trim()}&rdquo;
                </button>
              )}
            </li>
          )}
        </ul>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-destructive text-xs font-medium">
          {error}
        </p>
      )}
    </div>
  );
}
