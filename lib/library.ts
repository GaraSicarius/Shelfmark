import { query, transaction } from "@/lib/db";
import { bookmarkJson, type BookmarkRow } from "@/lib/serialize";

export async function collectionOwned(
  userId: string,
  collectionId: string,
): Promise<boolean> {
  const rows = await query(
    "SELECT id FROM collections WHERE id = $1 AND user_id = $2",
    [collectionId, userId],
  );
  return rows.length > 0;
}

// Tags are matched per-user case-insensitively and created on demand.
export async function ensureTagIds(userId: string, names: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    const found = await query<{ id: string }>(
      "SELECT id FROM tags WHERE user_id = $1 AND lower(name) = lower($2)",
      [userId, name],
    );
    if (found.length > 0) {
      ids.push(found[0].id);
      continue;
    }
    try {
      const created = await query<{ id: string }>(
        "INSERT INTO tags (user_id, name) VALUES ($1, $2) RETURNING id",
        [userId, name],
      );
      ids.push(created[0].id);
    } catch {
      // Lost a concurrent insert race: the row now exists.
      const again = await query<{ id: string }>(
        "SELECT id FROM tags WHERE user_id = $1 AND lower(name) = lower($2)",
        [userId, name],
      );
      if (again.length > 0) ids.push(again[0].id);
    }
  }
  return [...new Set(ids)];
}

export async function setBookmarkTags(
  userId: string,
  bookmarkId: string,
  names: string[],
): Promise<void> {
  const tagIds = await ensureTagIds(userId, names);
  await transaction(async (tx) => {
    await tx("DELETE FROM bookmark_tags WHERE bookmark_id = $1", [bookmarkId]);
    for (const tagId of tagIds) {
      await tx(
        "INSERT INTO bookmark_tags (bookmark_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [bookmarkId, tagId],
      );
    }
  });
}

export async function tagsByBookmark(userId: string): Promise<Map<string, string[]>> {
  const rows = await query<{ bookmark_id: string; name: string }>(
    `SELECT bt.bookmark_id, t.name
     FROM bookmark_tags bt
     JOIN tags t ON t.id = bt.tag_id
     JOIN bookmarks b ON b.id = bt.bookmark_id
     WHERE b.user_id = $1`,
    [userId],
  );
  const map = new Map<string, string[]>();
  for (const row of rows) {
    const list = map.get(row.bookmark_id) ?? [];
    list.push(row.name);
    map.set(row.bookmark_id, list);
  }
  return map;
}

export async function semanticIndexedSet(userId: string): Promise<Set<string>> {
  const rows = await query<{ bookmark_id: string }>(
    `SELECT DISTINCT p.bookmark_id
     FROM passages p JOIN bookmarks b ON b.id = p.bookmark_id
     WHERE b.user_id = $1 AND p.embedding IS NOT NULL`,
    [userId],
  );
  return new Set(rows.map((r) => r.bookmark_id));
}

export async function getBookmarkRow(
  userId: string,
  id: string,
): Promise<BookmarkRow | null> {
  const rows = await query<BookmarkRow>(
    `SELECT b.*, c.name AS collection_name
     FROM bookmarks b LEFT JOIN collections c ON c.id = b.collection_id
     WHERE b.id = $1 AND b.user_id = $2`,
    [id, userId],
  );
  return rows[0] ?? null;
}

export async function bookmarkResponse(userId: string, row: BookmarkRow) {
  const [tags, sem] = await Promise.all([tagsByBookmark(userId), semanticIndexedSet(userId)]);
  return bookmarkJson(row, tags.get(row.id) ?? [], sem.has(row.id));
}
