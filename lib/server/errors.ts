export class CommandError extends Error {
  constructor(
    public code: string,
    public status: number,
    public retryable = false
  ) {
    super(code)
  }
}
export function fail(code: string, status = 409): never {
  throw new CommandError(code, status)
}

/** Never return/log Prisma/pg errors: they may embed connection and SQL values. */
export function publicError(error: unknown, requestId: string) {
  const known = error instanceof CommandError
  return Response.json(
    {
      ok: false,
      error: {
        code: known ? error.code : "INTERNAL_ERROR",
        requestId,
        message: known ? error.code : "Request failed",
        retryable: known && error.retryable,
      },
    },
    {
      status: known ? error.status : 500,
      headers: {
        "Cache-Control": "private,no-store",
        ...(known && error.retryable ? { "Retry-After": "1" } : {}),
      },
    }
  )
}
