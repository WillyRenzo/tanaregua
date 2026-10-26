'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Field } from '@/components/form/field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { errorMessage } from '@/lib/api/errors';
import { zodResolver } from '@/lib/forms/zod-resolver';
import { login } from '@/lib/session/auth';

const schema = z.object({
  email: z.email('Informe um e-mail válido.'),
  password: z.string().min(1, 'Informe a senha.'),
});

/** Só aceita retorno para rotas internas do painel (evita open redirect). */
function safeNext(next: string | null): string {
  return next?.startsWith('/painel') ? next : '/painel';
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const form = useForm({ resolver: zodResolver(schema), defaultValues: { email: '', password: '' } });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await login(values);
      router.replace(safeNext(params.get('next')));
    } catch (error) {
      form.setError('root', { message: errorMessage(error) });
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-5">
      <div>
        <h1 className="text-4xl font-bold">Entrar</h1>
        <p className="text-muted-foreground mt-1 text-sm">Acesse o painel da sua barbearia.</p>
      </div>

      {errors.root && (
        <Alert variant="destructive">
          <AlertDescription>{errors.root.message}</AlertDescription>
        </Alert>
      )}

      <Field label="E-mail" error={errors.email?.message}>
        <Input type="email" autoComplete="email" autoFocus {...form.register('email')} />
      </Field>
      <Field label="Senha" error={errors.password?.message}>
        <Input type="password" autoComplete="current-password" {...form.register('password')} />
      </Field>

      <Button type="submit" size="lg" disabled={isSubmitting}>
        {isSubmitting ? 'Entrando…' : 'Entrar'}
      </Button>

      <p className="text-muted-foreground text-center text-sm">
        Ainda não tem conta?{' '}
        <Link href="/cadastro" className="text-primary font-medium underline-offset-4 hover:underline">
          Cadastre sua barbearia
        </Link>
      </p>
    </form>
  );
}
