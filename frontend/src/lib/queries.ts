'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, idempotencyKey, unwrap } from '@/lib/api/client';
import type { components, paths } from '@/lib/api/schema';

/** Tipos de resposta, direto do contrato OpenAPI do backend. */
export type Schemas = components['schemas'];
export type Appointment = Schemas['Appointment'];
export type DayAgenda = Schemas['DayAgenda'];
export type Order = Schemas['Order'];
export type Client = Schemas['Client'];
export type Service = Schemas['Service'];
export type StaffMember = Schemas['StaffMember'];
export type CommissionRule = Schemas['CommissionRule'];
export type BarbershopSettings = Schemas['BarbershopSettings'];
export type Product = Schemas['Product'];
export type StockMovement = Schemas['StockMovement'];
export type ServicePackage = Schemas['ServicePackage'];
export type ClientPackage = Schemas['ClientPackage'];
export type MyPackage = Schemas['MyPackage'];
export type WhatsAppTemplate = Schemas['WhatsAppTemplate'];
export type BirthdaySettings = Schemas['BirthdaySettings'];
export type TemplateConfig = NonNullable<BirthdaySettings['whatsappTemplate']>;
export type BirthdayEntry = Schemas['BirthdayEntry'];
export type Campaign = Schemas['Campaign'];
export type CampaignDetail = Schemas['CampaignDetail'];
export type Audience = Campaign['audience'];
export type MessageStatus = CampaignDetail['messages'][number]['status'];
export type PaymentMethod = NonNullable<Order['paymentMethod']>;

type Body<P extends keyof paths, M extends 'post' | 'patch' | 'put'> = NonNullable<
  paths[P][M] extends { requestBody?: { content: { 'application/json': infer B } } } ? B : never
>;

export const queryKeys = {
  barbershop: ['barbershop'] as const,
  plans: ['plans'] as const,
  subscription: ['subscription'] as const,
  staff: ['staff'] as const,
  roles: ['roles'] as const,
  schedule: (id: string) => ['staff', id, 'schedule'] as const,
  timeOffs: (id: string, from: string, to: string) => ['staff', id, 'time-offs', from, to] as const,
  clients: (search: string) => ['clients', search] as const,
  client: (id: string) => ['client', id] as const,
  clientNoShows: (id: string) => ['client', id, 'no-shows'] as const,
  services: (includeInactive: boolean) => ['services', includeInactive] as const,
  commissionRules: ['commission-rules'] as const,
  agenda: (date: string) => ['agenda', date] as const,
  availability: (date: string, serviceIds: string[], professionalId?: string) =>
    ['availability', date, serviceIds.join(','), professionalId] as const,
  orders: (status?: string) => ['orders', status ?? 'all'] as const,
  order: (id: string) => ['order', id] as const,
  orderByAppointment: (appointmentId: string) => ['orders', 'appointment', appointmentId] as const,
  cash: (date: string) => ['cash', date] as const,
  commissions: (from: string, to: string) => ['commissions', from, to] as const,
  report: (from: string, to: string) => ['report', from, to] as const,
  products: (includeInactive: boolean) => ['products', includeInactive] as const,
  productMovements: (id: string) => ['products', id, 'movements'] as const,
  packages: (includeInactive: boolean) => ['packages', includeInactive] as const,
  clientPackages: (clientId?: string, status?: string) =>
    ['client-packages', clientId ?? 'all', status ?? 'all'] as const,
  whatsapp: ['whatsapp'] as const,
  whatsappTemplates: ['whatsapp-templates'] as const,
  birthdaySettings: ['birthday-settings'] as const,
  birthdays: (month: number) => ['birthdays', month] as const,
  campaigns: ['campaigns'] as const,
  campaign: (id: string) => ['campaigns', id] as const,
};

// ───────────── Planos ─────────────

/** Catálogo da plataforma: muda raramente. */
export function usePlans() {
  return useQuery({
    queryKey: queryKeys.plans,
    queryFn: () => unwrap(api.GET('/v1/plans')),
    staleTime: 60 * 60_000,
  });
}

// ───────────── Assinatura ─────────────

