import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service.js';
import { verifyPassword } from '../auth/password.js';
import type { PlatformLoginInput, PlatformProfile } from './platform.schemas.js';
import { PlatformTokenService } from './platform-token.service.js';

export interface PlatformSession {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  profile: PlatformProfile;
}

/** [PROPOSTA] 12 horas: quem administra a plataforma entra de novo a cada dia de trabalho. */
export const PLATFORM_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const INVALID_CREDENTIALS = 'E-mail ou senha inválidos.';
const SESSION_EXPIRED = 'Sessão expirada. Entre novamente.';

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * Login e sessão da administração da plataforma. Mesmas garantias da sessão da equipe
 * (argon2id, refresh opaco e rotativo guardado como hash, reuso revoga a família), em
 * tabela própria: nenhuma sessão de barbearia vira sessão da plataforma.
 */
@Injectable()
export class PlatformSessionService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PlatformTokenService) private readonly tokens: PlatformTokenService,
  ) {}

  async login(input: PlatformLoginInput): Promise<PlatformSession> {
    this.tokens.assertEnabled();
    const admin = await this.prisma.platformAdmin.findUnique({
      where: { email: input.email },
      select: { id: true, passwordHash: true },
    });
    // Verifica mesmo sem conta (hash descartável): o tempo não revela quais e-mails existem.
    const valid = await verifyPassword(admin?.passwordHash, input.password);
    if (!admin || !valid) throw new UnauthorizedException(INVALID_CREDENTIALS);
    return this.open(admin.id, randomUUID());
  }

  async refresh(token: string): Promise<PlatformSession> {
    this.tokens.assertEnabled();
    const record = await this.prisma.platformRefreshToken.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    if (!record) throw new UnauthorizedException(SESSION_EXPIRED);
    if (record.revokedAt) {
      await this.revokeFamily(record.familyId);
      throw new UnauthorizedException(SESSION_EXPIRED);
    }
    if (record.expiresAt <= new Date()) throw new UnauthorizedException(SESSION_EXPIRED);

    // Update condicional: de duas requisições concorrentes com o mesmo token, só uma vence.
    const claimed = await this.prisma.platformRefreshToken.updateMany({
      where: { id: record.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (claimed.count === 0) {
      await this.revokeFamily(record.familyId);
      throw new UnauthorizedException(SESSION_EXPIRED);
    }
    return this.open(record.adminId, record.familyId);
  }

  async logout(token: string): Promise<void> {
    const record = await this.prisma.platformRefreshToken.findUnique({
      where: { tokenHash: hashToken(token) },
      select: { familyId: true },
    });
    if (record) await this.revokeFamily(record.familyId);
  }

  async profile(adminId: string): Promise<PlatformProfile> {
    const admin = await this.prisma.platformAdmin.findUnique({
      where: { id: adminId },
      select: { id: true, name: true, email: true },
    });
    // Administrador removido com um access token ainda válido.
    if (!admin) throw new UnauthorizedException(SESSION_EXPIRED);
    return { admin };
  }

  private async open(adminId: string, familyId: string): Promise<PlatformSession> {
    const profile = await this.profile(adminId);
    const refreshToken = randomBytes(32).toString('base64url');
    await this.prisma.platformRefreshToken.create({
      data: {
        adminId,
        familyId,
        tokenHash: hashToken(refreshToken),
        expiresAt: new Date(Date.now() + PLATFORM_SESSION_TTL_MS),
      },
    });
    return {
      accessToken: await this.tokens.sign({ adminId }),
      expiresIn: this.tokens.ttlSeconds,
      refreshToken,
      profile,
    };
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.platformRefreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
