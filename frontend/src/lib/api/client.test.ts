import { afterEach, describe, expect, it, vi } from 'vitest';
import { idempotencyKey } from './client';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('idempotencyKey', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('gera UUID v4', () => {
    expect(idempotencyKey()).toMatch(UUID_V4);
  });

  it('funciona fora de contexto seguro (sem crypto.randomUUID)', () => {
    const original = globalThis.crypto;
    vi.stubGlobal('crypto', { getRandomValues: (array: Uint8Array) => original.getRandomValues(array) });
    const keys = new Set(Array.from({ length: 50 }, () => idempotencyKey()));
    expect(keys.size).toBe(50);
    for (const key of keys) expect(key).toMatch(UUID_V4);
  });
});
