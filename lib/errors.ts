export type ErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "validation"
  | "duplicate"
  | "conflict"
  | "rate_limited"
  | "ai_unavailable"
  | "internal";

export function apiError(
  status: number,
  code: ErrorCode,
  message?: string,
  details?: unknown,
): Response {
  const body: Record<string, unknown> = { error: code };
  if (message !== undefined) body.message = message;
  if (details !== undefined) body.details = details;
  return Response.json(body, { status });
}

export function fail(
  status: number,
  code: ErrorCode,
  message?: string,
  details?: unknown,
): never {
  throw apiError(status, code, message, details);
}

export const unauthorized = (): Response => apiError(401, "unauthorized");
export const forbidden = (message?: string): Response => apiError(403, "forbidden", message);
export const notFound = (): Response => apiError(404, "not_found");

type RouteHandler<C> = (req: Request, ctx: C) => Promise<Response> | Response;

// Wraps a route handler: thrown Response objects (from fail()/requireUser())
// become the HTTP response; anything else is logged and reported as 500.
export function route<C>(handler: RouteHandler<C>) {
  return async (req: Request, ctx: C): Promise<Response> => {
    try {
      return await handler(req, ctx);
    } catch (err) {
      if (err instanceof Response) return err;
      console.error("[shelfmark] unhandled route error:", err);
      return apiError(500, "internal", "Unexpected server error.");
    }
  };
}
