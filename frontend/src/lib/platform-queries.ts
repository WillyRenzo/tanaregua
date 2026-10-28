'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from '@/lib/api/client';
import type { Plan } from '@/lib/plans';

/** Consultas da administração da plataforma (sessão própria, nunca a do painel). */
export const platformQueryKeys = {
  plans: ['platform', 'plans'] as const,
};

export function usePlatformPlans() {
  return useQuery({
    queryKey: platformQueryKeys.plans,
    queryFn: () => unwrap(api.GET('/v1/platform/plans')),
  });
}

export function useSetPlanPrices() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ key, ...body }: { key: string } & Plan['prices']) =>
      unwrap(api.PUT('/v1/platform/plans/{key}/prices', { params: { path: { key } }, body })),
    onSuccess: (plan) =>
      client.setQueryData<Plan[]>(platformQueryKeys.plans, (plans) =>
        plans?.map((item) => (item.key === plan.key ? plan : item)),
      ),
  });
}
