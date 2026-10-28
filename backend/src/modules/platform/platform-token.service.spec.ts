import { NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';
import { PlatformTokenService } from './platform-token.service.js';

const config = (values: Partial<Env>) =>
  ({ get: (key: keyof Env) => values[key] }) as unknown as ConfigService<Env, true>;

describe('PlatformTokenService', () => {
  it('sem PLATFORM_JWT_SECRET, a administração não existe: tudo responde 404', async () => {
    const tokens = new PlatformTokenService(config({ JWT_ACCESS_TTL_SECONDS: 900 }));
    expect(() => tokens.assertEnabled()).toThrow(NotFoundException);
    await expect(tokens.sign({ adminId: 'a' })).rejects.toThrow(NotFoundException);
  });

  it('assina e confere o próprio token', async () => {
    const tokens = new PlatformTokenService(
      config({ JWT_ACCESS_TTL_SECONDS: 900, PLATFORM_JWT_SECRET: 'p'.repeat(48) }),
    );
    const token = await tokens.sign({ adminId: 'admin-1' });
    await expect(tokens.verify(token)).resolves.toEqual({ adminId: 'admin-1' });
  });

  it('recusa um token assinado com outro segredo (o das barbearias)', async () => {
    const platform = new PlatformTokenService(
      config({ JWT_ACCESS_TTL_SECONDS: 900, PLATFORM_JWT_SECRET: 'p'.repeat(48) }),
    );
    const other = new PlatformTokenService(
      config({ JWT_ACCESS_TTL_SECONDS: 900, PLATFORM_JWT_SECRET: 'x'.repeat(48) }),
    );
    await expect(platform.verify(await other.sign({ adminId: 'admin-1' }))).rejects.toThrow();
  });
});
