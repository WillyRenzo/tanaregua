import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { LoadingRows } from '@/components/states';
import { getPublicBarbershop } from '@/lib/api/server';
import { MyAppointments } from './my-appointments';

export const metadata: Metadata = { title: 'Meus agendamentos', robots: { index: false } };

export default function MyAppointmentsPage({ params }: PageProps<'/[slug]/meus-agendamentos'>) {
  return (
    <Suspense fallback={<LoadingRows rows={3} />}>
      <Content params={params} />
    </Suspense>
  );
}

async function Content({ params }: { params: PageProps<'/[slug]/meus-agendamentos'>['params'] }) {
  const data = await getPublicBarbershop((await params).slug);
  if (!data) notFound();
  return (
    <MyAppointments
      timezone={data.barbershop.timezone}
      cancellationMinNoticeMinutes={data.barbershop.cancellationMinNoticeMinutes}
      rescheduleMinNoticeMinutes={data.barbershop.rescheduleMinNoticeMinutes}
    />
  );
}
