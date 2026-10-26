'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { Field } from '@/components/form/field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { zodResolver } from '@/lib/forms/zod-resolver';
import { registerBarbershop } from '@/lib/session/auth';
import { slugify } from '@/lib/slug';

const schema = z.object({
  barbershopName: z.string().trim().min(2, 'Informe o nome da barbearia.'),
  slug: z
    .string()
    .min(3, 'Mínimo de 3 caracteres.')
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use letras minúsculas, números e hífens.'),
  ownerName: z.string().trim().min(2, 'Informe seu nome.'),
  email: z.email('Informe um e-mail válido.'),
  password: z.string().min(8, 'A senha precisa de ao menos 8 caracteres.'),
  ownerIsProfessional: z.boolean(),
});

export function RegisterForm() {
  const router = useRouter();
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      barbershopName: '',
      slug: '',
      ownerName: '',
      email: '',
      password: '',
      ownerIsProfessional: true,
    },
  });
  const { errors, isSubmitting, dirtyFields } = form.formState;
  const slug = useWatch({ control: form.control, name: 'slug' });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await registerBarbershop(values);
      router.replace('/painel');
    } catch (error) {
      if (error instanceof ApiError && error.code === 'slug-taken') {
        form.setError('slug', { message: error.userMessage });
      } else if (error instanceof ApiError && error.code === 'email-taken') {
        form.setError('email', { message: error.userMessage });
      } else {
        form.setError('root', { message: errorMessage(error) });
      }
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-5">
      <div>
        <h1 className="text-4xl font-bold">Cadastrar barbearia</h1>
        <p className="text-muted-foreground mt-1 text-sm">Em dois minutos sua agenda está no ar.</p>
      </div>

      {errors.root && (
        <Alert variant="destructive">
          <AlertDescription>{errors.root.message}</AlertDescription>
        </Alert>
      )}

      <Field label="Nome da barbearia" error={errors.barbershopName?.message}>
        <Input
          autoFocus
          {...form.register('barbershopName', {
            // Sugere o endereço enquanto a pessoa não editar o campo à mão.
            onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
              if (!dirtyFields.slug) form.setValue('slug', slugify(event.target.value));
            },
          })}
        />
      </Field>
      <Field
        label="Endereço da página de agendamento"
        error={errors.slug?.message}
        hint={`tanaregua.app/${slug || 'sua-barbearia'}`}
      >
        <Input autoCapitalize="none" spellCheck={false} {...form.register('slug')} />
      </Field>
      <Field label="Seu nome" error={errors.ownerName?.message}>
        <Input autoComplete="name" {...form.register('ownerName')} />
      </Field>
      <Field label="E-mail" error={errors.email?.message}>
        <Input type="email" autoComplete="email" {...form.register('email')} />
      </Field>
      <Field label="Senha" error={errors.password?.message} hint="Mínimo de 8 caracteres.">
        <Input type="password" autoComplete="new-password" {...form.register('password')} />
      </Field>

      <div className="flex items-start gap-3">
        <Controller
          control={form.control}
          name="ownerIsProfessional"
          render={({ field }) => (
            <Checkbox
              id="owner-is-professional"
              checked={field.value}
              onCheckedChange={(checked) => field.onChange(checked === true)}
            />
          )}
        />
        <Label htmlFor="owner-is-professional" className="leading-snug font-normal">
          Eu também atendo clientes (apareço como coluna na agenda)
        </Label>
      </div>

      <Button type="submit" size="lg" disabled={isSubmitting}>
        {isSubmitting ? 'Criando…' : 'Criar barbearia'}
      </Button>

      <p className="text-muted-foreground text-center text-sm">
        Já tem conta?{' '}
        <Link href="/entrar" className="text-primary font-medium underline-offset-4 hover:underline">
          Entrar
        </Link>
      </p>
    </form>
  );
}