export type SubscriptionDetail = Schemas['SubscriptionDetail'];
export type BillingInterval = Schemas['BillingInterval'];

/** Assinatura da barbearia (quem assina e paga). Enquanto espera o gateway confirmar, consulta de novo. */
export function useSubscription(options: { awaitingConfirmation?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.subscription,
    queryFn: () => unwrap(api.GET('/v1/subscription')),
    refetchInterval: options.awaitingConfirmation ? 3000 : false,
  });
}

export function useStartCheckout() {
  return useMutation({
    mutationFn: (body: Body<'/v1/subscription/checkout', 'post'>) =>
      unwrap(api.POST('/v1/subscription/checkout', { body })),
  });
}

// ───────────── Barbearia ─────────────

export function useBarbershop() {
  return useQuery({
    queryKey: queryKeys.barbershop,
    queryFn: () => unwrap(api.GET('/v1/barbershop')),
    staleTime: 5 * 60_000,
  });
}

export function useUpdateBarbershop() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: Body<'/v1/barbershop', 'patch'>) => unwrap(api.PATCH('/v1/barbershop', { body })),
    onSuccess: (data) => client.setQueryData(queryKeys.barbershop, data),
  });
}

/** Envia o logo (multipart). A API valida o conteúdo e reprocessa a imagem. */
export function useUploadLogo() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (file: File) =>
      unwrap(
        api.PUT('/v1/barbershop/logo', {
          // O tipo gerado descreve o campo como string binária; quem vai no corpo é o FormData.
          body: { file: '' },
          bodySerializer: () => {
            const form = new FormData();
            form.append('file', file);
            return form;
          },
        }),
      ),
    onSuccess: (data) => client.setQueryData(queryKeys.barbershop, data),
  });
}

export function useRemoveLogo() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(api.DELETE('/v1/barbershop/logo')),
    onSuccess: (data) => client.setQueryData(queryKeys.barbershop, data),
  });
}

// ───────────── Equipe ─────────────

export function useStaff() {
  return useQuery({ queryKey: queryKeys.staff, queryFn: () => unwrap(api.GET('/v1/staff')) });
}

export function useRoles() {
  return useQuery({
    queryKey: queryKeys.roles,
    queryFn: () => unwrap(api.GET('/v1/roles')),
    staleTime: 5 * 60_000,
  });
}

export function useCreateStaff() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: Body<'/v1/staff', 'post'>) => unwrap(api.POST('/v1/staff', { body })),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.staff }),
  });
}

export function useUpdateStaff() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: Body<'/v1/staff/{id}', 'patch'> & { id: string }) =>
      unwrap(api.PATCH('/v1/staff/{id}', { params: { path: { id } }, body })),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.staff }),
  });
}

export function useSchedule(id: string) {
  return useQuery({
    queryKey: queryKeys.schedule(id),
    queryFn: () => unwrap(api.GET('/v1/staff/{id}/schedule', { params: { path: { id } } })),
  });
}

export function useReplaceSchedule(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: Body<'/v1/staff/{id}/schedule', 'put'>) =>
      unwrap(api.PUT('/v1/staff/{id}/schedule', { params: { path: { id } }, body })),
    onSuccess: (data) => {
      client.setQueryData(queryKeys.schedule(id), data);
      void client.invalidateQueries({ queryKey: ['agenda'] });
    },
  });
}

export function useTimeOffs(id: string, from: string, to: string) {
  return useQuery({
    queryKey: queryKeys.timeOffs(id, from, to),
    queryFn: () =>
      unwrap(api.GET('/v1/staff/{id}/time-offs', { params: { path: { id }, query: { from, to } } })),
  });
}

export function useCreateTimeOff(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: Body<'/v1/staff/{id}/time-offs', 'post'>) =>
      unwrap(api.POST('/v1/staff/{id}/time-offs', { params: { path: { id } }, body })),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['staff', id, 'time-offs'] });
      void client.invalidateQueries({ queryKey: ['agenda'] });
    },
  });
}

export function useDeleteTimeOff(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (timeOffId: string) =>
      unwrap(api.DELETE('/v1/staff/{id}/time-offs/{timeOffId}', { params: { path: { id, timeOffId } } })),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['staff', id, 'time-offs'] });
      void client.invalidateQueries({ queryKey: ['agenda'] });
    },
  });
}

