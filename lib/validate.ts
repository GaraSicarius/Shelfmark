import { z } from "zod";
import { fail } from "@/lib/errors";

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

export function parseBody<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    fail(400, "validation", "Invalid request.", { issues: result.error.issues });
  }
  return result.data;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES = new Set(["pending", "processing", "ready", "failed"]);

// Strict YYYY-MM-DD that must also be a real calendar date.
export function isDateString(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export interface FilterParams {
  collectionId: string | null;
  tag: string | null;
  from: string | null;
  to: string | null;
  status: string | null;
}

// Shared filter validation for GET /api/bookmarks and GET /api/search:
// from/to must be real YYYY-MM-DD dates, status must be a known status.
export function filterParams(params: URLSearchParams): FilterParams {
  const from = params.get("from");
  const to = params.get("to");
  const status = params.get("status");
  if (from !== null && !isDateString(from)) {
    fail(400, "validation", "from must be a real YYYY-MM-DD date.");
  }
  if (to !== null && !isDateString(to)) {
    fail(400, "validation", "to must be a real YYYY-MM-DD date.");
  }
  if (status !== null && !STATUSES.has(status)) {
    fail(400, "validation", "status must be pending, processing, ready or failed.");
  }
  return {
    collectionId: params.get("collectionId"),
    tag: params.get("tag"),
    from,
    to,
    status,
  };
}
