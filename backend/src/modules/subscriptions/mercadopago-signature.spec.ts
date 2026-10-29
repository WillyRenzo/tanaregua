import { createHmac } from 'node:crypto';
import {
  SIGNATURE_TOLERANCE_SECONDS,
  signMercadoPagoNotification,
  verifyMercadoPagoSignature,
} from './mercadopago-signature.js';

const secret = 'segredo-de-webhooks-da-aplicacao';
const now = Date.UTC(2026, 9, 29, 12, 0, 0);
const ts = String(Math.floor(now / 1000));
const sign = (content: string, key = secret) => createHmac('sha256', key).update(content).digest('hex');

describe('verifyMercadoPagoSignature', () => {
  it('aceita a assinatura no formato do SDK oficial', () => {
    const v1 = sign(`id:2c938084;request-id:req-1;ts:${ts};`);
    expect(
      verifyMercadoPagoSignature(
        { signature: `ts=${ts},v1=${v1}`, requestId: 'req-1', dataId: '2c938084' },
        secret,
        now,
      ),
    ).toBe(true);
  });

  it('aceita o data.id assinado em minúsculas, como pede a documentação', () => {
    const v1 = sign(`id:abc123;request-id:req-1;ts:${ts};`);
    expect(
      verifyMercadoPagoSignature(
        { signature: `ts=${ts},v1=${v1}`, requestId: 'req-1', dataId: 'ABC123' },
        secret,
        now,
      ),
    ).toBe(true);
  });

  it('monta o manifest sem as partes ausentes', () => {
    const v1 = sign(`ts:${ts};`);
    expect(
      verifyMercadoPagoSignature(
        { signature: ` ts=${ts} , v1=${v1} `, requestId: undefined, dataId: undefined },
        secret,
        now,
      ),
    ).toBe(true);
  });

  it('recusa segredo errado, id trocado, cabeçalho ausente ou malformado', () => {
    const header = signMercadoPagoNotification('123', 'req-1', secret, now);
    const ok = { signature: header, requestId: 'req-1', dataId: '123' };
    expect(verifyMercadoPagoSignature(ok, secret, now)).toBe(true);
    expect(verifyMercadoPagoSignature(ok, 'outro-segredo-qualquer', now)).toBe(false);
    expect(verifyMercadoPagoSignature({ ...ok, dataId: '124' }, secret, now)).toBe(false);
    expect(verifyMercadoPagoSignature({ ...ok, requestId: 'req-2' }, secret, now)).toBe(false);
    expect(verifyMercadoPagoSignature({ ...ok, signature: undefined }, secret, now)).toBe(false);
    expect(verifyMercadoPagoSignature({ ...ok, signature: 'lixo' }, secret, now)).toBe(false);
    expect(verifyMercadoPagoSignature({ ...ok, signature: `ts=abc,v1=${'0'.repeat(64)}` }, secret, now)).toBe(
      false,
    );
    expect(verifyMercadoPagoSignature({ ...ok, signature: `ts=${ts}` }, secret, now)).toBe(false);
  });

  it('recusa notificação velha (ou do futuro) fora da tolerância', () => {
    const old = now - (SIGNATURE_TOLERANCE_SECONDS + 1) * 1000;
    const header = signMercadoPagoNotification('123', 'req-1', secret, old);
    expect(
      verifyMercadoPagoSignature({ signature: header, requestId: 'req-1', dataId: '123' }, secret, now),
    ).toBe(false);
    const recent = signMercadoPagoNotification('123', 'req-1', secret, now - 60_000);
    expect(
      verifyMercadoPagoSignature({ signature: recent, requestId: 'req-1', dataId: '123' }, secret, now),
    ).toBe(true);
  });
});
