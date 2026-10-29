import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Notificações mais velhas que isso são recusadas (security.md: rejeitar eventos antigos).
 * O reenvio do Mercado Pago a cada 15 minutos precisa caber aqui; a confirmar no sandbox se
 * o reenvio traz um `ts` novo (mvp-plan, entrega 3).
 */
export const SIGNATURE_TOLERANCE_SECONDS = 60 * 60;

export interface SignedNotification {
  /** Cabeçalho `x-signature`: `ts=<segundos>,v1=<hmac hex>`. */
  signature: string | undefined;
  /** Cabeçalho `x-request-id`. */
  requestId: string | undefined;
  /** `data.id` da query string. */
  dataId: string | undefined;
}

function manifest(dataId: string | undefined, requestId: string | undefined, ts: string): string {
  const parts: string[] = [];
  if (dataId) parts.push(`id:${dataId}`);
  if (requestId) parts.push(`request-id:${requestId}`);
  parts.push(`ts:${ts}`);
  return `${parts.join(';')};`;
}

function hmac(secret: string, content: string): string {
  return createHmac('sha256', secret).update(content).digest('hex');
}

function sameHex(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Confere a assinatura de uma notificação do Mercado Pago: HMAC-SHA256 (hex), com o segredo
 * de Webhooks da aplicação, sobre `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`, como
 * no validador do SDK oficial. A documentação diz que um `data.id` alfanumérico vai em
 * minúsculas e o SDK usa o valor como chegou: as duas formas são aceitas (ambas exigem o
 * segredo). Devolve false para assinatura ausente, malformada, errada ou velha.
 */
export function verifyMercadoPagoSignature(
  notification: SignedNotification,
  secret: string,
  nowMs: number = Date.now(),
): boolean {
  const fields = new Map<string, string>();
  for (const part of (notification.signature ?? '').split(',')) {
    const [key, ...rest] = part.split('=');
    if (key && rest.length > 0) fields.set(key.trim().toLowerCase(), rest.join('=').trim());
  }
  const ts = fields.get('ts');
  const received = fields.get('v1');
  if (!ts || !/^\d+$/.test(ts) || !received) return false;
  if (Math.abs(nowMs - Number(ts) * 1000) > SIGNATURE_TOLERANCE_SECONDS * 1000) return false;

  const candidates = new Set([notification.dataId, notification.dataId?.toLowerCase()]);
  return [...candidates].some((dataId) =>
    sameHex(hmac(secret, manifest(dataId, notification.requestId, ts)), received.toLowerCase()),
  );
}

/** Assina como o Mercado Pago (para o gateway simulado e para os testes). */
export function signMercadoPagoNotification(
  dataId: string,
  requestId: string,
  secret: string,
  nowMs: number = Date.now(),
): string {
  const ts = String(Math.floor(nowMs / 1000));
  return `ts=${ts},v1=${hmac(secret, manifest(dataId, requestId, ts))}`;
}
