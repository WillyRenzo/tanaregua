import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { LoadingRows } from '@/components/states';
import { getPublicBarbershop } from '@/lib/api/server';
import { BookingFlow } from './booking-flow';

export async function generateMetadata({ params }: PageProps<'/[slug]'>): Promise<Metadata> {
  const data = await getPublicBarbershop((await params).slug);
  if (!data) return { title: 'Barbearia não encontrada' };
  return {
    title: `Agendar em ${data.barbershop.name}`,
    description: `Marque seu horário em ${data.barbershop.name} online: ${data.services
      .slice(0, 4)
      .map((service) => service.name)
      .join(', ')}.`,
  };
}

/** Página pública de agendamento: SSR (SEO) dos dados da barbearia; reserva no cliente. */
export default function BarbershopPage({ params }: PageProps<'/[slug]'>) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <BarbershopContent params={params} />
    </Suspense>
  );
}

async function BarbershopContent({ params }: { params: PageProps<'/[slug]'>['params'] }) {
  const { slug } = await params;
  const data = await getPublicBarbershop(slug);
  if (!data) notFound();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="bg-sidebar text-sidebar-foreground">
        <div className="mx-auto flex max-w-5xl flex-wrap items-end justify-between gap-4 px-4 py-8 sm:py-12">
          <div>
            <p className="font-heading text-sidebar-primary text-sm font-semibold tracking-[0.3em] uppercase">
              Agendamento online
            </p>
            <h1 className="mt-2 text-5xl leading-none font-bold sm:text-6xl">{data.barbershop.name}</h1>
          </div>
          <Link
            href={`/${slug}/meus-agendamentos`}
            className="text-sidebar-foreground/80 text-sm underline-offset-4 hover:underline"
          >
            Meus agendamentos
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        {data.services.length === 0 || data.professionals.length === 0 ? (
          <p className="text-muted-foreground">Esta barbearia ainda não abriu a agenda online.</p>
        ) : (
          <BookingFlow
            slug={slug}
            timezone={data.barbershop.timezone}
            services={data.services}
            professionals={data.professionals}
          />
        )}
      </main>
      <footer className="text-muted-foreground mx-auto w-full max-w-5xl px-4 py-6 text-xs">
        Agenda por{' '}
        <Link href="/" className="underline-offset-4 hover:underline">
          TaNaRegua
        </Link>
      </footer>
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="mx-auto w-full max-w-5xl p-8">
      <LoadingRows rows={5} label="Carregando a barbearia" />
    </div>
  );
}
