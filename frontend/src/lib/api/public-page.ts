interface Fetched<T> {
  data?: T;
  response: Response;
}

/**
 * Junta as respostas da página pública. Só 404 significa "barbearia inexistente"; qualquer
 * outra falha lança erro, para não ir para o cache (o `'use cache'` guarda o retorno, não
 * as exceções) e para a página mostrar o erro em vez de "não encontrada" ou agenda vazia.
 */
export function toPublicPage<B, S, P>(
  info: Fetched<B>,
  services: Fetched<S[]>,
  professionals: Fetched<P[]>,
): { barbershop: B; services: S[]; professionals: P[] } | null {
  if (info.response.status === 404) return null;
  return { barbershop: required(info), services: required(services), professionals: required(professionals) };
}

function required<T>({ data, response }: Fetched<T>): T {
  if (!response.ok || data === undefined) {
    throw new Error(`API pública respondeu ${response.status} (${response.url || 'sem URL'})`);
  }
  return data;
}
