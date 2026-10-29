import { randomUUID } from 'node:crypto';
import { localTimeToInstant } from '../src/modules/appointments/availability.js';
import { BirthdaysService } from '../src/modules/marketing/birthdays.service.js';
import {
  LOG_WHATSAPP_INVALID_TOKEN,
  LogWhatsAppSender,
} from '../src/modules/marketing/whatsapp/whatsapp-sender.js';
import { LogMailSender } from '../src/modules/notifications/mail-sender.js';
import { OutboxProcessor } from '../src/modules/notifications/outbox.processor.js';
import { SubscriptionsService } from '../src/modules/subscriptions/subscriptions.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { as, createTestApp, registerTenant, type Tenant, type TestApp } from './helpers/app.js';
import { expectTenantIsolation, login } from './helpers/isolation.js';

const TIMEZONE = 'America/Sao_Paulo';
const CONNECTION = {
  phoneNumberId: '106540352242922',
  businessAccountId: '102290129340398',
  accessToken: 'EAAG-token-de-teste-com-tamanho-suficiente',
};
const BIRTHDAY_TEMPLATE = {
  name: 'feliz_aniversario',
  language: 'pt_BR',
  parameters: [
    { name: '1', source: 'client_first_name' },
    { name: '2', source: 'barbershop_name' },
  ],
};

