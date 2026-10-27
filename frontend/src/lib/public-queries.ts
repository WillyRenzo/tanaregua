'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from '@/lib/api/client';

/** Consultas da página pública de agendamento (cliente final). */

export function usePublicAvailability(
  slug: string,
  date: string,
  serviceIds: string[],
  professionalId?: string,
) {
  return useQuery({
    queryKey: ['public-availability', slug, date, serviceIds.join(','), professionalId],
    enabled: serviceIds.length > 0,
    // Horários mudam a cada agendamento: sempre buscar de novo ao voltar à tela.
    staleTime: 0,
    queryFn: () =>
      unwrap(
        api.GET('/v1/public/{slug}/availability', {
          params: { path: { slug }, query: { date, serviceIds: serviceIds.join(','), professionalId } },
        }),
      ),
  });
}

export function useMyAppointments(slug: string, enabled: boolean) {
  return useQuery({
    queryKey: ['my-appointments', slug],
    enabled,
    queryFn: () => unwrap(api.GET('/v1/public/{slug}/me/appointments', { params: { path: { slug } } })),
  });
}

export function useBook(slug: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      idempotencyKey,
      ...body
    }: {
      idempotencyKey: string;
      professionalId?: string;
      serviceIds: string[];
      startsAt: string;
    }) =>
      unwrap(
        api.POST('/v1/public/{slug}/bookings', {
          params: { path: { slug } },
          body,
          headers: { 'Idempotency-Key': idempotencyKey },
        }),
      ),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ['public-availability', slug] });
      void client.invalidateQueries({ queryKey: ['my-appointments', slug] });
    },
  });
}

export function useCancelBooking(slug: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(api.POST('/v1/public/{slug}/me/appointments/{id}/cancel', { params: { path: { slug, id } } })),
    onSettled: () => client.invalidateQueries({ queryKey: ['my-appointments', slug] }),
  });
}

export function useRescheduleBooking(slug: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, startsAt }: { id: string; startsAt: string }) =>
      unwrap(
        api.POST('/v1/public/{slug}/me/appointments/{id}/reschedule', {
          params: { path: { slug, id } },
          body: { startsAt },
        }),
      ),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ['public-availability', slug] });
      void client.invalidateQueries({ queryKey: ['my-appointments', slug] });
    },
  });
}