// ───────────── Clientes ─────────────

export function useClients(search: string) {
  return useInfiniteQuery({
    queryKey: queryKeys.clients(search),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      unwrap(
        api.GET('/v1/clients', {
          params: { query: { limit: 30, search: search || undefined, cursor: pageParam } },
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}

export function useClient(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.client(id ?? ''),
    enabled: Boolean(id),
    queryFn: () => unwrap(api.GET('/v1/clients/{id}', { params: { path: { id: id! } } })),
  });
}

export function useCreateClient() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: Body<'/v1/clients', 'post'>) => unwrap(api.POST('/v1/clients', { body })),
    onSuccess: () => client.invalidateQueries({ queryKey: ['clients'] }),
  });
}

export function useUpdateClient() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: Body<'/v1/clients/{id}', 'patch'> & { id: string }) =>
      unwrap(api.PATCH('/v1/clients/{id}', { params: { path: { id } }, body })),
    onSuccess: (data) => {
      client.setQueryData(queryKeys.client(data.id), data);
      void client.invalidateQueries({ queryKey: ['clients'] });
    },
  });
}

export function useAnonymizeClient() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => unwrap(api.POST('/v1/clients/{id}/anonymize', { params: { path: { id } } })),
    onSuccess: (data) => {
      client.setQueryData(queryKeys.client(data.id), data);
      void client.invalidateQueries({ queryKey: ['clients'] });
    },
  });
}

// ───────────── Catálogo ─────────────

export function useServices(includeInactive = false) {
  return useQuery({
    queryKey: queryKeys.services(includeInactive),
    queryFn: () =>
      unwrap(
        api.GET('/v1/services', {
          params: { query: { includeInactive: includeInactive ? 'true' : 'false' } },
        }),
      ),
  });
}

export function useCreateService() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: Body<'/v1/services', 'post'>) => unwrap(api.POST('/v1/services', { body })),
    onSuccess: () => client.invalidateQueries({ queryKey: ['services'] }),
  });
}

export function useUpdateService() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: Body<'/v1/services/{id}', 'patch'> & { id: string }) =>
      unwrap(api.PATCH('/v1/services/{id}', { params: { path: { id } }, body })),
    onSuccess: () => client.invalidateQueries({ queryKey: ['services'] }),
  });
}

export function useCommissionRules(enabled = true) {
  return useQuery({
    queryKey: queryKeys.commissionRules,
    enabled,
    queryFn: () => unwrap(api.GET('/v1/commission-rules')),
  });
}

export function useUpsertCommissionRule() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: Body<'/v1/commission-rules', 'put'>) =>
      unwrap(api.PUT('/v1/commission-rules', { body })),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.commissionRules }),
  });
}

export function useDeleteCommissionRule() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => unwrap(api.DELETE('/v1/commission-rules/{id}', { params: { path: { id } } })),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.commissionRules }),
  });
}

// ───────────── Produtos e estoque ─────────────

export function useProducts(includeInactive = false) {
  return useQuery({
    queryKey: queryKeys.products(includeInactive),
    queryFn: () =>
      unwrap(
        api.GET('/v1/products', {
          params: { query: { includeInactive: includeInactive ? 'true' : 'false' } },
        }),
      ),
  });
}

export function useProductMovements(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.productMovements(id ?? ''),
    enabled: Boolean(id),
    queryFn: () => unwrap(api.GET('/v1/products/{id}/movements', { params: { path: { id: id! } } })),
  });
}

/** Qualquer mudança de produto (cadastro, entrada, ajuste) recarrega listas e histórico. */
function useProductMutation<TVariables>(fn: (variables: TVariables) => Promise<Product>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => client.invalidateQueries({ queryKey: ['products'] }),
  });
}

export function useCreateProduct() {
  return useProductMutation((body: Body<'/v1/products', 'post'>) =>
    unwrap(api.POST('/v1/products', { body })),
  );
}

export function useUpdateProduct() {
  return useProductMutation(({ id, ...body }: Body<'/v1/products/{id}', 'patch'> & { id: string }) =>
    unwrap(api.PATCH('/v1/products/{id}', { params: { path: { id } }, body })),
  );
}

