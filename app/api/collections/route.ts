import { z } from "zod";
import { assertMutation, requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { apiError, route } from "@/lib/errors";
import { parseBody, readJson } from "@/lib/validate";

export const GET = route(async (req) => {
  const user = await requireUser(req);
  const rows = await query<{ id: string; name: string; count: number }>(
    `SELECT c.id, c.name,
       (SELECT count(*) FROM bookmarks b WHERE b.collection_id = c.id) AS count
     FROM collections c WHERE c.user_id = $1 ORDER BY lower(c.name)`,
    [user.id],
  );
  return Response.json({
    collections: rows.map((r) => ({ id: r.id, name: r.name, count: Number(r.count) })),
  });
});

const createSchema = z.object({ name: z.string().min(1).max(200) });

export const POST = route(async (req) => {
  const user = await requireUser(req);
  assertMutation(req);
  const data = parseBody(createSchema, await readJson(req));
  try {
    const rows = await query<{ id: string; name: string }>(
      "INSERT INTO collections (user_id, name) VALUES ($1, $2) RETURNING id, name",
      [user.id, data.name.trim()],
    );
    return Response.json({ collection: rows[0] }, { status: 201 });
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      throw apiError(409, "duplicate", "A collection with this name already exists.");
    }
    throw err;
  }
});