/** Aniversários e campanhas (business-rules §9): consentimento por canal, WhatsApp e outbox. */
describe('Aniversários e campanhas (e2e)', () => {
  let app: TestApp;
  let prisma: PrismaService;
  let processor: OutboxProcessor;
  let birthdays: BirthdaysService;
  let mail: LogMailSender;
  let whatsapp: LogWhatsAppSender;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    processor = app.get(OutboxProcessor);
    birthdays = app.get(BirthdaysService);
    mail = app.get(LogMailSender);
    whatsapp = app.get(LogWhatsAppSender);
  });

  afterAll(async () => {
    await app.close();
  });

  const drain = async (barbershopId: string) => {
    while ((await processor.processBatch({ barbershopId })) > 0) {
      // processa tudo o que estiver elegível
    }
  };

  const createClient = async (tenant: Tenant, body: object) =>
    (await as(app, tenant.token).post('/v1/clients').send(body).expect(201)).body as { id: string };

  const unique = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8)}@exemplo.test`;

  const messagesOf = (barbershopId: string) =>
    prisma.withContext({ barbershopId }, (tx) =>
      tx.marketingMessage.findMany({ where: { barbershopId }, orderBy: { createdAt: 'asc' } }),
    );

  describe('WhatsApp', () => {
    it('confere as credenciais, guarda o token cifrado e nunca o devolve', async () => {
      const tenant = await registerTenant(app);
      const owner = as(app, tenant.token);

      expect((await owner.get('/v1/whatsapp').expect(200)).body).toEqual({ connection: null });
      const refused = await owner
        .put('/v1/whatsapp')
        .send({ ...CONNECTION, accessToken: LOG_WHATSAPP_INVALID_TOKEN })
        .expect(422);
      expect(refused.body.type).toMatch(/whatsapp-invalid-credentials$/);

      const connected = await owner.put('/v1/whatsapp').send(CONNECTION).expect(200);
      expect(connected.body.connection).toMatchObject({
        phoneNumberId: CONNECTION.phoneNumberId,
        businessAccountId: CONNECTION.businessAccountId,
        verifiedName: 'Conta de teste',
      });
      expect(JSON.stringify(connected.body)).not.toContain(CONNECTION.accessToken);

      const stored = await prisma.withContext({ barbershopId: tenant.barbershopId }, (tx) =>
        tx.whatsAppConnection.findFirstOrThrow({ where: { barbershopId: tenant.barbershopId } }),
      );
      expect(stored.accessTokenSealed).not.toContain(CONNECTION.accessToken);

      const templates = await owner.get('/v1/whatsapp/templates').expect(200);
      expect(templates.body).toContainEqual(
        expect.objectContaining({ name: 'feliz_aniversario', parameters: ['1', '2'], supported: true }),
      );
      expect(templates.body).toContainEqual(
        expect.objectContaining({ name: 'promocao_com_imagem', supported: false }),
      );

      await owner.delete('/v1/whatsapp').expect(204);
      expect((await owner.get('/v1/whatsapp').expect(200)).body).toEqual({ connection: null });
      const notConnected = await owner.get('/v1/whatsapp/templates').expect(422);
      expect(notConnected.body.type).toMatch(/whatsapp-not-connected$/);
    });

    it('rejeita IDs que não são numéricos (não viram caminho na URL da Meta)', async () => {
      const tenant = await registerTenant(app);
      await as(app, tenant.token)
        .put('/v1/whatsapp')
        .send({ ...CONNECTION, phoneNumberId: '../me' })
        .expect(400);
    });

    it('a conexão de uma barbearia não aparece para outra', async () => {
      const shopA = await registerTenant(app);
      const shopB = await registerTenant(app);
      await as(app, shopA.token).put('/v1/whatsapp').send(CONNECTION).expect(200);
      expect((await as(app, shopB.token).get('/v1/whatsapp').expect(200)).body).toEqual({ connection: null });
      await as(app, shopB.token).get('/v1/whatsapp/templates').expect(422);
    });
  });

  describe('aniversário', () => {
    it('valida o modelo do WhatsApp ao salvar a configuração', async () => {
      const tenant = await registerTenant(app);
      const owner = as(app, tenant.token);
      const defaults = await owner.get('/v1/birthday-settings').expect(200);
      expect(defaults.body).toMatchObject({
        enabled: false,
        emailText: null,
        whatsappTemplate: null,
        whatsappConnected: false,
        sendHour: 9,
      });
      expect(defaults.body.defaultEmailText).toContain('{nome}');

      const settings = { enabled: true, emailText: null, whatsappTemplate: BIRTHDAY_TEMPLATE };
      const notConnected = await owner.put('/v1/birthday-settings').send(settings).expect(422);
      expect(notConnected.body.type).toMatch(/whatsapp-not-connected$/);

      await owner.put('/v1/whatsapp').send(CONNECTION).expect(200);
      const wrongParameters = await owner
        .put('/v1/birthday-settings')
        .send({ ...settings, whatsappTemplate: { ...BIRTHDAY_TEMPLATE, parameters: [] } })
        .expect(422);
      expect(wrongParameters.body.type).toMatch(/whatsapp-template-invalid$/);

      const saved = await owner.put('/v1/birthday-settings').send(settings).expect(200);
      expect(saved.body).toMatchObject({
        enabled: true,
        whatsappConnected: true,
        whatsappTemplate: BIRTHDAY_TEMPLATE,
      });
    });

    it('envia no dia, a partir das 9h, uma vez por ano e só pelo canal consentido', async () => {
      const tenant = await registerTenant(app);
      const owner = as(app, tenant.token);
      await owner.put('/v1/whatsapp').send(CONNECTION).expect(200);
      await owner
        .put('/v1/birthday-settings')
        .send({
          enabled: true,
          emailText: 'Parabéns, {nome}! Beijo da {barbearia}.',
          whatsappTemplate: BIRTHDAY_TEMPLATE,
        })
        .expect(200);

      const anaEmail = unique('ana');
      const ana = await createClient(tenant, {
        name: 'Ana Lima',
        email: anaEmail,
        birthDate: '1990-03-15',
        consents: { email: true },
      });
      const bruno = await createClient(tenant, {
        name: 'Bruno Alves',
        phone: '11977776666',
        email: unique('bruno'),
        birthDate: '1988-03-15',
        consents: { email: true, whatsapp: true },
      });
      // Sem consentimento: aniversário só como lembrete interno.
      await createClient(tenant, {
        name: 'Caio Sem Consentimento',
        email: unique('caio'),
        birthDate: '1995-03-15',
      });
      // Outro dia.
      await createClient(tenant, {
        name: 'Davi Amanhã',
        email: unique('davi'),
        birthDate: '1995-03-16',
        consents: { email: true },
      });

      const at = (minutes: number) => localTimeToInstant('2030-03-15', minutes, TIMEZONE);
      expect(await birthdays.enqueueDue(at(8 * 60 + 50), { barbershopId: tenant.barbershopId })).toBe(0);
      expect(await birthdays.enqueueDue(at(9 * 60), { barbershopId: tenant.barbershopId })).toBe(2);
      expect(await birthdays.enqueueDue(at(15 * 60), { barbershopId: tenant.barbershopId })).toBe(0);

      const queued = await messagesOf(tenant.barbershopId);
      expect(
        queued.map((message) => [message.clientId, message.channel, message.birthdayYear]).sort(),
      ).toEqual(
        [
          [ana.id, 'EMAIL', 2030],
          [bruno.id, 'WHATSAPP', 2030],
        ].sort(),
      );

      await drain(tenant.barbershopId);
      expect((await messagesOf(tenant.barbershopId)).every((message) => message.status === 'SENT')).toBe(
        true,
      );

      const email = mail.sent.find((item) => item.to === anaEmail);
      expect(email?.text).toContain(
        `Parabéns, Ana! Beijo da Barbearia ${tenant.slug.slice('barbearia-'.length)}.`,
      );
      expect(email?.text).toContain('autorizou o contato');
      expect(whatsapp.sent).toContainEqual(
        expect.objectContaining({
          to: '5511977776666',
          template: { name: 'feliz_aniversario', language: 'pt_BR' },
          parameters: [
            { name: '1', text: 'Bruno' },
            { name: '2', text: `Barbearia ${tenant.slug.slice('barbearia-'.length)}` },
          ],
        }),
      );

      // No ano seguinte, de novo.
      expect(
        await birthdays.enqueueDue(localTimeToInstant('2031-03-15', 10 * 60, TIMEZONE), {
          barbershopId: tenant.barbershopId,
        }),
      ).toBe(2);
    });

    it('desligado não envia; sem WhatsApp conectado, cai para o e-mail', async () => {
      const tenant = await registerTenant(app);
      const owner = as(app, tenant.token);
      await createClient(tenant, {
        name: 'Edu Duplo',
        phone: '11966665555',
        email: unique('edu'),
        birthDate: '1990-07-01',
        consents: { email: true, whatsapp: true },
      });
      const at = localTimeToInstant('2030-07-01', 10 * 60, TIMEZONE);

      expect(await birthdays.enqueueDue(at, { barbershopId: tenant.barbershopId })).toBe(0);
      await owner
        .put('/v1/birthday-settings')
        .send({ enabled: true, emailText: null, whatsappTemplate: null })
        .expect(200);
      expect(await birthdays.enqueueDue(at, { barbershopId: tenant.barbershopId })).toBe(1);
      expect((await messagesOf(tenant.barbershopId))[0]?.channel).toBe('EMAIL');
    });

    it('no modo só leitura (sem pagamento), a mensagem automática fica pausada', async () => {
      const tenant = await registerTenant(app);
      await as(app, tenant.token)
        .put('/v1/birthday-settings')
        .send({ enabled: true, emailText: null, whatsappTemplate: null })
        .expect(200);
      await createClient(tenant, {
        name: 'Gil Pausado',
        email: unique('gil'),
        birthDate: '1990-09-10',
        consents: { email: true },
      });
      const at = localTimeToInstant('2030-09-10', 10 * 60, TIMEZONE);

      // Teste grátis vencido: o painel só consulta, e o aniversário não sai.
      await prisma.withContext({ barbershopId: tenant.barbershopId }, (tx) =>
        tx.subscription.update({
          where: { barbershopId: tenant.barbershopId },
          data: { trialEndsAt: new Date(Date.now() - 60_000) },
        }),
      );
      expect(await birthdays.enqueueDue(at, { barbershopId: tenant.barbershopId })).toBe(0);
      expect(await messagesOf(tenant.barbershopId)).toEqual([]);

      // Voltou a ter assinatura: a mensagem do dia sai na rodada seguinte.
      await app.get(SubscriptionsService).grantPlan(tenant.barbershopId, 'essential');
      expect(await birthdays.enqueueDue(at, { barbershopId: tenant.barbershopId })).toBe(1);
    });

    it('revogar o consentimento depois de enfileirar impede o envio', async () => {
      const tenant = await registerTenant(app);
      const owner = as(app, tenant.token);
      await owner
        .put('/v1/birthday-settings')
        .send({ enabled: true, emailText: null, whatsappTemplate: null })
        .expect(200);
      const client = await createClient(tenant, {
        name: 'Fábio Arrependido',
        email: unique('fabio'),
        birthDate: '1990-08-20',
        consents: { email: true },
      });
      await birthdays.enqueueDue(localTimeToInstant('2030-08-20', 10 * 60, TIMEZONE), {
        barbershopId: tenant.barbershopId,
      });
      await owner
        .patch(`/v1/clients/${client.id}`)
        .send({ consents: { email: false } })
        .expect(200);

      await drain(tenant.barbershopId);
      expect(await messagesOf(tenant.barbershopId)).toEqual([
        expect.objectContaining({ status: 'SKIPPED', outcome: 'no-consent', sentAt: null }),
      ]);
    });

    it('lista os aniversariantes do mês com os canais consentidos', async () => {
      const tenant = await registerTenant(app);
      const zeca = await createClient(tenant, {
        name: 'Zeca',
        birthDate: '1990-05-20',
        consents: { email: true },
        email: unique('zeca'),
      });
      await createClient(tenant, { name: 'Alan', birthDate: '1980-05-02' });
      await createClient(tenant, { name: 'Junho', birthDate: '1980-06-02' });

      const list = await as(app, tenant.token).get('/v1/birthdays').query({ month: 5 }).expect(200);
      expect(list.body).toEqual([
        expect.objectContaining({
          name: 'Alan',
          day: 2,
          month: 5,
          consents: { email: false, whatsapp: false },
          message: null,
        }),
        expect.objectContaining({ clientId: zeca.id, day: 20, consents: { email: true, whatsapp: false } }),
      ]);
    });
  });

  describe('campanhas', () => {
    const emailCampaign = {
      name: 'Sentimos sua falta',
      channel: 'EMAIL',
      audience: { kind: 'all' },
      email: { subject: '{nome}, saudade!', body: 'Oi, {nome}! Volte para a {barbearia}.' },
    };

    it('prévia conta só quem consentiu no canal; a criação exige confirmar o mesmo número', async () => {
      const tenant = await registerTenant(app);
      const owner = as(app, tenant.token);
      const gilEmail = unique('gil');
      await createClient(tenant, { name: 'Gil Email', email: gilEmail, consents: { email: true } });
      await createClient(tenant, { name: 'Hugo Zap', phone: '11955554444', consents: { whatsapp: true } });
      await createClient(tenant, { name: 'Ivo Nada', email: unique('ivo') });

      const preview = await owner
        .post('/v1/campaigns/preview')
        .send({ channel: 'EMAIL', audience: { kind: 'all' } })
        .expect(200);
      expect(preview.body).toMatchObject({ matched: 3, recipients: 1, sample: [{ name: 'Gil Email' }] });

      const changed = await owner
        .post('/v1/campaigns')
        .send({ ...emailCampaign, confirmRecipients: 2 })
        .expect(409);
      expect(changed.body.type).toMatch(/audience-changed$/);

      const created = await owner
        .post('/v1/campaigns')
        .send({ ...emailCampaign, confirmRecipients: 1 })
        .expect(201);
      expect(created.body).toMatchObject({
        recipientCount: 1,
        counts: { pending: 1, sent: 0 },
        messages: [{ clientName: 'Gil Email', status: 'PENDING' }],
      });

      await drain(tenant.barbershopId);
      const sent = mail.sent.find((item) => item.to === gilEmail);
      expect(sent).toMatchObject({ subject: 'Gil, saudade!' });
      expect(sent?.text).toContain('Oi, Gil! Volte para a Barbearia');

      const list = await owner.get('/v1/campaigns').expect(200);
      expect(list.body).toEqual([
        expect.objectContaining({
          id: created.body.id,
          counts: { pending: 0, sent: 1, skipped: 0, failed: 0 },
        }),
      ]);
    });

    it('sem ninguém para receber, não cria; e-mail exige assunto e texto', async () => {
      const tenant = await registerTenant(app);
      const owner = as(app, tenant.token);
      await createClient(tenant, { name: 'Sem Consentimento', email: unique('sem') });
      const empty = await owner
        .post('/v1/campaigns')
        .send({ ...emailCampaign, confirmRecipients: 1 })
        .expect(422);
      expect(empty.body.type).toMatch(/empty-audience$/);
      await owner
        .post('/v1/campaigns')
        .send({ ...emailCampaign, email: undefined, confirmRecipients: 1 })
        .expect(400);
    });

    it('filtra quem não volta há N dias pelo último atendimento concluído', async () => {
      const tenant = await registerTenant(app, { ownerIsProfessional: true });
      const owner = as(app, tenant.token);
      const corte = (
        await owner
          .post('/v1/services')
          .send({ name: 'Corte', priceCents: 5000, durationMinutes: 30 })
          .expect(201)
      ).body.id as string;
      const sumido = await createClient(tenant, {
        name: 'Sumido',
        email: unique('sumido'),
        consents: { email: true },
      });
      const frequente = await createClient(tenant, {
        name: 'Frequente',
        email: unique('frequente'),
        consents: { email: true },
      });
      await createClient(tenant, { name: 'Nunca Veio', email: unique('nunca'), consents: { email: true } });

      const visit = (clientId: string, daysAgo: number) => {
        const startsAt = new Date(Date.now() - daysAgo * 24 * 60 * 60_000);
        const endsAt = new Date(startsAt.getTime() + 30 * 60_000);
        return prisma.withContext({ barbershopId: tenant.barbershopId }, (tx) =>
          tx.appointment.create({
            data: {
              barbershopId: tenant.barbershopId,
              professionalId: tenant.membershipId,
              clientId,
              startsAt,
              endsAt,
              blockedUntil: endsAt,
              status: 'COMPLETED',
              source: 'PANEL',
              createdByUserId: tenant.userId,
              items: {
                create: {
                  serviceId: corte,
                  position: 0,
                  name: 'Corte',
                  priceCents: 5000,
                  durationMinutes: 30,
                },
              },
            },
          }),
        );
      };
      await visit(sumido.id, 70);
      await visit(frequente.id, 71);
      await visit(frequente.id, 5);

      const inactive = await owner
        .post('/v1/campaigns/preview')
        .send({ channel: 'EMAIL', audience: { kind: 'inactive', days: 45 } })
        .expect(200);
      expect(inactive.body).toMatchObject({ matched: 1, recipients: 1, sample: [{ id: sumido.id }] });

      const byService = await owner
        .post('/v1/campaigns/preview')
        .send({ channel: 'EMAIL', audience: { kind: 'service', serviceId: corte, days: 30 } })
        .expect(200);
      expect(byService.body).toMatchObject({ matched: 1, sample: [{ id: frequente.id }] });

      const invalid = await owner
        .post('/v1/campaigns/preview')
        .send({ channel: 'EMAIL', audience: { kind: 'service', serviceId: randomUUID(), days: 30 } })
        .expect(422);
      expect(invalid.body.type).toMatch(/invalid-service$/);
    });

    it('WhatsApp exige conta conectada e envia o modelo aprovado com as variáveis', async () => {
      const tenant = await registerTenant(app);
      const owner = as(app, tenant.token);
      await createClient(tenant, { name: 'Lia Zap', phone: '5521988887777', consents: { whatsapp: true } });
      const campaign = {
        name: 'Volte logo',
        channel: 'WHATSAPP',
        audience: { kind: 'all' },
        whatsapp: {
          name: 'sentimos_sua_falta',
          language: 'pt_BR',
          parameters: [
            { name: 'nome', source: 'client_first_name' },
            { name: 'barbearia', source: 'barbershop_name' },
          ],
        },
        confirmRecipients: 1,
      };

      const notConnected = await owner.post('/v1/campaigns').send(campaign).expect(422);
      expect(notConnected.body.type).toMatch(/whatsapp-not-connected$/);
      await owner.put('/v1/whatsapp').send(CONNECTION).expect(200);
      const created = await owner.post('/v1/campaigns').send(campaign).expect(201);
      expect(created.body).toMatchObject({ whatsappTemplateName: 'sentimos_sua_falta', emailSubject: null });

      await drain(tenant.barbershopId);
      expect(whatsapp.sent).toContainEqual(
        expect.objectContaining({
          to: '5521988887777',
          template: { name: 'sentimos_sua_falta', language: 'pt_BR' },
          parameters: [
            { name: 'nome', text: 'Lia' },
            { name: 'barbearia', text: expect.stringMatching(/^Barbearia /) },
          ],
        }),
      );
      const [message] = await messagesOf(tenant.barbershopId);
      expect(message).toMatchObject({ status: 'SENT', providerMessageId: expect.stringMatching(/^log-/) });
    });

    it('falha do envio esgota as tentativas e a mensagem fica FAILED', async () => {
      const tenant = await registerTenant(app);
      const owner = as(app, tenant.token);
      await owner.put('/v1/whatsapp').send(CONNECTION).expect(200);
      await createClient(tenant, { name: 'Mia Zap', phone: '11944443333', consents: { whatsapp: true } });
      await owner
        .post('/v1/campaigns')
        .send({
          name: 'Aniversário da casa',
          channel: 'WHATSAPP',
          audience: { kind: 'all' },
          whatsapp: BIRTHDAY_TEMPLATE,
          confirmRecipients: 1,
        })
        .expect(201);
      // Token corrompido (ex.: chave trocada): o envio falha a cada tentativa.
      await prisma.withContext({ barbershopId: tenant.barbershopId }, async (tx) => {
        await tx.whatsAppConnection.updateMany({
          where: { barbershopId: tenant.barbershopId },
          data: { accessTokenSealed: 'v1.corrompido.x.y' },
        });
      });
      await prisma.outboxEvent.updateMany({
        where: { barbershopId: tenant.barbershopId, type: 'MarketingMessageQueued' },
        data: { attempts: 4 },
      });

      await drain(tenant.barbershopId);
      expect(await messagesOf(tenant.barbershopId)).toEqual([
        expect.objectContaining({ status: 'FAILED', outcome: 'provider-error' }),
      ]);
    });

    it('permissões: recepção cria campanha; profissional não; recepção não mexe no WhatsApp', async () => {
      const tenant = await registerTenant(app);
      const owner = as(app, tenant.token);
      const staff = async (roleKey: string) => {
        const email = unique(roleKey);
        await owner
          .post('/v1/staff')
          .send({
            name: `Equipe ${roleKey}`,
            email,
            password: 'senha-forte-123',
            roleKey,
            isProfessional: roleKey === 'professional',
          })
          .expect(201);
        return as(app, await login(app, email, 'senha-forte-123'));
      };
      const receptionist = await staff('receptionist');
      const professional = await staff('professional');

      await receptionist
        .post('/v1/campaigns/preview')
        .send({ channel: 'EMAIL', audience: { kind: 'all' } })
        .expect(200);
      await receptionist.get('/v1/campaigns').expect(200);
      await receptionist.put('/v1/whatsapp').send(CONNECTION).expect(403);
      await receptionist.get('/v1/birthday-settings').expect(403);
      await professional
        .post('/v1/campaigns/preview')
        .send({ channel: 'EMAIL', audience: { kind: 'all' } })
        .expect(403);
      await professional.get('/v1/birthdays').query({ month: 1 }).expect(200);
    });

    it('campanha de outra barbearia responde 404', async () => {
      const shopA = await registerTenant(app);
      const shopB = await registerTenant(app);
      await createClient(shopA, { name: 'Cliente A', email: unique('a'), consents: { email: true } });
      const created = await as(app, shopA.token)
        .post('/v1/campaigns')
        .send({ ...emailCampaign, confirmRecipients: 1 })
        .expect(201);

      await expectTenantIsolation(app, shopB, [{ method: 'get', url: `/v1/campaigns/${created.body.id}` }]);
      expect((await as(app, shopB.token).get('/v1/campaigns').expect(200)).body).toEqual([]);
      expect((await as(app, shopB.token).get('/v1/birthdays').query({ month: 1 }).expect(200)).body).toEqual(
        [],
      );
    });
  });
});
