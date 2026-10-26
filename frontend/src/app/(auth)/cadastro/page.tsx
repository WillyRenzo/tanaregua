import type { Metadata } from 'next';
import { RegisterForm } from './register-form';

export const metadata: Metadata = { title: 'Cadastrar barbearia' };

export default function RegisterPage() {
  return <RegisterForm />;
}