export function useStockEntry() {
  return useProductMutation(
    ({ id, ...body }: Body<'/v1/products/{id}/stock-entries', 'post'> & { id: string }) =>
      unwrap(api.POST('/v1/products/{id}/stock-entries', { params: { path: { id } }, body })),
  );
}

export function useStockAdjustment() {
  return useProductMutation(
    ({ id, ...body }: Body<'/v1/products/{id}/stock-adjustments', 'post'> & { id: string }) =>
      unwrap(api.POST('/v1/products/{id}/stock-adjustments', { params: { path: { id } }, body })),
  );
}

// ───────────── Pacotes ─────────────

export function usePackages(includeInactive = false, enabled = true) {
  return useQuery({
    queryKey: queryKeys.packages(includeInactive),
    enabled,
    queryFn: () =>
      unwrap(
        api.GET('/v1/packages', {
          params: { query: { includeInactive: includeInactive ? 'true' : 'false' } },
        }),
      ),
  });
}

export function useCreatePackage() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: Body<'/v1/packages', 'post'>) => unwrap(api.POST('/v1/packages', { body })),
    onSuccess: () => client.invalidateQueries({ queryKey: ['packages'] }),
  });
}

export function useUpdatePackage() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: Body<'/v1/packages/{id}', 'patch'> & { id: string }) =>
      unwrap(api.PATCH('/v1/packages/{id}', { params: { path: { id } }, body })),
    onSuccess: () => client.invalidateQueries({ queryKey: ['packages'] }),
  });
}

export function useClientPackages(
  query: { clientId?: string; status?: ClientPackage['status'] },
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.clientPackages(query.clientId, query.status),
    enabled,
    queryFn: () => unwrap(api.GET('/v1/client-packages', { params: { query } })),
  });
}

export function useRefundPackage() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: Body<'/v1/client-packages/{id}/refund', 'post'> & { id: string }) =>
      unwrap(api.POST('/v1/client-packages/{id}/refund', { params: { path: { id } }, body })),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['client-packages'] });
      void client.invalidateQueries({ queryKey: ['cash'] });
    },
  });
}

// ───────────── Agenda ─────────────

export function useDayAgenda(date: string) {
  return useQuery({
    queryKey: queryKeys.agenda(date),
    queryFn: () => unwrap(api.GET('/v1/agenda/day', { params: { query: { date } } })),
    // Recepção e profissionais olham a agenda o dia todo: atualiza sozinha.
    refetchInterval: 60_000,
  });
}

/** Agendamentos de um período (semana ou mês; a API aceita até 31 dias). */
export function useAppointmentsRange(
  query: { from: string; to: string; professionalId?: string },
  enabled = true,
) {
  return useQuery({
    // Sob 'agenda': as mutações de agendamento já invalidam essa chave.
    queryKey: ['agenda', 'range', query.from, query.to, query.professionalId ?? 'all'] as const,
    enabled,
    queryFn: () => unwrap(api.GET('/v1/appointments', { params: { query } })),
    refetchInterval: 60_000,
  });
}

export function useAvailability(date: string, serviceIds: string[], professionalId?: string) {
  return useQuery({
    queryKey: queryKeys.availability(date, serviceIds, professionalId),
    enabled: serviceIds.length > 0,
    queryFn: () =>
      unwrap(
        api.GET('/v1/availability', {
          params: { query: { date, serviceIds: serviceIds.join(','), professionalId } },
        }),
      ),
  });
}

export function useCreateAppointment() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: Body<'/v1/appointments', 'post'>) =>
      unwrap(api.POST('/v1/appointments', { body, headers: { 'Idempotency-Key': idempotencyKey() } })),
    onSettled: () => client.invalidateQueries({ queryKey: ['agenda'] }),
  });
}

export function useUpdateAppointment() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: Body<'/v1/appointments/{id}', 'patch'> & { id: string }) =>
      unwrap(api.PATCH('/v1/appointments/{id}', { params: { path: { id } }, body })),
    onSettled: () => client.invalidateQueries({ queryKey: ['agenda'] }),
  });
}

