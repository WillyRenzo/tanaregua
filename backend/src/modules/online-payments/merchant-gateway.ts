import { Injectable } from '@nestjs/common';
import { z } from 'zod';

/** Credenciais da conta da barbearia no gateway. Só existem decifradas dentro da API. */
export interface MerchantCredentials {
  accessToken: string;
}

/** Conta conferida no gateway ao conectar. */
export interface MerchantAccount {
  id: string;
  name: string;
}

/** Falha do gateway. Leva só o status HTTP e o código do provedor, nunca o corpo nem o token. */
export class MerchantGatewayError extends Error {
  constructor(
    readonly status: number,
    readonly providerCode?: string,
  ) {
    super(`Gateway de pagamento respondeu ${status}${providerCode ? ` (${providerCode})` : ''}`);
  }
}

/**
 * Porta da conta da barbearia no gateway (business-rules §5): o dinheiro do cliente cai
 * direto na conta dela, e o TaNaRegua só usa as credenciais que ela conectou. É separada da
 * porta da assinatura do TaNaRegua (`PaymentGateway`), que cobra com a conta da plataforma,
 * mas o gateway da instalação é o mesmo (`PAYMENT_PROVIDER`).
 */
export abstract class MerchantGateway {
  /** Nome gravado em `payment_accounts.provider`; `null` com o pagamento online desligado. */
  abstract readonly provider: string | null;
  /** Confere as credenciais e devolve a conta. Lança `MerchantGatewayError` se recusadas. */
  abstract verifyAccount(credentials: MerchantCredentials): Promise<MerchantAccount>;
}

/** `PAYMENT_PROVIDER=none`: pagamento online indisponível na instalação. */
@Injectable()
export class DisabledMerchantGateway extends MerchantGateway {
  readonly provider = null;

  verifyAccount(): Promise<MerchantAccount> {
    throw new Error('Pagamento online desligado (PAYMENT_PROVIDER=none)');
  }
}

/** Token que o gateway simulado recusa, para os testes da conexão. */
export const FAKE_MERCHANT_INVALID_TOKEN = 'token-recusado-para-testes';

/** Desenvolvimento e testes: aceita qualquer conta (menos o token de recusa). */
@Injectable()
export class FakeMerchantGateway extends MerchantGateway {
  readonly provider = 'fake';

  async verifyAccount(credentials: MerchantCredentials): Promise<MerchantAccount> {
    if (credentials.accessToken === FAKE_MERCHANT_INVALID_TOKEN) throw new MerchantGatewayError(401);
    return { id: `fake-${credentials.accessToken.slice(-6)}`, name: 'Conta de teste' };
  }
}

const API_URL = 'https://api.mercadopago.com';
const TIMEOUT_MS = 10_000;

/** Só o que o TaNaRegua usa de `/users/me`. */
const userSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  nickname: z.string().optional(),
});

/** Mercado Pago com o access token da conta da barbearia, via HTTP sem SDK. */
@Injectable()
export class MercadoPagoMerchantGateway extends MerchantGateway {
  readonly provider = 'mercadopago';

  async verifyAccount(credentials: MerchantCredentials): Promise<MerchantAccount> {
    const response = await fetch(`${API_URL}/users/me`, {
      headers: { Authorization: `Bearer ${credentials.accessToken}` },
      // Toda chamada externa tem timeout (AFA 14).
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const code = (payload as { error?: unknown } | null)?.error;
      throw new MerchantGatewayError(response.status, typeof code === 'string' ? code : undefined);
    }
    const user = userSchema.parse(payload);
    return { id: user.id, name: user.nickname ?? `Conta ${user.id}` };
  }
}
