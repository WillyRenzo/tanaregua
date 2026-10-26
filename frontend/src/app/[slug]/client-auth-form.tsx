'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Field } from '@/components/form/field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { zodResolver } from '@/lib/forms/zod-resolver';
import { clientLogin, clientRegister } from '@/lib/session/auth';

const loginSchema = z.object({
  email: z.email('Informe um e-mail válido.'),
  password: z.string().min(1, 'Informe a senha.'),
});

const registerSchema = z.object({
  name: z.string().trim().min(2, 'Informe seu nome.'),
  phone: z.string().refine((value) => value.replace(/\D/g, '').length >= 10, 'Telefone com DDD.'),
  email: z.email('Informe um e-mail válido.'),
  password: z.string().min(8, 'Mínimo de 8 caracteres.'),
});

/** Uma conta serve para qualquer barbearia do TaNaRegua. */
export function ClientAuthForm({ slug, onAuthenticated }: { slug: string; onAuthenticated: () => void }) {
  const [tab, setTab] = useState<'register' | 'login'>('register');
  return (
    <Tabs value={tab} onValueChange={(value) => setTab(value as 'register' | 'login')}>
      <TabsList className="w-full">
        <TabsTrigger value="register" className="flex-1">
          Primeira vez
        </TabsTrigger>
        <TabsTrigger value="login" className="flex-1">
          Já tenho conta
        </TabsTrigger>
      </TabsList>
      <TabsContent value="register" className="pt-4">
        <RegisterForm slug={slug} onDone={onAuthenticated} onHasAccount={() => setTab('login')} />
      </TabsContent>
      <TabsContent value="login" className="pt-4">
        <LoginForm slug={slug} onDone={onAuthenticated} />
      </TabsContent>
    </Tabs>
  );
}

function LoginForm({ slug, onDone }: { slug: string; onDone: () => void }) {
  const form = useForm({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } });
  const { errors, isSubmitting } = form.formState;
  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await clientLogin(slug, values);
      onDone();
    } catch (error) {
      form.setError('root', { message: errorMessage(error) });
    }
  });
  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      {errors.root && (
        <Alert variant="destructive">
          <AlertDescription>{errors.root.message}</AlertDescription>
        </Alert>
      )}
      <Field label="E-mail" error={errors.email?.message}>
        <Input type="email" autoComplete="email" {...form.register('email')} />
      </Field>
      <Field label="Senha" error={errors.password?.message}>
        <Input type="password" autoComplete="current-password" {...form.register('password')} />
      </Field>
      <Button type="submit" size="lg" disabled={isSubmitting}>
        Entrar e continuar
      </Button>
    </form>
  );
}

function RegisterForm({
  slug,
  onDone,
  onHasAccount,
}: {
  slug: string;
  onDone: () => void;
  onHasAccount: () => void;
}) {
  const form = useForm({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: '', phone: '', email: '', password: '' },
  });
  const { errors, isSubmitting } = form.formState;
  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await clientRegister(slug, values);
      onDone();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'email-taken') {
        form.setError('email', { message: error.userMessage });
        onHasAccount();
        return;
      }
      form.setError('root', { message: errorMessage(error) });
    }
  });
  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      {errors.root && (
        <Alert variant="destructive">
          <AlertDescription>{errors.root.message}</AlertDescription>
        </Alert>
      )}
      <Field label="Nome" error={errors.name?.message}>
        <Input autoComplete="name" {...form.register('name')} />
      </Field>
      <Field label="Celular (WhatsApp)" error={errors.phone?.message}>
        <Input
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="(11) 99999-9999"
          {...form.register('phone')}
        />
      </Field>
      <Field label="E-mail" error={errors.email?.message} hint="A confirmação do horário chega aqui.">
        <Input type="email" autoComplete="email" {...form.register('email')} />
      </Field>
      <Field label="Crie uma senha" error={errors.password?.message}>
        <Input type="password" autoComplete="new-password" {...form.register('password')} />
      </Field>
      <Button type="submit" size="lg" disabled={isSubmitting}>
        Criar conta e continuar
      </Button>
    </form>
  );
}
