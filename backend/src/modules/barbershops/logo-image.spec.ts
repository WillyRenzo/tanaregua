import sharp from 'sharp';
import { DomainError } from '../../common/http/domain-error.js';
import { detectImageType, LOGO_MAX_PX, normalizeLogo } from './logo-image.js';

const image = (format: 'png' | 'jpeg' | 'webp', width = 64, height = 32) =>
  sharp({ create: { width, height, channels: 3, background: '#c0392b' } })
    [format]()
    .toBuffer();

describe('logo-image', () => {
  it.each(['png', 'jpeg', 'webp'] as const)('reconhece %s pela assinatura dos bytes', async (format) => {
    expect(detectImageType(await image(format))).toBe(format);
  });

  it.each([
    ['SVG', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')],
    ['texto com extensão .png', Buffer.from('não sou uma imagem')],
    ['GIF', Buffer.from('GIF89a......')],
    ['vazio', Buffer.alloc(0)],
  ])('recusa %s', async (_label, bytes) => {
    expect(detectImageType(bytes)).toBeNull();
    await expect(normalizeLogo(bytes)).rejects.toMatchObject({ code: 'invalid-image' });
  });

  it('recusa arquivo com assinatura válida mas conteúdo corrompido', async () => {
    const png = await image('png');
    const corrupted = Buffer.concat([png.subarray(0, 16), Buffer.alloc(64, 0x41)]);
    const error = await normalizeLogo(corrupted).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(DomainError);
  });

  it('reduz imagens grandes para caber em 512×512 sem distorcer e grava em WebP', async () => {
    const output = await normalizeLogo(await image('png', 2000, 1000));
    const meta = await sharp(output).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(LOGO_MAX_PX);
    expect(meta.height).toBe(LOGO_MAX_PX / 2);
  });

  it('não amplia imagens pequenas', async () => {
    const meta = await sharp(await normalizeLogo(await image('jpeg', 120, 60))).metadata();
    expect([meta.width, meta.height]).toEqual([120, 60]);
  });

  it('descarta metadados (EXIF/GPS) do arquivo original', async () => {
    const withExif = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#222' } })
      .jpeg()
      .withExif({ IFD0: { Copyright: 'segredo', ImageDescription: 'casa do dono' } })
      .toBuffer();
    expect((await sharp(withExif).metadata()).exif).toBeDefined();
    expect((await sharp(await normalizeLogo(withExif)).metadata()).exif).toBeUndefined();
  });
});
