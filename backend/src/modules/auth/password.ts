import argon2 from 'argon2';

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

// Hash de uma senha descartável: quando o e-mail não existe, verificamos contra ele
// para que o tempo de resposta não revele quais e-mails estão cadastrados.
const dummyHash = hashPassword('timing-equalizer-not-a-real-password');

export async function verifyPassword(hash: string | undefined, password: string): Promise<boolean> {
  if (!hash) {
    await argon2.verify(await dummyHash, password);
    return false;
  }
  return argon2.verify(hash, password);
}
