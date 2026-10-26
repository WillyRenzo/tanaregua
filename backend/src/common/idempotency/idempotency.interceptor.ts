import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { from, mergeMap, Observable, of, catchError, throwError } from 'rxjs';
import { conflict, unprocessable } from '../http/domain-error.js';
import { postgresErrorCode } from '../http/database-errors.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { AuthContext } from '../tenancy/request-context.js';

const HEADER = 'idempotency-key';

/**
 * Implementa o header `Idempotency-Key` em POSTs sensíveis (criar agendamento,
 * fechar comanda): a mesma chave reenviada (duplo clique, retry de rede) devolve a
 * resposta original em vez de executar de novo. Escopo da chave = usuário autenticado.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request & { auth?: AuthContext }>();
    const response = http.getResponse<Response>();
    const key = request.headers[HEADER];
    const userId = request.auth?.userId;

    if (typeof key !== 'string' || !userId) return next.handle();
    if (key.length < 8 || key.length > 100) {
      return throwError(() =>
        unprocessable('invalid-idempotency-key', 'Idempotency-Key deve ter de 8 a 100 caracteres.'),
      );
    }

    const requestHash = createHash('sha256')
      .update(`${request.method} ${request.originalUrl} ${JSON.stringify(request.body ?? {})}`)
      .digest('hex');

    return from(this.claim(userId, key, requestHash)).pipe(
      mergeMap((claim) => {
        if (claim.kind === 'replay') {
          response.status(claim.code);
          return of(claim.body);
        }
        return next.handle().pipe(
          mergeMap((body: unknown) =>
            from(this.complete(claim.id, response.statusCode, body)).pipe(mergeMap(() => of(body))),
          ),
          catchError((error: unknown) =>
            // Falhou: libera a chave para o cliente poder tentar de novo.
            from(this.prisma.idempotencyKey.delete({ where: { id: claim.id } })).pipe(
              mergeMap(() => throwError(() => error)),
            ),
          ),
        );
      }),
    );
  }

  private async claim(
    userId: string,
    key: string,
    requestHash: string,
  ): Promise<{ kind: 'new'; id: string } | { kind: 'replay'; code: number; body: unknown }> {
    try {
      const created = await this.prisma.idempotencyKey.create({
        data: { userId, key, requestHash },
        select: { id: true },
      });
      return { kind: 'new', id: created.id };
    } catch (error) {
      if (postgresErrorCode(error) !== '23505' && (error as { code?: string }).code !== 'P2002') {
        throw error;
      }
    }

    const existing = await this.prisma.idempotencyKey.findUniqueOrThrow({
      where: { userId_key: { userId, key } },
    });
    if (existing.requestHash !== requestHash) {
      throw unprocessable('idempotency-key-reused', 'Esta Idempotency-Key já foi usada em outra requisição.');
    }
    if (existing.responseCode === null) {
      throw conflict('request-in-progress', 'A requisição original ainda está em processamento.');
    }
    return { kind: 'replay', code: existing.responseCode, body: existing.responseBody };
  }

  private async complete(id: string, code: number, body: unknown): Promise<void> {
    await this.prisma.idempotencyKey.update({
      where: { id },
      data: { responseCode: code, responseBody: (body ?? null) as Prisma.InputJsonValue },
    });
  }
}
