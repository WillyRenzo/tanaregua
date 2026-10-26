import { Inject, Injectable } from '@nestjs/common';
import { conflict, notFound, unprocessable } from '../../common/http/domain-error.js';
import { toClock } from '../../common/time/clock-time.js';
import { TenantDb } from '../../common/tenancy/tenant-db.service.js';
import type { Tx } from '../../prisma/prisma.service.js';
import { hashPassword } from '../auth/password.js';
import { DEFAULT_ROLES } from '../auth/permissions.js';
import type { ScheduleInterval, StaffMember } from '../registry.responses.js';
import type {
  CreateStaffInput,
  CreateTimeOffInput,
  ReplaceScheduleInput,
  TimeOffRange,
  UpdateStaffInput,
} from './staff.schemas.js';

export type { ScheduleInterval, StaffMember };

/** Expediente em minutos, consumido pelo cálculo de disponibilidade da agenda. */
export interface WorkInterval {
  membershipId: string;
  weekday: number;
  startMinute: number;
  endMinute: number;
}

const CLIENT_ROLE = DEFAULT_ROLES.client.key;

const memberInclude = {
  user: { select: { name: true, email: true } },
  role: { select: { key: true, name: true } },
} as const;

type MemberRow = {
  id: string;
  userId: string;
  isProfessional: boolean;
  active: boolean;
  user: { name: string; email: string };
  role: { key: string; name: string };
};

const toMember = (row: MemberRow): StaffMember => ({
  id: row.id,
  userId: row.userId,
  name: row.user.name,
  email: row.user.email,
  isProfessional: row.isProfessional,
  active: row.active,
  role: row.role,
});

@Injectable()
export class StaffService {
  constructor(@Inject(TenantDb) private readonly db: TenantDb) {}

  list(): Promise<StaffMember[]> {
    return this.db.run(async (tx, auth) => {
      const rows = await tx.membership.findMany({
        where: { barbershopId: auth.barbershopId, role: { key: { not: CLIENT_ROLE } } },
        include: memberInclude,
        orderBy: { createdAt: 'asc' },
      });
      return rows.map(toMember);
    });
  }

