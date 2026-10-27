import sharp from 'sharp';
import { unprocessable } from '../../common/http/domain-error.js';

/** Limites do logo (security.md, "Identidade visual"). */
export const LOGO_MAX_BYTES = 1024 * 1024;
export const LOGO_MAX_PX = 512;
export const LOGO_CONTENT_TYPE = 'image/webp';
/** Contra "bombas" de descompressão: arquivo pequeno que vira uma imagem gigante. */
const MAX_INPUT_PIXELS = 40_000_000;

type ImageType = 'png' | 'jpeg' | 'webp';

/**
 * Tipo pela assinatura dos bytes, nunca pela extensão nem pelo Content-Type do upload.
 * SVG (texto, pode carregar script) e qualquer outro formato ficam de fora.
 */
export function detectImageType(bytes: Buffer): ImageType | null {
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
    bytes.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

/**
 * Reprocessa o logo enviado: aplica a orientação, cabe em 512×512 sem ampliar e regrava
 * como WebP. Regravar descarta metadados (EXIF, GPS) e qualquer conteúdo escondido no
 * arquivo original; só a imagem decodificada sobrevive.
 */
export async function normalizeLogo(input: Buffer): Promise<Buffer> {
  if (!detectImageType(input)) {
    throw unprocessable('invalid-image', 'Envie o logo em PNG, JPEG ou WebP.');
  }
  try {
    return await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' })
      .rotate()
      .resize(LOGO_MAX_PX, LOGO_MAX_PX, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 90 })
      .toBuffer();
  } catch {
    throw unprocessable('invalid-image', 'Não foi possível ler a imagem. Envie um PNG, JPEG ou WebP válido.');
  }
}
