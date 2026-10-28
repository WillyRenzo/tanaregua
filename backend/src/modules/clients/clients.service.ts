import { Inject, Injectable } from '@nestjs/common';
import { notFound, unprocessable } from '../../common/http/domain-error.js';
import { cursorArgs, toPage, type Page } from '../../common/http/pagination.js';
import { TenantDb } from '../../common/tenancy/tenant-db.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { Tx } from '../../prisma/prisma.service.js';
import type { ClientView } from '../registry.responses.js';
import type { CreateClientInput, ListClientsQuery, UpdateClientInput } from './clients.schemas.js';

export type { ClientView };

/** Contato e consentimentos de um cliente, para mensagens de aniversário e campanhas. */
export interface MessagingContact {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  /** AAAA-MM-DD */
  birthDate: string | null;
  emailConsentAt: Date | null;
  whatsappConsentAt: Date | null;
}

type ClientRow = Prisma.ClientGetPayload<object>;

const toView = (row: ClientRow): ClientView => ({
  id: row.id,
  name: row.name,
  phone: row.phone,
  email: row.email,
  birthDate: row.birthDate?.toISOString().slice(0, 10) ?? null,
  notes: row.notes,
  consents: { email: row.emailConsentAt, whatsapp: row.whatsappConsentAt },
  hasAccount: row.userId !== null,
  anonymized: row.anonymizedAt !== null,
});

/**
 * Traduz o input de consentimento para colunas (LGPD): conceder registra a data da
 * concessão, e conceder de novo um canal já consentido mantém a data original.
 */
function consentData(
  consents: CreateClientInput['consents'],
  current?: Pick<ClientRow, 'emailConsentAt' | 'whatsappConsentAt'>,
) {
  const at = (granted: boolean | undefined, previous: Date | null | undefined) =>
    granted === undefined ? undefined : granted ? (previous ?? new Date()) : null;
  return {
    emailConsentAt: at(consents?.email, current?.emailConsentAt),
    whatsappConsentAt: at(consents?.whatsapp, current?.whatsappConsentAt),
  };
}

@Injectable()
export class ClientsService {
  constructor(@Inject(TenantDb) private readonly db: TenantDb) {}

  list(query: ListClientsQuery): Promise<Page<ClientView>> {
    return this.db.run(async (tx, auth) => {
      const digits = query.search?.replace(/\D/g, '');
      const where: Prisma.ClientWhereInput = {
        barbershopId: auth.barbershopId,
        anonymizedAt: null,
        ...(query.search
          ? {
              OR: [
                { name: { contains: query.search, mode: 'insensitive' } },
                ...(digits ? [{ phone: { contains: digits } }] : []),
              ],
            }
          : {}),
      };
      const rows = await tx.client.findMany({
        where,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        ...cursorArgs(query),
      });
      const page = toPage(rows, query.limit);
      return { items: page.items.map(toView), nextCursor: page.nextCursor };
    });
  }

  get(clientId: string): Promise<ClientView> {
    return this.db.run(async (tx, auth) => toView(await this.find(tx, auth.barbershopId, clientId)));
  }

  create(input: CreateClientInput): Promise<ClientView> {
    const { consents, ...fields } = input;
    return this.db.run(async (tx, auth) =>
      toView(
        await tx.client.create({
          data: { ...fields, ...consentData(consents), barbershopId: auth.barbershopId },
        }),
      ),
    );
  }

  update(clientId: string, input: UpdateClientInput): Promise<ClientView> {
    const { consents, ...fields } = input;
    return this.db.run(async (tx, auth) => {
      const client = await this.find(tx, auth.barbershopId, clientId);
      if (client.anonymizedAt) {
        throw unprocessable('client-anonymized', 'Cliente anonimizado não pode ser editado.');
      }
      return toView(
        await tx.client.update({
          where: { id: clientId },
          data: { ...fields, ...consentData(consents, client) },
        }),
      );
    });
  }

  /**
   * Atende pedido de exclusão (LGPD) sem apagar o registro: o histórico de
   * atendimentos e financeiro continua íntegro, mas sem dado pessoal.
   */
  anonymize(clientId: string): Promise<ClientView> {
    return this.db.run(async (tx, auth) => {
      await this.find(tx, auth.barbershopId, clientId);
      return toView(
        await tx.client.update({
          where: { id: clientId },
          data: {
            name: 'Cliente anonimizado',
            phone: null,
            email: null,
            birthDate: null,
            notes: null,
            userId: null,
            emailConsentAt: null,
            whatsappConsentAt: null,
            anonymizedAt: new Date(),
          },
        }),
      );
    });
  }

  /** Contato para notificações; null se o cliente não existe ou foi anonimizado. */
  async contact(tx: Tx, barbershopId: string, clientId: string) {
    const client = await tx.client.findFirst({
      where: { id: clientId, barbershopId, anonymizedAt: null },
      select: { name: true, email: true },
    });
    return client;
  }

  /**
   * Contatos e consentimentos para mensagens de aniversário e campanhas (business-rules §9).
   * Nunca inclui anonimizados. `ids` restringe a esses clientes; `withBirthDate`, a quem
   * tem aniversário cadastrado.
   */
  async messagingContacts(
    tx: Tx,
    barbershopId: string,
    filter: { ids?: string[]; withBirthDate?: boolean } = {},
  ): Promise<MessagingContact[]> {
    const rows = await tx.client.findMany({
      where: {
        barbershopId,
        anonymizedAt: null,
        ...(filter.ids ? { id: { in: filter.ids } } : {}),
        ...(filter.withBirthDate ? { birthDate: { not: null } } : {}),
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        birthDate: true,
        emailConsentAt: true,
        whatsappConsentAt: true,
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => ({ ...row, birthDate: row.birthDate?.toISOString().slice(0, 10) ?? null }));
  }

  /**
   * Cadastro de cliente ligado a uma conta de login (agendamento online). Reaproveita o
   * cadastro existente se a conta já tiver vínculo; senão cria um novo nesta barbearia.
   */
  async ensureForUser(
    tx: Tx,
    barbershopId: string,
    user: { id: string; name: string; email: string },
    phone?: string,
  ): Promise<string> {
    const existing = await tx.client.findUnique({
      where: { barbershopId_userId: { barbershopId, userId: user.id } },
      select: { id: true },
    });
    if (existing) return existing.id;
    const created = await tx.client.create({
      data: { barbershopId, userId: user.id, name: user.name, email: user.email, phone },
      select: { id: true },
    });
    return created.id;
  }

  async findIdForUser(tx: Tx, barbershopId: string, userId: string): Promise<string> {
    const client = await tx.client.findUnique({
      where: { barbershopId_userId: { barbershopId, userId } },
      select: { id: true },
    });
    if (!client) throw notFound('Cliente');
    return client.id;
  }

  /** Usado pela agenda/comanda para validar que o cliente é desta barbearia. */
  async assertExists(tx: Tx, barbershopId: string, clientId: string): Promise<void> {
    await this.find(tx, barbershopId, clientId);
  }

  private async find(tx: Tx, barbershopId: string, clientId: string): Promise<ClientRow> {
    const client = await tx.client.findFirst({ where: { id: clientId, barbershopId } });
    if (!client) throw notFound('Cliente');
    return client;
  }
}
