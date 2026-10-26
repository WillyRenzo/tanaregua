import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Entrar' };

export default function LoginPage() {
  // Suspense: o formulário lê ?next= da URL (dado dinâmico com Cache Components).
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
