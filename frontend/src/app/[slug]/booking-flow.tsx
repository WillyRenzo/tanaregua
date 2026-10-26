'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowLeft, Check, CheckCircle2 } from 'lucide-react';
import { LoadingRows } from '@/components/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { idempotencyKey } from '@/lib/api/client';
import { addDays, formatDateLong, formatMoney, formatTime, todayIn } from '@/lib/format';
import type { Schemas } from '@/lib/queries';
import { useBook, usePublicAvailability } from '@/lib/public-queries';
import { cn } from '@/lib/utils';
import { ClientAuthForm } from './client-auth-form';
import { useClientSession } from './use-client-session';

type Service = Schemas['Service'];
type Professional = Schemas['PublicProfessional'];
type Step = 'services' | 'professional' | 'time' | 'identify' | 'confirm' | 'done';

const ANY = 'any';
const STEPS: { id: Step; label: string }[] = [
  { id: 'services', label: 'Serviço' },
  { id: 'professional', label: 'Profissional' },
  { id: 'time', label: 'Horário' },
  { id: 'confirm', label: 'Confirmar' },
];

export function BookingFlow({
  slug,
  timezone,
  services,
  professionals,
}: {
  slug: string;
  timezone: string;
  services: Service[];
  professionals: Professional[];
}) {
  const { isClientHere } = useClientSession(slug);
  const [step, setStep] = useState<Step>('services');
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [professionalId, setProfessionalId] = useState<string>(ANY);
  const [date, setDate] = useState(() => todayIn(timezone));
  const [startsAt, setStartsAt] = useState<string | null>(null);
  const [bookingKey, setBookingKey] = useState(() => idempotencyKey());
  const [notice, setNotice] = useState<string | null>(null);
  const [booked, setBooked] = useState<Schemas['Appointment'] | null>(null);
  const book = useBook(slug);

  const chosen = services.filter((service) => serviceIds.includes(service.id));
  const totalCents = chosen.reduce((sum, service) => sum + service.priceCents, 0);
  const totalMinutes = chosen.reduce((sum, service) => sum + service.durationMinutes, 0);
  const professionalName =
    professionalId === ANY
      ? 'Qualquer profissional'
      : professionals.find((p) => p.id === professionalId)?.name;

  const chooseSlot = (start: string) => {
    setStartsAt(start);
    // Nova escolha = nova tentativa: chave nova. Repetir o mesmo envio reusa a chave.
    setBookingKey(idempotencyKey());
    setStep(isClientHere ? 'confirm' : 'identify');
  };

  const confirm = async () => {
    try {
      const appointment = await book.mutateAsync({
        idempotencyKey: bookingKey,
        serviceIds,
        startsAt: startsAt!,
        professionalId: professionalId === ANY ? undefined : professionalId,
      });
      setBooked(appointment);
      setStep('done');
    } catch (error) {
      if (
        error instanceof ApiError &&
        (error.code === 'slot-unavailable' || error.code === 'appointment-conflict')
      ) {
        setNotice('Alguém acabou de reservar esse horário. Escolha outro, por favor.');
        setStartsAt(null);
        setStep('time');
        return;
      }
      setNotice(errorMessage(error));
    }
  };

  if (step === 'done' && booked) {
    return (
      <section className="grid justify-items-start gap-4" aria-live="polite">
        <CheckCircle2 aria-hidden className="text-status-completed size-12" />
        <h2 className="text-4xl font-bold">Horário marcado!</h2>
        <p className="text-lg">
          {formatDateLong(
            new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date(booked.startsAt)),
            timezone,
          )}{' '}
          às <strong>{formatTime(booked.startsAt, timezone)}</strong> com {booked.professional.name}.
        </p>
        <p className="text-muted-foreground">Enviamos a confirmação para o seu e-mail.</p>
        <Button asChild>
          <Link href={`/${slug}/meus-agendamentos`}>Ver meus agendamentos</Link>
        </Button>
      </section>
    );
  }

  const currentIndex = STEPS.findIndex((item) => item.id === (step === 'identify' ? 'confirm' : step));

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_18rem]">
      <div className="min-w-0">
        <ol className="mb-6 flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-label="Etapas">
          {STEPS.map((item, index) => (
            <li
              key={item.id}
              aria-current={index === currentIndex ? 'step' : undefined}
              className={cn(
                'flex items-center gap-1.5',
                index === currentIndex ? 'text-foreground font-semibold' : 'text-muted-foreground',
              )}
            >
              <span
                className={cn(
                  'grid size-6 place-items-center rounded-full border text-xs',
                  index < currentIndex && 'bg-primary border-primary text-primary-foreground',
                  index === currentIndex && 'border-primary',
                )}
              >
                {index < currentIndex ? <Check aria-hidden className="size-3.5" /> : index + 1}
              </span>
              {item.label}
            </li>
          ))}
        </ol>

        {notice && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        )}

        {step !== 'services' && (
          <Button
            variant="ghost"
            size="sm"
            className="mb-3 -ml-2"
            onClick={() => {
              setNotice(null);
              setStep(step === 'professional' ? 'services' : step === 'time' ? 'professional' : 'time');
            }}
          >
            <ArrowLeft aria-hidden /> Voltar
          </Button>
        )}

        {step === 'services' && (
          <StepServices
            services={services}
            selected={serviceIds}
            onToggle={(id) =>
              setServiceIds((current) =>
                current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
              )
            }
            onNext={() => setStep('professional')}
          />
        )}
        {step === 'professional' && (
          <StepProfessional
            professionals={professionals}
            selected={professionalId}
            onSelect={(id) => {
              setProfessionalId(id);
              setStep('time');
            }}
          />
        )}
        {step === 'time' && (
          <StepTime
            slug={slug}
            timezone={timezone}
            serviceIds={serviceIds}
            professionalId={professionalId === ANY ? undefined : professionalId}
            date={date}
            onDateChange={setDate}
            onSelect={chooseSlot}
          />
        )}
        {step === 'identify' && (
          <section>
            <h2 className="mb-1 text-3xl font-bold">Quem vai ser atendido?</h2>
            <p className="text-muted-foreground mb-4 text-sm">Só para guardarmos o seu horário.</p>
            <ClientAuthForm slug={slug} onAuthenticated={() => setStep('confirm')} />
          </section>
        )}
        {step === 'confirm' && (
          <section className="grid gap-4">
            <h2 className="text-3xl font-bold">Confirme seu horário</h2>
            <p className="text-lg">
              {formatDateLong(date, timezone)} às <strong>{formatTime(startsAt!, timezone)}</strong>
            </p>
            <Button size="lg" onClick={confirm} disabled={book.isPending} className="w-full sm:w-fit">
              {book.isPending ? 'Reservando…' : 'Confirmar agendamento'}
            </Button>
          </section>
        )}
      </div>

      <aside
        aria-label="Resumo"
        className="bg-card border-border h-fit rounded-lg border p-4 lg:sticky lg:top-6"
      >
        <p className="font-heading text-lg font-semibold uppercase">Resumo</p>
        {chosen.length === 0 ? (
          <p className="text-muted-foreground mt-2 text-sm">Escolha um ou mais serviços.</p>
        ) : (
          <dl className="mt-2 grid gap-2 text-sm">
            <div>
              <dt className="text-muted-foreground">Serviços</dt>
              <dd>{chosen.map((service) => service.name).join(', ')}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Profissional</dt>
              <dd>{professionalName}</dd>
            </div>
            {startsAt && (
              <div>
                <dt className="text-muted-foreground">Quando</dt>
                <dd>
                  {formatDateLong(date, timezone)}, {formatTime(startsAt, timezone)}
                </dd>
              </div>
            )}
            <div className="border-border flex justify-between border-t pt-2 font-semibold">
              <dt>Total · {totalMinutes} min</dt>
              <dd>{formatMoney(totalCents)}</dd>
            </div>
          </dl>
        )}
        <p className="text-muted-foreground mt-3 text-xs">Pagamento na barbearia.</p>
      </aside>
    </div>
  );
}

