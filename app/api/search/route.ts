import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { apiError, route } from "@/lib/errors";
import { groupForFind, retrievePassages } from "@/lib/retrieval";
import { bookmarkJson, type BookmarkRow } from "@/lib/serialize";
import { filterParams } from "@/lib/validate";

export const GET = route(async (req) => {
  const user = await requireUser(req);
  const params = new URL(req.url).searchParams;
  const q = params.get("q") ?? "";
  if (q.trim().length < 1 || q.length > 500) {
    throw apiError(400, "validation", "q is required (1–500 characters).");
  }

  const filters = filterParams(params);
  const { passages, semantic } = await retrievePassages(user.id, q, {
    collectionId: filters.collectionId,
    tag: filters.tag,
    from: filters.from,
    to: filters.to,
  });
  const groups = groupForFind(passages);
  if (groups.length === 0) {
    return Response.json({ results: [], semantic });
  }

  const ids = groups.map((g) => g.bookmarkId);
  const rows = await query<BookmarkRow>(
    `SELECT b.*, c.name AS collection_name
     FROM bookmarks b LEFT JOIN collections c ON c.id = b.collection_id
     WHERE b.user_id = $1 AND b.id = ANY (string_to_array($2, ',')::uuid[])`,
    [user.id, ids.join(",")],
  );
  const tagRows = await query<{ bookmark_id: string; name: string }>(
    `SELECT bt.bookmark_id, t.name
     FROM bookmark_tags bt JOIN tags t ON t.id = bt.tag_id
     WHERE bt.bookmark_id = ANY (string_to_array($1, ',')::uuid[])`,
    [ids.join(",")],
  );
  const semRows = await query<{ bookmark_id: string }>(
    `SELECT DISTINCT bookmark_id FROM passages
     WHERE embedding IS NOT NULL AND bookmark_id = ANY (string_to_array($1, ',')::uuid[])`,
    [ids.join(",")],
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  const tagMap = new Map<string, string[]>();
  for (const t of tagRows) {
    tagMap.set(t.bookmark_id, [...(tagMap.get(t.bookmark_id) ?? []), t.name]);
  }
  const sem = new Set(semRows.map((r) => r.bookmark_id));

  const results = groups
    .filter((g) => byId.has(g.bookmarkId))
    .map((g) => {
      const row = byId.get(g.bookmarkId)!;
      return {
        bookmark: bookmarkJson(row, tagMap.get(row.id) ?? [], sem.has(row.id)),
        score: g.score,
        excerpt: g.excerpt,
        passageId: g.passageId,
        matched: g.matched,
      };
    });
  return Response.json({ results, semantic });
});
