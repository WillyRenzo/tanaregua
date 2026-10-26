import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Env } from '../../config/env.js';
import { PrismaService } from '../../prisma/prisma.service.js';

export interface RefreshTokenOwner {
  userId: string;
  membershipId: string;
}

export type RotationResult =
  { status: 'rotated'; token: string; owner: RefreshTokenOwner } | { status: 'invalid' };

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * Refresh tokens opacos e rotativos. Só o hash vai para o banco. Reuso de um token
 * já rotacionado indica roubo: a família inteira (a sessão) é revogada.
 */
@Injectable()
export class RefreshTokenService {
  private readonly ttlMs: number;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConfigService) config: ConfigService<Env, true>,
  ) {
    this.ttlMs = config.get('REFRESH_TOKEN_TTL_DAYS') * 24 * 60 * 60 * 1000;
  }

  get maxAgeMs(): number {
    return this.ttlMs;
  }

  async issue(owner: RefreshTokenOwner, familyId: string = randomUUID()): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.prisma.refreshToken.create({
      data: {
        ...owner,
        familyId,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + this.ttlMs),
      },
    });
    return token;
  }

  async rotate(token: string): Promise<RotationResult> {
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    if (!record) return { status: 'invalid' };

    if (record.revokedAt) {
      await this.revokeFamily(record.familyId);
      return { status: 'invalid' };
    }
    if (record.expiresAt <= new Date()) return { status: 'invalid' };

    // Update condicional: de duas requisições concorrentes com o mesmo token, só uma vence.
    const claimed = await this.prisma.refreshToken.updateMany({
      where: { id: record.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (claimed.count === 0) {
      await this.revokeFamily(record.familyId);
      return { status: 'invalid' };
    }

    const owner = { userId: record.userId, membershipId: record.membershipId };
    return { status: 'rotated', owner, token: await this.issue(owner, record.familyId) };
  }

  async revoke(token: string): Promise<void> {
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(token) },
      select: { familyId: true },
    });
    if (record) await this.revokeFamily(record.familyId);
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