export function useChangeAppointmentStatus() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: Body<'/v1/appointments/{id}/status', 'post'> & { id: string }) =>
      unwrap(api.POST('/v1/appointments/{id}/status', { params: { path: { id } }, body })),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ['agenda'] });
      // Falta muda a contagem de faltas sem justificativa do cliente.
      void client.invalidateQueries({ queryKey: ['client'] });
    },
  });
}

/** Justificativa de uma falta (só a equipe vê); `null` remove. */
export function useJustifyNoShow() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, justification }: { id: string; justification: string | null }) =>
      unwrap(
        api.PUT('/v1/appointments/{id}/no-show-justification', {
          params: { path: { id } },
          body: { justification },
        }),
      ),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ['agenda'] });
      void client.invalidateQueries({ queryKey: ['client'] });
    },
  });
}

/** Faltas sem justificativa do cliente (informação para a equipe; não bloqueia nada). */
export function useClientNoShows(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.clientNoShows(id ?? ''),
    enabled: Boolean(id),
    queryFn: () => unwrap(api.GET('/v1/clients/{id}/no-shows', { params: { path: { id: id! } } })),
  });
}

// ───────────── Comandas e financeiro ─────────────

export function useOrders(status?: 'OPEN' | 'CLOSED' | 'VOIDED') {
  return useInfiniteQuery({
    queryKey: queryKeys.orders(status),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      unwrap(api.GET('/v1/orders', { params: { query: { limit: 30, status, cursor: pageParam } } })),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}

export function useOrder(id: string) {
  return useQuery({
    queryKey: queryKeys.order(id),
    queryFn: () => unwrap(api.GET('/v1/orders/{id}', { params: { path: { id } } })),
  });
}

function useOrderMutation<TVariables>(fn: (variables: TVariables) => Promise<Order>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (order) => {
      client.setQueryData(queryKeys.order(order.id), order);
      void client.invalidateQueries({ queryKey: ['orders'] });
      void client.invalidateQueries({ queryKey: ['agenda'] });
      void client.invalidateQueries({ queryKey: ['cash'] });
      // Fechar e estornar mexem no estoque e nos saldos de pacotes.
      void client.invalidateQueries({ queryKey: ['products'] });
      void client.invalidateQueries({ queryKey: ['client-packages'] });
    },
  });
}

export function useOpenOrder() {
  return useOrderMutation((body: Body<'/v1/orders', 'post'>) => unwrap(api.POST('/v1/orders', { body })));
}

export function useAddOrderItem(orderId: string) {
  return useOrderMutation((body: Body<'/v1/orders/{id}/items', 'post'>) =>
    unwrap(api.POST('/v1/orders/{id}/items', { params: { path: { id: orderId } }, body })),
  );
}

export function useUpdateOrderItem(orderId: string) {
  return useOrderMutation(
    ({ itemId, ...body }: Body<'/v1/orders/{id}/items/{itemId}', 'patch'> & { itemId: string }) =>
      unwrap(
        api.PATCH('/v1/orders/{id}/items/{itemId}', { params: { path: { id: orderId, itemId } }, body }),
      ),
  );
}

export function useRemoveOrderItem(orderId: string) {
  return useOrderMutation((itemId: string) =>
    unwrap(api.DELETE('/v1/orders/{id}/items/{itemId}', { params: { path: { id: orderId, itemId } } })),
  );
}

export function useCloseOrder(orderId: string) {
  return useOrderMutation((body: Body<'/v1/orders/{id}/close', 'post'>) =>
    unwrap(
      api.POST('/v1/orders/{id}/close', {
        params: { path: { id: orderId } },
        body,
        headers: { 'Idempotency-Key': idempotencyKey() },
      }),
    ),
  );
}

/** Paga um serviço da comanda com sessão de pacote do cliente (`null` volta a cobrar). */
export function useApplyPackage(orderId: string) {
  return useOrderMutation(({ itemId, clientPackageId }: { itemId: string; clientPackageId: string | null }) =>
    unwrap(
      api.PUT('/v1/orders/{id}/items/{itemId}/package', {
        params: { path: { id: orderId, itemId } },
        body: { clientPackageId },
      }),
    ),
  );
}

