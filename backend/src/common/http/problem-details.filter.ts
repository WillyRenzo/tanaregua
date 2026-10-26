import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { STATUS_CODES } from 'node:http';
import type { Request, Response } from 'express';
import { DomainError } from './domain-error.js';
import { mapDatabaseError } from './database-errors.js';

/** RFC 9457 Problem Details: formato único de erro da API. */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  errors?: string[];
}

const PROBLEM_TYPE_BASE = 'https://tanaregua.app/problems/';

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const problem = this.toProblem(exception);
    problem.instance = request.originalUrl;

    if (problem.status >= 500) {
      // Detalhes internos vão para o log, nunca para o cliente.
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }

    response.status(problem.status).type('application/problem+json').json(problem);
  }

  private toProblem(exception: unknown): ProblemDetails {
    if (exception instanceof DomainError) {
      return {
        type: PROBLEM_TYPE_BASE + exception.code,
        title: exception.title,
        status: exception.status,
        detail: exception.message,
      };
    }

    const databaseError = mapDatabaseError(exception);
    if (databaseError) {
      return this.toProblem(databaseError);
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const messages =
        typeof body === 'object' && body !== null && 'message' in body ? body.message : undefined;
      return {
        type: 'about:blank',
        title: STATUS_CODES[status] ?? 'Error',
        status,
        detail: Array.isArray(messages) ? 'A requisição contém campos inválidos.' : exception.message,
        errors: Array.isArray(messages) ? messages.map(String) : undefined,
      };
    }

    return {
      type: 'about:blank',
      title: 'Internal Server Error',
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      detail: 'Erro inesperado. Tente novamente.',
    };
  }
}
