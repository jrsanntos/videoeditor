export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Segundos até poder tentar de novo (vira o cabeçalho Retry-After). */
    public retryAfter?: number,
  ) {
    super(message);
  }
}

/** Converte erros conhecidos em resposta JSON; o resto vira 500. */
export function errorResponse(e: unknown): Response {
  if (e instanceof HttpError)
    return Response.json(
      { error: e.message },
      { status: e.status, headers: e.retryAfter ? { "retry-after": String(e.retryAfter) } : undefined },
    );
  console.error(e);
  return Response.json({ error: "Erro inesperado no servidor." }, { status: 500 });
}
