import { z } from "zod";
import { assertMutation, requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { apiError, notFound, route } from "@/lib/errors";
import { parseBody, readJson } from "@/lib/validate";

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({ name: z.string().min(1).max(200) });

export const PATCH = route(async (req, ctx: Ctx) => {
  const user = await requireUser(req);
  assertMutation(req);
  const { id } = await ctx.params;
  const data = parseBody(patchSchema, await readJson(req));
  try {
    const rows = await query<{ id: string; name: string }>(
      "UPDATE collections SET name = $2 WHERE id = $1 AND user_id = $3 RETURNING id, name",
      [id, data.name.trim(), user.id],
    );
    if (rows.length === 0) throw notFound();
    return Response.json({ collection: rows[0] });
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      throw apiError(409, "duplicate", "A collection with this name already exists.");
    }
    throw err;
  }
});

export const DELETE = route(async (req, ctx: Ctx) => {
  const user = await requireUser(req);
  assertMutation(req);
  const { id } = await ctx.params;
  const rows = await query<{ id: string }>(
    "DELETE FROM collections WHERE id = $1 AND user_id = $2 RETURNING id",
    [id, user.id],
  );
  if (rows.length === 0) throw notFound();
  return new Response(null, { status: 204 });
});