export function useVoidOrder(orderId: string) {
  return useOrderMutation((body: Body<'/v1/orders/{id}/void', 'post'>) =>
    unwrap(api.POST('/v1/orders/{id}/void', { params: { path: { id: orderId } }, body })),
  );
}

export function useCashDay(date: string) {
  return useQuery({
    queryKey: queryKeys.cash(date),
    queryFn: () => unwrap(api.GET('/v1/cash/day', { params: { query: { date } } })),
  });
}

export function useCommissions(from: string, to: string) {
  return useQuery({
    queryKey: queryKeys.commissions(from, to),
    queryFn: () => unwrap(api.GET('/v1/commissions', { params: { query: { from, to } } })),
  });
}

export function useReportSummary(from: string, to: string) {
  return useQuery({
    queryKey: queryKeys.report(from, to),
    queryFn: () => unwrap(api.GET('/v1/reports/summary', { params: { query: { from, to } } })),
  });
}

// ───────────── Aniversários e campanhas ─────────────

export function useWhatsApp(enabled = true) {
  return useQuery({
    queryKey: queryKeys.whatsapp,
    enabled,
    queryFn: () => unwrap(api.GET('/v1/whatsapp')),
  });
}

export function useConnectWhatsApp() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: Body<'/v1/whatsapp', 'put'>) => unwrap(api.PUT('/v1/whatsapp', { body })),
    onSuccess: (data) => {
      client.setQueryData(queryKeys.whatsapp, data);
      void client.invalidateQueries({ queryKey: ['whatsapp-templates'] });
      void client.invalidateQueries({ queryKey: queryKeys.birthdaySettings });
    },
  });
}

export function useDisconnectWhatsApp() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(api.DELETE('/v1/whatsapp')),
    onSuccess: () => {
      client.setQueryData(queryKeys.whatsapp, { connection: null });
      client.removeQueries({ queryKey: ['whatsapp-templates'] });
      void client.invalidateQueries({ queryKey: queryKeys.birthdaySettings });
    },
  });
}

export function useWhatsAppTemplates(enabled = true) {
  return useQuery({
    queryKey: queryKeys.whatsappTemplates,
    enabled,
    queryFn: () => unwrap(api.GET('/v1/whatsapp/templates')),
  });
}

export function useBirthdaySettings(enabled = true) {
  return useQuery({
    queryKey: queryKeys.birthdaySettings,
    enabled,
    queryFn: () => unwrap(api.GET('/v1/birthday-settings')),
  });
}

export function useUpdateBirthdaySettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: Body<'/v1/birthday-settings', 'put'>) =>
      unwrap(api.PUT('/v1/birthday-settings', { body })),
    onSuccess: (data) => client.setQueryData(queryKeys.birthdaySettings, data),
  });
}

export function useBirthdays(month: number) {
  return useQuery({
    queryKey: queryKeys.birthdays(month),
    queryFn: () => unwrap(api.GET('/v1/birthdays', { params: { query: { month } } })),
  });
}

export function useCampaigns(enabled = true) {
  return useQuery({
    queryKey: queryKeys.campaigns,
    enabled,
    queryFn: () => unwrap(api.GET('/v1/campaigns')),
    // As mensagens saem pelo outbox em segundos: a situação muda sem ação do usuário.
    refetchInterval: 15_000,
  });
}

export function useCampaign(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.campaign(id ?? ''),
    enabled: Boolean(id),
    queryFn: () => unwrap(api.GET('/v1/campaigns/{id}', { params: { path: { id: id! } } })),
    refetchInterval: (query) => (query.state.data?.counts.pending ? 5_000 : false),
  });
}

export function usePreviewCampaign() {
  return useMutation({
    mutationFn: (body: Body<'/v1/campaigns/preview', 'post'>) =>
      unwrap(api.POST('/v1/campaigns/preview', { body })),
  });
}

export function useCreateCampaign() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: Body<'/v1/campaigns', 'post'>) =>
      unwrap(api.POST('/v1/campaigns', { body, headers: { 'Idempotency-Key': idempotencyKey() } })),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.campaigns }),
  });
}
