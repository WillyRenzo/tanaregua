/** RFC 9457 Problem Details — formato único de erro da API. */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  errors?: string[];
}

export class ApiError extends Error {
  constructor(readonly problem: ProblemDetails) {
    super(problem.detail ?? problem.title);
  }

  get status(): number {
    return this.problem.status;
  }

  /** Código do problema (o final do `type`): appointment-conflict, slot-unavailable… */
  get code(): string {
    return this.problem.type.split('/').pop() ?? '';
  }

  /** Mensagem para o usuário: o detalhe da API já vem em pt-BR. */
  get userMessage(): string {
    if (this.problem.errors?.length) return this.problem.errors.join(' ');
    return this.problem.detail ?? 'Algo deu errado. Tente novamente.';
  }
}

export function isProblem(value: unknown): value is ProblemDetails {
  return typeof value === 'object' && value !== null && 'status' in value && 'title' in value;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.userMessage;
  return 'Não foi possível falar com o servidor. Verifique sua conexão.';
}
