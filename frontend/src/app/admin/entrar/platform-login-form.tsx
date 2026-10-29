'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Field } from '@/components/form/field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { errorMessage } from '@/lib/api/errors';
import { zodResolver } from '@/lib/forms/zod-resolver';
import { platformLogin } from '@/lib/session/auth';

const schema = z.object({
  email: z.email('Informe um e-mail válido.'),
  password: z.string().min(1, 'Informe a senha.'),
});

/** Login da administração da plataforma: conta e sessão próprias, sem relação com o painel. */
export function PlatformLoginForm() {
  const router = useRouter();
  const form = useForm({ resolver: zodResolver(schema), defaultValues: { email: '', password: '' } });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await platformLogin(values);
      router.replace('/admin');
    } catch (error) {
      form.setError('root', { message: errorMessage(error) });
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-5">
      <div>
        <h1 className="text-4xl font-bold">Administração</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Planos e preços do TaNaRegua. Para o painel da sua barbearia, use{' '}
          <Link href="/entrar" className="text-primary font-medium underline-offset-4 hover:underline">
            o login do painel
          </Link>
          .
        </p>
      </div>

      {errors.root && (
        <Alert variant="destructive">
          <AlertDescription>{errors.root.message}</AlertDescription>
        </Alert>
      )}

      <Field label="E-mail" error={errors.email?.message}>
        <Input type="email" autoComplete="username" autoFocus {...form.register('email')} />
      </Field>
      <Field label="Senha" error={errors.password?.message}>
        <Input type="password" autoComplete="current-password" {...form.register('password')} />
      </Field>

      <Button type="submit" size="lg" disabled={isSubmitting}>
        {isSubmitting ? 'Entrando…' : 'Entrar'}
      </Button>
    </form>
  );
}