  /** Profissionais ativos que aparecem como colunas na agenda. */
  listProfessionals(tx: Tx, barbershopId: string) {
    return tx.membership.findMany({
      where: { barbershopId, active: true, isProfessional: true },
      select: { id: true, user: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  create(input: CreateStaffInput): Promise<StaffMember> {
    return this.db.run(async (tx, auth) => {
      const role = await this.findStaffRole(tx, auth.barbershopId, input.roleKey);

      const existingUser = await tx.user.findUnique({ where: { email: input.email } });
      const user =
        existingUser ??
        (await tx.user.create({
          data: { email: input.email, name: input.name, passwordHash: await hashPassword(input.password) },
        }));

      const alreadyMember = await tx.membership.findUnique({
        where: { barbershopId_userId: { barbershopId: auth.barbershopId, userId: user.id } },
        select: { id: true },
      });
      if (alreadyMember) {
        throw conflict('already-member', 'Esta pessoa já faz parte da equipe.');
      }

      const membership = await tx.membership.create({
        data: {
          barbershopId: auth.barbershopId,
          userId: user.id,
          roleId: role.id,
          isProfessional: input.isProfessional,
        },
        include: memberInclude,
      });
      return toMember(membership);
    });
  }

  update(membershipId: string, input: UpdateStaffInput): Promise<StaffMember> {
    return this.db.run(async (tx, auth) => {
      await this.findMember(tx, auth.barbershopId, membershipId);

      const changesAccess = input.roleKey !== undefined || input.active === false;
      if (changesAccess && membershipId === auth.membershipId) {
        // Evita que o dono se tranque fora do próprio painel.
        throw unprocessable('cannot-change-self', 'Você não pode alterar o próprio papel ou se desativar.');
      }

      const role = input.roleKey ? await this.findStaffRole(tx, auth.barbershopId, input.roleKey) : undefined;
      const updated = await tx.membership.update({
        where: { id: membershipId },
        data: { isProfessional: input.isProfessional, active: input.active, roleId: role?.id },
        include: memberInclude,
      });
      return toMember(updated);
    });
  }

  getSchedule(membershipId: string): Promise<ScheduleInterval[]> {
    return this.db.run(async (tx, auth) => {
      await this.findMember(tx, auth.barbershopId, membershipId);
      const rows = await tx.workSchedule.findMany({
        where: { barbershopId: auth.barbershopId, membershipId },
        orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }],
      });
      return rows.map((row) => ({
        weekday: row.weekday,
        start: toClock(row.startMinute),
        end: toClock(row.endMinute),
      }));
    });
  }

  async replaceSchedule(membershipId: string, input: ReplaceScheduleInput): Promise<ScheduleInterval[]> {
    await this.db.run(async (tx, auth) => {
      await this.findMember(tx, auth.barbershopId, membershipId);
      await tx.workSchedule.deleteMany({ where: { barbershopId: auth.barbershopId, membershipId } });
      await tx.workSchedule.createMany({
        data: input.intervals.map((interval) => ({
          barbershopId: auth.barbershopId,
          membershipId,
          weekday: interval.weekday,
          startMinute: interval.start,
          endMinute: interval.end,
        })),
      });
    });
    return this.getSchedule(membershipId);
  }

  /** Expediente de vários profissionais, para o cálculo de disponibilidade. */
  workIntervals(tx: Tx, barbershopId: string, membershipIds: string[]): Promise<WorkInterval[]> {
    return tx.workSchedule.findMany({
      where: { barbershopId, membershipId: { in: membershipIds } },
      select: { membershipId: true, weekday: true, startMinute: true, endMinute: true },
    });
  }

  /** Folgas que tocam o intervalo [from, to). */
  timeOffsBetween(tx: Tx, barbershopId: string, membershipIds: string[], from: Date, to: Date) {
    return tx.timeOff.findMany({
      where: {
        barbershopId,
        membershipId: { in: membershipIds },
        startsAt: { lt: to },
        endsAt: { gt: from },
      },
      select: { id: true, membershipId: true, startsAt: true, endsAt: true, reason: true },
      orderBy: { startsAt: 'asc' },
    });
  }

  listTimeOffs(membershipId: string, range: TimeOffRange) {
    return this.db.run(async (tx, auth) => {
      await this.findMember(tx, auth.barbershopId, membershipId);
      return this.timeOffsBetween(tx, auth.barbershopId, [membershipId], range.from, range.to);
    });
  }

  createTimeOff(membershipId: string, input: CreateTimeOffInput) {
    return this.db.run(async (tx, auth) => {
      await this.findMember(tx, auth.barbershopId, membershipId);
      return tx.timeOff.create({
        data: { barbershopId: auth.barbershopId, membershipId, ...input },
        select: { id: true, membershipId: true, startsAt: true, endsAt: true, reason: true },
      });
    });
  }

  deleteTimeOff(membershipId: string, timeOffId: string): Promise<void> {
    return this.db.run(async (tx, auth) => {
      const deleted = await tx.timeOff.deleteMany({
        where: { id: timeOffId, membershipId, barbershopId: auth.barbershopId },
      });
      if (deleted.count === 0) throw notFound('Folga');
    });
  }

  listRoles() {
    return this.db.run((tx, auth) =>
      tx.role.findMany({
        where: { barbershopId: auth.barbershopId, key: { not: CLIENT_ROLE } },
        select: { id: true, key: true, name: true, isSystem: true, permissions: true },
        orderBy: { createdAt: 'asc' },
      }),
    );
  }

  /** Nomes de funcionários (inclusive inativos), para relatórios. */
  async names(tx: Tx, barbershopId: string, membershipIds: string[]): Promise<Map<string, string>> {
    const rows = await tx.membership.findMany({
      where: { barbershopId, id: { in: membershipIds } },
      select: { id: true, user: { select: { name: true } } },
    });
    return new Map(rows.map((row) => [row.id, row.user.name]));
  }

  /** Profissional ativo que atende (aparece na agenda). 422 se não puder receber agendamentos. */
  async assertProfessional(tx: Tx, barbershopId: string, membershipId: string) {
    const professional = await tx.membership.findFirst({
      where: { id: membershipId, barbershopId, active: true, isProfessional: true },
      select: { id: true, user: { select: { name: true } } },
    });
    if (!professional) {
      throw unprocessable('invalid-professional', 'Profissional inexistente, inativo ou que não atende.');
    }
    return { id: professional.id, name: professional.user.name };
  }

  /** Para outros módulos (comissões, agenda) validarem um funcionário desta barbearia. */
  async assertStaffMember(tx: Tx, barbershopId: string, membershipId: string): Promise<void> {
    await this.findMember(tx, barbershopId, membershipId);
  }

  private async findMember(tx: Tx, barbershopId: string, membershipId: string) {
    const member = await tx.membership.findFirst({
      where: { id: membershipId, barbershopId, role: { key: { not: CLIENT_ROLE } } },
      select: { id: true },
    });
    if (!member) throw notFound('Funcionário');
    return member;
  }

  private async findStaffRole(tx: Tx, barbershopId: string, key: string) {
    const role =
      key === CLIENT_ROLE
        ? null
        : await tx.role.findUnique({
            where: { barbershopId_key: { barbershopId, key } },
            select: { id: true },
          });
    if (!role) throw unprocessable('invalid-role', 'Papel inexistente para esta barbearia.');
    return role;
  }
}
