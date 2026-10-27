import { query, transaction } from "@/lib/db";
import { apiError, notFound } from "@/lib/errors";
import { contentHash, jobInFlight, normalizeWhitespace, scheduleProcess } from "@/lib/jobs";
import {
  bookmarkResponse,
  collectionOwned,
  getBookmarkRow,
  setBookmarkTags,
} from "@/lib/library";
import type { BookmarkRow } from "@/lib/serialize";
import { normalizeUrl } from "@/lib/url";

export interface CreateBookmarkInput {
  url?: string;
  text?: string;
  title?: string;
  note?: string;
  collectionId?: string;
  tags?: string[];
}

async function duplicateResponse(
  userId: string,
  where: string,
  value: string,
): Promise<never> {
  const rows = await query<BookmarkRow>(
    `SELECT b.*, c.name AS collection_name
     FROM bookmarks b LEFT JOIN collections c ON c.id = b.collection_id
     WHERE b.user_id = $1 AND ${where} = $2`,
    [userId, value],
  );
  const existing = rows[0];
  const bookmark = existing ? await bookmarkResponse(userId, existing) : null;
  throw Response.json({ error: "duplicate", bookmark }, { status: 409 });
}

// Validates ownership of the collection, inserts a pending row, applies tags,
// and throws the documented 409 { error: "duplicate", bookmark } on conflicts.
export async function createBookmark(
  userId: string,
  data: CreateBookmarkInput,
): Promise<BookmarkRow> {
  if (data.collectionId && !(await collectionOwned(userId, data.collectionId))) {
    throw notFound();
  }
  let row: BookmarkRow;
  try {
    if (data.url !== undefined) {
      const normalized = normalizeUrl(data.url);
      if (!normalized) throw apiError(400, "validation", "Invalid URL.");
      const rows = await query<BookmarkRow>(
        `INSERT INTO bookmarks (user_id, source_type, url, normalized_url, domain, title, note, collection_id)
         VALUES ($1, 'url', $2, $3, $4, $5, $6, $7) RETURNING *`,
        [
          userId,
          data.url,
          normalized.url,
          normalized.domain,
          data.title ?? normalized.domain,
          data.note ?? null,
          data.collectionId ?? null,
        ],
      );
      row = rows[0];
    } else {
      const text = normalizeWhitespace(data.text!);
      const rows = await query<BookmarkRow>(
        `INSERT INTO bookmarks (user_id, source_type, title, note, collection_id, content_text, content_hash)
         VALUES ($1, 'text', $2, $3, $4, $5, $6) RETURNING *`,
        [userId, data.title!, data.note ?? null, data.collectionId ?? null, text, contentHash(text)],
      );
      row = rows[0];
    }
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      if (data.url !== undefined) {
        const normalized = normalizeUrl(data.url);
        if (normalized) return duplicateResponse(userId, "b.normalized_url", normalized.url);
      } else {
        return duplicateResponse(userId, "b.content_hash", contentHash(normalizeWhitespace(data.text!)));
      }
    }
    throw err;
  }
  if (data.tags?.length) await setBookmarkTags(userId, row.id, data.tags);
  return row;
}

export interface PatchBookmarkInput {
  title?: string;
  note?: string | null;
  collectionId?: string | null;
  tags?: string[];
}

export async function patchBookmark(
  userId: string,
  id: string,
  data: PatchBookmarkInput,
): Promise<BookmarkRow> {
  const existing = await getBookmarkRow(userId, id);
  if (!existing) throw notFound();
  if (data.collectionId !== undefined && data.collectionId !== null) {
    if (!(await collectionOwned(userId, data.collectionId))) throw notFound();
  }
  const sets: string[] = ["updated_at = now()"];
  const args: unknown[] = [id];
  if (data.title !== undefined) {
    args.push(data.title);
    sets.push(`title = $${args.length}`);
  }
  if (data.note !== undefined) {
    args.push(data.note);
    sets.push(`note = $${args.length}`);
  }
  if (data.collectionId !== undefined) {
    args.push(data.collectionId);
    sets.push(`collection_id = $${args.length}`);
  }
  const newTitle = data.title ?? existing.title;
  await transaction(async (tx) => {
    await tx(`UPDATE bookmarks SET ${sets.join(", ")} WHERE id = $1`, args);
    if (data.title !== undefined) {
      await tx(
        "UPDATE passages SET tsv = to_tsvector('english', $2 || ' ' || text) WHERE bookmark_id = $1",
        [id, newTitle],
      );
    }
  });
  if (data.tags !== undefined) await setBookmarkTags(userId, id, data.tags);
  return (await getBookmarkRow(userId, id))!;
}

export async function deleteBookmark(userId: string, id: string): Promise<void> {
  const rows = await query<{ id: string }>(
    "DELETE FROM bookmarks WHERE id = $1 AND user_id = $2 RETURNING id",
    [id, userId],
  );
  if (rows.length === 0) throw notFound();
}

// Re-queues a bookmark; optional pasted text is the extraction fallback.
export async function retryBookmark(
  userId: string,
  id: string,
  text?: string,
): Promise<BookmarkRow> {
  const existing = await getBookmarkRow(userId, id);
  if (!existing) throw notFound();
  // A queued-but-unclaimed job still reads 'pending' in the DB, so the
  // in-flight check covers the window before the worker claims it.
  if (existing.status === "processing" || jobInFlight(id)) {
    throw apiError(409, "conflict", "This bookmark is already being processed.");
  }
  await query(
    `UPDATE bookmarks SET status = 'pending', error = NULL, attempts = 0, updated_at = now()
     WHERE id = $1`,
    [id],
  );
  const row = (await getBookmarkRow(userId, id))!;
  scheduleProcess(id, text !== undefined ? { text } : {});
  return row;
}
