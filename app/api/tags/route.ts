import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { route } from "@/lib/errors";

export const GET = route(async (req) => {
  const user = await requireUser(req);
  const rows = await query<{ name: string; count: number }>(
    `SELECT t.name,
       (SELECT count(*) FROM bookmark_tags bt WHERE bt.tag_id = t.id) AS count
     FROM tags t WHERE t.user_id = $1 ORDER BY lower(t.name)`,
    [user.id],
  );
  return Response.json({
    tags: rows.map((r) => ({ name: r.name, count: Number(r.count) })),
  });
});
