import type { MessagingContact } from '../clients/clients.service.js';
import type { Audience, MessageChannel } from './marketing.schemas.js';
import { toWhatsAppNumber } from './whatsapp/whatsapp-templates.js';

export type { MessagingContact };

/** Fatos de atendimento que os filtros usam, calculados pelo módulo de agenda. */
export interface AudienceFacts {
  now: Date;
  /** Último atendimento concluído de cada cliente. */
  lastVisits: Map<string, Date>;
  /** Clientes que fizeram o serviço do filtro `service` no período. */
  serviceClientIds: Set<string>;
}

const DAY_MS = 24 * 60 * 60_000;

export function selectAudience(
  contacts: MessagingContact[],
  audience: Audience,
  facts: AudienceFacts,
): MessagingContact[] {
  switch (audience.kind) {
    case 'all':
      return contacts;
    case 'inactive': {
      const cutoff = facts.now.getTime() - audience.days * DAY_MS;
      return contacts.filter((contact) => {
        const lastVisit = facts.lastVisits.get(contact.id);
        return lastVisit !== undefined && lastVisit.getTime() <= cutoff;
      });
    }
    case 'birthday-month': {
      const month = String(audience.month).padStart(2, '0');
      return contacts.filter((contact) => contact.birthDate?.slice(5, 7) === month);
    }
    case 'service':
      return contacts.filter((contact) => facts.serviceClientIds.has(contact.id));
  }
}

/** A mensagem só sai pelo canal que o cliente consentiu e se houver contato válido nele. */
export function reachableBy(contact: MessagingContact, channel: MessageChannel): boolean {
  return channel === 'EMAIL'
    ? contact.emailConsentAt !== null && Boolean(contact.email)
    : contact.whatsappConsentAt !== null && toWhatsAppNumber(contact.phone) !== null;
}
