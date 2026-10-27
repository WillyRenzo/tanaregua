import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import request from 'supertest';
import { ObjectStorage } from '../src/common/storage/object-storage.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { as, createTestApp, registerTenant, type Tenant, type TestApp } from './helpers/app.js';
import { login } from './helpers/isolation.js';

const png = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 4, background: '#c0392b' } })
    .png()
    .toBuffer();

/** business-rules §10 e security.md: logo e cores da marca por barbearia. */
describe('Identidade visual (e2e)', () => {
  let app: TestApp;
  let shop: Tenant;
  const server = () => request(app.getHttpServer());

  const upload = (token: string, bytes: Buffer, filename = 'logo.png', contentType = 'image/png') =>
    as(app, token).put('/v1/barbershop/logo').attach('file', bytes, { filename, contentType });

  beforeAll(async () => {
    app = await createTestApp();
    shop = await registerTenant(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('sem configuração, a barbearia usa a identidade padrão', async () => {
    const settings = await as(app, shop.token).get('/v1/barbershop').expect(200);
    expect(settings.body.brand).toEqual({ primaryColor: null, secondaryColor: null, logoVersion: null });
    await server().get(`/v1/public/${shop.slug}/logo`).expect(404);
  });

  it('grava as cores em minúsculas, publica na página e aceita voltar ao padrão', async () => {
    const updated = await as(app, shop.token)
      .patch('/v1/barbershop')
      .send({ brandPrimaryColor: '#1A5D3A', brandSecondaryColor: '#F4D35E' })
      .expect(200);
    expect(updated.body.brand).toMatchObject({ primaryColor: '#1a5d3a', secondaryColor: '#f4d35e' });

    const info = await server().get(`/v1/public/${shop.slug}`).expect(200);
    expect(info.body.brand).toMatchObject({ primaryColor: '#1a5d3a', secondaryColor: '#f4d35e' });

    await as(app, shop.token).patch('/v1/barbershop').send({ brandSecondaryColor: null }).expect(200);
    const after = await server().get(`/v1/public/${shop.slug}`).expect(200);
    expect(after.body.brand.secondaryColor).toBeNull();
  });

  it.each(['red', '#fff', '#12345g', 'url(javascript:alert(1))', '#123456; color: red'])(
    'recusa cor fora do formato #RRGGBB: %s',
    async (color) => {
      await as(app, shop.token).patch('/v1/barbershop').send({ brandPrimaryColor: color }).expect(400);
    },
  );

  it('reprocessa o logo para WebP de até 512 px e serve com tipo fixo e nosniff', async () => {
    const response = await upload(shop.token, await png(1600, 800)).expect(200);
    const version = response.body.brand.logoVersion as string;
    expect(version).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(response.body)).not.toContain('barbershops/'); // chave de storage não vaza

    const logo = await server()
      .get(`/v1/public/${shop.slug}/logo`)
      .query({ v: version })
      .buffer(true)
      .expect(200);
    expect(logo.headers['content-type']).toBe('image/webp');
    expect(logo.headers['x-content-type-options']).toBe('nosniff');
    expect(logo.headers['cache-control']).toContain('max-age=86400');
    const meta = await sharp(logo.body as Buffer).metadata();
    expect(meta).toMatchObject({ format: 'webp', width: 512, height: 256 });
  });

  it('trocar o logo apaga o arquivo anterior; remover volta ao padrão', async () => {
    const first = await upload(shop.token, await png(100, 100)).expect(200);
    const second = await upload(shop.token, await png(200, 200)).expect(200);
    expect(second.body.brand.logoVersion).not.toBe(first.body.brand.logoVersion);

    const storage = app.get(ObjectStorage);
    const oldKey = `barbershops/${shop.barbershopId}/logo-${first.body.brand.logoVersion}.webp`;
    const newKey = `barbershops/${shop.barbershopId}/logo-${second.body.brand.logoVersion}.webp`;
    expect(await storage.get(oldKey)).toBeNull();
    expect(await storage.get(newKey)).not.toBeNull();

    const removed = await as(app, shop.token).delete('/v1/barbershop/logo').expect(200);
    expect(removed.body.brand.logoVersion).toBeNull();
    expect(await storage.get(newKey)).toBeNull();
    await server().get(`/v1/public/${shop.slug}/logo`).expect(404);
  });

  it.each([
    [
      'SVG',
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
      'logo.svg',
      'image/svg+xml',
    ],
    ['texto disfarçado de PNG', Buffer.from('isto não é uma imagem'), 'logo.png', 'image/png'],
  ])('recusa %s pelo conteúdo, não pela extensão', async (_label, bytes, filename, contentType) => {
    const response = await upload(shop.token, bytes, filename, contentType).expect(422);
    expect(response.body.type).toMatch(/invalid-image$/);
  });

  it('recusa arquivo acima de 1 MB e upload sem arquivo', async () => {
    const big = Buffer.concat([await png(10, 10), Buffer.alloc(1024 * 1024 + 1)]);
    await upload(shop.token, big).expect(413);
    const empty = await as(app, shop.token).put('/v1/barbershop/logo').expect(422);
    expect(empty.body.type).toMatch(/invalid-image$/);
  });

  it('só quem gerencia a barbearia muda a identidade visual', async () => {
    const email = `recepcao-${randomUUID().slice(0, 8)}@teste.com`;
    await as(app, shop.token)
      .post('/v1/staff')
      .send({
        name: 'Recepção',
        email,
        password: 'senha-forte-123',
        roleKey: 'receptionist',
        isProfessional: false,
      })
      .expect(201);
    const reception = await login(app, email, 'senha-forte-123');

    await upload(reception, await png(50, 50)).expect(403);
    await as(app, reception).delete('/v1/barbershop/logo').expect(403);
    await as(app, reception).patch('/v1/barbershop').send({ brandPrimaryColor: '#000000' }).expect(403);
  });

  it('o logo de uma barbearia nunca é gravado no prefixo de outra', async () => {
    const other = await registerTenant(app);
    const response = await upload(other.token, await png(60, 60)).expect(200);
    const key = (
      await app.get(PrismaService).barbershop.findUniqueOrThrow({
        where: { id: other.barbershopId },
        select: { logoKey: true },
      })
    ).logoKey;
    expect(key).toBe(`barbershops/${other.barbershopId}/logo-${response.body.brand.logoVersion}.webp`);
    // A página pública de cada barbearia serve só o próprio logo.
    const mine = await server().get(`/v1/public/${shop.slug}/logo`);
    expect(mine.status).toBe(404);
  });
});
