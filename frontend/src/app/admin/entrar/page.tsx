import type { Metadata } from 'next';
import { Brand } from '@/components/brand';
import { PlatformLoginForm } from './platform-login-form';

export const metadata: Metadata = { title: 'Administração da plataforma', robots: { index: false } };

export default function PlatformLoginPage() {
  return (
    <main className="flex min-h-dvh flex-col justify-center px-4 py-10">
      <div className="mx-auto grid w-full max-w-sm gap-10">
        <Brand href="/admin" />
        <PlatformLoginForm />
      </div>
    </main>
  );
}
