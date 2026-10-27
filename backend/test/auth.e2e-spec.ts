import request from 'supertest';
import { as, createTestApp, registerTenant, type TestApp } from './helpers/app.js';

const refreshCookie = (response: request.Response): string => {
  const cookies = ([] as string[]).concat(response.headers['set-cookie'] ?? []);
  const cookie = cookies.find((value) => value.startsWith('tnr_refresh='));
  if (!cookie) throw new Error('cookie de refresh ausente');
  return cookie.split(';')[0]!;
};

describe('Auth (e2e)', () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('cadastra a barbearia com o dono e papéis padrão, preservando acentos', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/auth/register-barbershop')
      .send({
        barbershopName: 'Barbearia São João',
        slug: `sao-joao-${Date.now()}`,
        ownerName: 'José',
        email: `Jose.${Date.now()}@Teste.com`,
        password: 'senha-forte-123',
      })
      .expect(201);

    expect(response.body.profile.barbershop.name).toBe('Barbearia São João');
    expect(response.body.profile.user.email).toMatch(/^jose\.\d+@teste\.com$/);
    expect(response.body.profile.membership.role.key).toBe('owner');
    expect(response.body.profile.membership.isProfessional).toBe(true);
    expect(response.body.profile.permissions).toContain('reports:read');
    expect(response.body.profile.permissions).not.toContain('bookings:self');

    const cookie = response.headers['set-cookie']?.[0] ?? '';
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
  });

  it('rejeita campos não declarados (ex.: barbershopId injetado)', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email: 'a@b.com', password: 'x', barbershopId: 'qualquer' })
      .expect(400);
    expect(response.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(response.body.errors[0]).toMatch(/barbershopId/);
  });

  it('não revela se o e-mail existe no login', async () => {
    const tenant = await registerTenant(app);
    const wrongPassword = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email: tenant.email, password: 'errada' })
      .expect(401);
    const unknownEmail = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email: 'ninguem@teste.com', password: 'errada' })
      .expect(401);
    expect(wrongPassword.body.detail).toBe(unknownEmail.body.detail);
  });

  it('exige token nas rotas protegidas', async () => {
    await request(app.getHttpServer()).get('/v1/auth/me').expect(401);
    await request(app.getHttpServer())
      .get('/v1/auth/me')
      .set('Authorization', 'Bearer token-falso')
      .expect(401);
  });

  it('retorna o perfil do usuário autenticado', async () => {
    const tenant = await registerTenant(app);
    const response = await as(app, tenant.token).get('/v1/auth/me').expect(200);
    expect(response.body.barbershop.id).toBe(tenant.barbershopId);
  });

  it('rotaciona o refresh token e revoga a sessão inteira quando um token antigo é reusado', async () => {
    const tenant = await registerTenant(app);
    const login = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email: tenant.email, password: tenant.password })
      .expect(200);
    const first = refreshCookie(login);

    const rotated = await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .set('Cookie', first)
      .expect(200);
    const second = refreshCookie(rotated);
    expect(second).not.toBe(first);

    // Reuso do token já rotacionado: sinal de roubo.
    await request(app.getHttpServer()).post('/v1/auth/refresh').set('Cookie', first).expect(401);
    // A família inteira caiu, inclusive o token legítimo mais recente.
    await request(app.getHttpServer()).post('/v1/auth/refresh').set('Cookie', second).expect(401);
  });

  it('logout invalida o refresh token', async () => {
    const tenant = await registerTenant(app);
    const login = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email: tenant.email, password: tenant.password })
      .expect(200);
    const cookie = refreshCookie(login);

    await request(app.getHttpServer()).post('/v1/auth/logout').set('Cookie', cookie).expect(204);
    await request(app.getHttpServer()).post('/v1/auth/refresh').set('Cookie', cookie).expect(401);
  });

  it('impede cadastro com slug ou e-mail já usados', async () => {
    const tenant = await registerTenant(app);
    const base = { barbershopName: 'Outra', ownerName: 'Ana', password: 'senha-forte-123' };

    const slugTaken = await request(app.getHttpServer())
      .post('/v1/auth/register-barbershop')
      .send({ ...base, slug: tenant.slug, email: `ana-${Date.now()}@teste.com` })
      .expect(409);
    expect(slugTaken.body.type).toMatch(/slug-taken$/);

    const emailTaken = await request(app.getHttpServer())
      .post('/v1/auth/register-barbershop')
      .send({ ...base, slug: `outra-${Date.now()}`, email: tenant.email })
      .expect(409);
    expect(emailTaken.body.type).toMatch(/email-taken$/);
  });

  it('rejeita slugs que colidem com rotas do frontend', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/auth/register-barbershop')
      .send({
        barbershopName: 'Painel',
        slug: 'painel',
        ownerName: 'Ana',
        email: `ana-${Date.now()}@teste.com`,
        password: 'senha-forte-123',
      })
      .expect(400);
    expect(response.body.errors[0]).toMatch(/reservado/);
  });

  it('sessão do painel e sessão de cliente no mesmo navegador são independentes', async () => {
    const shop = await registerTenant(app);
    // Agent guarda os cookies entre requisições, como um navegador.
    const browser = request.agent(app.getHttpServer());
    await browser.post('/v1/auth/login').send({ email: shop.email, password: shop.password }).expect(200);

    const client = await browser
      .post(`/v1/public/${shop.slug}/auth/register`)
      .send({ name: 'Cliente', email: `cliente-${Date.now()}@teste.com`, password: 'senha-forte-123' })
      .expect(201);
    const cookies = ([] as string[]).concat(client.headers['set-cookie'] ?? []);
    expect(cookies.some((value) => value.startsWith('tnr_client_refresh='))).toBe(true);
    expect(cookies.some((value) => value.startsWith('tnr_refresh='))).toBe(false);

    const panel = await browser.post('/v1/auth/refresh').expect(200);
    expect(panel.body.profile.membership.role.key).toBe('owner');
    const booking = await browser.post('/v1/auth/client/refresh').expect(200);
    expect(booking.body.profile.permissions).toEqual(['bookings:self']);

    // Sair do agendamento online não derruba o painel.
    await browser.post('/v1/auth/client/logout').expect(204);
    await browser.post('/v1/auth/client/refresh').expect(401);
    await browser.post('/v1/auth/refresh').expect(200);
  });
});
