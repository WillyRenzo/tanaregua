import { ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';
import { conflict } from '../../common/http/domain-error.js';
import type { AuthContext } from '../../common/tenancy/request-context.js';
import { PrismaService, setDbContext, type Tx } from '../../prisma/prisma.service.js';
import { AccessTokenService } from './access-token.service.js';
import type { LoginInput, RegisterBarbershopInput } from './auth.schemas.js';
import { hashPassword, verifyPassword } from './password.js';
import { canUsePanel, DEFAULT_ROLES, isPermission } from './permissions.js';
import { RefreshTokenService } from './refresh-token.service.js';
import type { SessionProfile } from '../registry.responses.js';
import { SubscriptionsService } from '../subscriptions/subscriptions.service.js';

export interface Session {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  profile: SessionProfile;
}

export type { SessionProfile };

const INVALID_CREDENTIALS = 'E-mail ou senha inválidos.';
const SESSION_EXPIRED = 'Sessão expirada. Entre novamente.';
const NO_PANEL_ACCESS = 'Esta conta não tem acesso ao painel. Para agendar, use a página da barbearia.';

@Injectable()
export class AuthService {
  private readonly accessTtlSeconds: number;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AccessTokenService) private readonly accessTokens: AccessTokenService,
    @Inject(RefreshTokenService) private readonly refreshTokens: RefreshTokenService,
    @Inject(SubscriptionsService) private readonly subscriptions: SubscriptionsService,
    @Inject(ConfigService) config: ConfigService<Env, true>,
  ) {
    this.accessTtlSeconds = config.get('JWT_ACCESS_TTL_SECONDS');
  }

  /** Cria dono + barbearia + papéis padrão + assinatura no plano padrão numa única transação. */
  async registerBarbershop(input: RegisterBarbershopInput): Promise<Session> {
    const passwordHash = await hashPassword(input.password);

    const { userId, membershipId } = await this.prisma.$transaction(async (tx) => {
      if (await tx.user.findUnique({ where: { email: input.email }, select: { id: true } })) {
        throw conflict('email-taken', 'Já existe uma conta com este e-mail.');
      }
      if (await tx.barbershop.findUnique({ where: { slug: input.slug }, select: { id: true } })) {
        throw conflict('slug-taken', 'Este endereço já está em uso por outra barbearia.');
      }

      const user = await tx.user.create({
        data: { email: input.email, name: input.ownerName, passwordHash },
      });
      const barbershop = await tx.barbershop.create({
        data: { name: input.barbershopName, slug: input.slug },
      });
      await setDbContext(tx, { barbershopId: barbershop.id, userId: user.id });
      await this.subscriptions.startTrial(tx, barbershop.id);

      await tx.role.createMany({
        data: Object.values(DEFAULT_ROLES).map((role) => ({
          barbershopId: barbershop.id,
          key: role.key,
          name: role.name,
          permissions: [...role.permissions],
          isSystem: true,
        })),
      });
      const ownerRole = await tx.role.findUniqueOrThrow({
        where: { barbershopId_key: { barbershopId: barbershop.id, key: DEFAULT_ROLES.owner.key } },
        select: { id: true },
      });

      const membership = await tx.membership.create({
        data: {
          barbershopId: barbershop.id,
          userId: user.id,
          roleId: ownerRole.id,
          isProfessional: input.ownerIsProfessional,
        },
      });
      return { userId: user.id, membershipId: membership.id };
    });

    return this.openSession(userId, membershipId);
  }

  async login(input: LoginInput): Promise<Session> {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (!(await verifyPassword(user?.passwordHash, input.password)) || !user) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    const membershipId = await this.prisma.withContext({ userId: user.id }, async (tx) => {
      const memberships = await tx.membership.findMany({
        where: {
          userId: user.id,
          active: true,
          ...(input.barbershopSlug ? { barbershop: { slug: input.barbershopSlug } } : {}),
        },
        select: { id: true, barbershopId: true, roleId: true },
        orderBy: { createdAt: 'asc' },
      });
      if (memberships.length === 0) throw new UnauthorizedException(INVALID_CREDENTIALS);

      // A mesma conta pode ser cliente de uma barbearia e equipe de outra: o painel entra
      // pelo primeiro vínculo cujo papel dá acesso a ele, não pelo mais antigo.
      for (const membership of memberships) {
        // O papel é isolado por tenant: só fica visível depois de definir a barbearia.
        await setDbContext(tx, { userId: user.id, barbershopId: membership.barbershopId });
        const role = await this.findRole(tx, membership.roleId);
        if (role && canUsePanel(role.permissions)) return membership.id;
      }
      throw new ForbiddenException(NO_PANEL_ACCESS);
    });

    return this.openSession(user.id, membershipId);
  }

  async refresh(refreshToken: string): Promise<Session> {
    const rotation = await this.refreshTokens.rotate(refreshToken);
    if (rotation.status === 'invalid') {
      throw new UnauthorizedException(SESSION_EXPIRED);
    }
    const profile = await this.loadProfile(rotation.owner.userId, rotation.owner.membershipId);
    if (!profile) {
      throw new UnauthorizedException(SESSION_EXPIRED);
    }
    return this.buildSession(profile, rotation.token);
  }

  logout(refreshToken: string): Promise<void> {
    return this.refreshTokens.revoke(refreshToken);
  }

  async profile(auth: AuthContext): Promise<SessionProfile> {
    const profile = await this.loadProfile(auth.userId, auth.membershipId);
    if (!profile) throw new UnauthorizedException(SESSION_EXPIRED);
    return profile;
  }

  /** Abre uma sessão nova para um vínculo existente (usado também no cadastro de cliente). */
  async openSession(userId: string, membershipId: string): Promise<Session> {
    const profile = await this.loadProfile(userId, membershipId);
    if (!profile) throw new UnauthorizedException(INVALID_CREDENTIALS);
    const refreshToken = await this.refreshTokens.issue({ userId, membershipId });
    return this.buildSession(profile, refreshToken);
  }

  private async buildSession(profile: SessionProfile, refreshToken: string): Promise<Session> {
    const accessToken = await this.accessTokens.sign({
      userId: profile.user.id,
      barbershopId: profile.barbershop.id,
      membershipId: profile.membership.id,
      permissions: profile.permissions.filter(isPermission),
    });
    return { accessToken, expiresIn: this.accessTtlSeconds, refreshToken, profile };
  }

  private loadProfile(userId: string, membershipId: string): Promise<SessionProfile | null> {
    return this.prisma.withContext({ userId }, async (tx) => {
      const membership = await tx.membership.findFirst({
        where: { id: membershipId, userId, active: true },
        include: {
          user: { select: { id: true, name: true, email: true } },
          barbershop: { select: { id: true, name: true, slug: true, timezone: true } },
        },
      });
      if (!membership) return null;

      // O papel é isolado por tenant: só fica visível depois de definir a barbearia.
      await setDbContext(tx, { userId, barbershopId: membership.barbershopId });
      const role = await this.findRole(tx, membership.roleId);
      if (!role) return null;

      return {
        user: membership.user,
        barbershop: membership.barbershop,
        membership: {
          id: membership.id,
          isProfessional: membership.isProfessional,
          role: { key: role.key, name: role.name },
        },
        permissions: role.permissions.filter(isPermission),
        subscription: await this.subscriptions.summary(tx, membership.barbershopId),
      };
    });
  }

  private findRole(tx: Tx, roleId: string) {
    return tx.role.findUnique({
      where: { id: roleId },
      select: { key: true, name: true, permissions: true },
    });
  }
}