function StepServices({
  services,
  selected,
  onToggle,
  onNext,
}: {
  services: Service[];
  selected: string[];
  onToggle: (id: string) => void;
  onNext: () => void;
}) {
  return (
    <section>
      <h2 className="mb-4 text-3xl font-bold">O que vamos fazer?</h2>
      <ul className="grid gap-2">
        {services.map((service) => {
          const checked = selected.includes(service.id);
          return (
            <li key={service.id}>
              <button
                type="button"
                role="checkbox"
                aria-checked={checked}
                onClick={() => onToggle(service.id)}
                className={cn(
                  'border-border hover:border-primary flex w-full items-center gap-3 rounded-lg border p-4 text-left transition-colors',
                  'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
                  checked && 'border-primary bg-accent',
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    'grid size-5 shrink-0 place-items-center rounded border',
                    checked && 'bg-primary border-primary text-primary-foreground',
                  )}
                >
                  {checked && <Check className="size-3.5" />}
                </span>
                <span className="flex-1">
                  <span className="block font-medium">{service.name}</span>
                  <span className="text-muted-foreground text-sm">
                    {service.durationMinutes} min{service.description ? ` · ${service.description}` : ''}
                  </span>
                </span>
                <span className="font-semibold">{formatMoney(service.priceCents)}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <Button size="lg" className="mt-6 w-full sm:w-fit" disabled={selected.length === 0} onClick={onNext}>
        Continuar
      </Button>
    </section>
  );
}

function StepProfessional({
  professionals,
  selected,
  onSelect,
}: {
  professionals: Professional[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  const options = [
    { id: ANY, name: 'Qualquer profissional', hint: 'Mais horários disponíveis' },
    ...professionals,
  ];
  return (
    <section>
      <h2 className="mb-4 text-3xl font-bold">Com quem?</h2>
      <ul className="grid gap-2 sm:grid-cols-2">
        {options.map((option) => (
          <li key={option.id}>
            <button
              type="button"
              onClick={() => onSelect(option.id)}
              aria-pressed={selected === option.id}
              className={cn(
                'border-border hover:border-primary w-full rounded-lg border p-4 text-left transition-colors',
                'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
                selected === option.id && 'border-primary bg-accent',
              )}
            >
              <span className="font-heading block text-xl font-semibold uppercase">{option.name}</span>
              {'hint' in option && <span className="text-muted-foreground text-sm">{option.hint}</span>}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function StepTime({
  slug,
  timezone,
  serviceIds,
  professionalId,
  date,
  onDateChange,
  onSelect,
}: {
  slug: string;
  timezone: string;
  serviceIds: string[];
  professionalId?: string;
  date: string;
  onDateChange: (date: string) => void;
  onSelect: (start: string) => void;
}) {
  const today = todayIn(timezone);
  const days = Array.from({ length: 14 }, (_, index) => addDays(today, index));
  const availability = usePublicAvailability(slug, date, serviceIds, professionalId);
  // "Qualquer profissional": junta os horários de todos (a API escolhe quem estiver livre).
  const starts = [
    ...new Set(availability.data?.professionals.flatMap((professional) => professional.starts) ?? []),
  ].sort();
  const weekday = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', weekday: 'short' });

  return (
    <section>
      <h2 className="mb-4 text-3xl font-bold">Quando?</h2>
      <div className="-mx-4 mb-6 flex gap-2 overflow-x-auto px-4 pb-2" role="group" aria-label="Dia">
        {days.map((day) => {
          const active = day === date;
          return (
            <button
              key={day}
              type="button"
              aria-pressed={active}
              onClick={() => onDateChange(day)}
              className={cn(
                'border-border hover:border-primary flex min-w-16 flex-col items-center rounded-lg border px-3 py-2',
                'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
                active && 'bg-primary border-primary text-primary-foreground',
              )}
            >
              <span className="text-xs uppercase">
                {day === today ? 'Hoje' : weekday.format(new Date(`${day}T12:00:00Z`))}
              </span>
              <span className="font-heading text-2xl font-bold">{day.slice(8, 10)}</span>
            </button>
          );
        })}
      </div>

      {availability.isLoading ? (
        <LoadingRows rows={3} label="Buscando horários" />
      ) : availability.error ? (
        <p role="alert" className="text-destructive text-sm">
          {errorMessage(availability.error)}
        </p>
      ) : starts.length === 0 ? (
        <p className="text-muted-foreground border-border rounded-lg border border-dashed p-6 text-center text-sm">
          Nenhum horário livre neste dia. Tente outro dia{professionalId ? ' ou outro profissional' : ''}.
        </p>
      ) : (
        <ul
          className="grid grid-cols-3 gap-2 sm:grid-cols-5"
          aria-label={`Horários livres em ${formatDateLong(date, timezone)}`}
        >
          {starts.map((start) => (
            <li key={start}>
              <Button variant="outline" className="w-full" onClick={() => onSelect(start)}>
                {formatTime(start, timezone)}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
