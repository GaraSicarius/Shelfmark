import { createHash } from "node:crypto";
import { embedTexts } from "@/lib/ai";
import { chunkText } from "@/lib/chunk";
import { query, transaction } from "@/lib/db";
import { apiError } from "@/lib/errors";
import { extractReadable } from "@/lib/extract";
import { safeFetch, SafeFetchError } from "@/lib/safe-fetch";
import type { BookmarkRow } from "@/lib/serialize";

const MAX_ATTEMPTS = 3;
const CONCURRENCY = 2;
const CONTENT_CAP = 200_000;
const MIN_READABLE_CHARS = 200;

// shortcut: in-process job queue with a concurrency cap; move to Vercel Queues
// when multiple instances must share load.
const queue: Array<{ id: string; text?: string; done: () => void }> = [];
const inflight = new Map<string, Promise<void>>();
let running = 0;

export class PermanentJobError extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function jobInFlight(bookmarkId: string): boolean {
  return inflight.has(bookmarkId);
}

// Dedupes by bookmark id: scheduling while a job is queued or running returns
// the same promise, so pollers cannot grow the queue. Pasted text passed while
// the id is already in flight would be dropped, so it is rejected instead.
export function scheduleProcess(bookmarkId: string, opts: { text?: string } = {}): Promise<void> {
  const existing = inflight.get(bookmarkId);
  if (existing) {
    if (opts.text !== undefined) {
      throw apiError(409, "conflict", "This bookmark is already being processed.");
    }
    return existing;
  }
  let done = (): void => {};
  const promise = new Promise<void>((resolve) => {
    done = resolve;
  });
  inflight.set(bookmarkId, promise);
  queue.push({ id: bookmarkId, text: opts.text, done });
  void pump();
  return promise;
}

async function pump(): Promise<void> {
  while (running < CONCURRENCY && queue.length > 0) {
    const job = queue.shift()!;
    running++;
    processBookmark(job.id, job.text)
      .catch((err) => console.error("[shelfmark] processBookmark error:", err))
      .finally(() => {
        running--;
        inflight.delete(job.id);
        job.done();
        void pump();
      });
  }
}

export function normalizeWhitespace(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

async function obtainContent(
  bookmark: BookmarkRow,
  pastedText: string | undefined,
): Promise<{ text: string; extractedTitle: string | null }> {
  let raw: string;
  let extractedTitle: string | null = null;
  if (pastedText !== undefined) {
    raw = pastedText;
  } else if (bookmark.source_type === "text") {
    raw = bookmark.content_text ?? "";
  } else {
    let fetched;
    try {
      fetched = await safeFetch(bookmark.url ?? "");
    } catch (err) {
      if (err instanceof SafeFetchError && err.permanent) {
        throw new PermanentJobError(err.message);
      }
      throw err;
    }
    const extracted = extractReadable(fetched.body, fetched.contentType);
    raw = extracted.text;
    extractedTitle = extracted.title || null;
  }
  const text = normalizeWhitespace(raw).slice(0, CONTENT_CAP);
  if (bookmark.source_type === "url" && pastedText === undefined && text.length < MIN_READABLE_CHARS) {
    throw new PermanentJobError(
      "Could not extract enough readable text from this page (under 200 characters). Paste the text instead.",
    );
  }
  if (text.length === 0) {
    throw new PermanentJobError("No readable text found. Paste the text instead.");
  }
  return { text, extractedTitle };
}

async function runProcess(bookmark: BookmarkRow, pastedText?: string): Promise<void> {
  const { text, extractedTitle } = await obtainContent(bookmark, pastedText);
  const title =
    bookmark.source_type === "url" &&
    extractedTitle &&
    (bookmark.title === bookmark.domain || bookmark.title === bookmark.url)
      ? extractedTitle
      : bookmark.title;
  const chunks = chunkText(text);
  // A failed embedding call degrades to keyword-only indexing, same as an
  // unconfigured key — saving shouldn't fail on an AI outage.
  let embeddings: number[][] | null = null;
  try {
    embeddings = await embedTexts(chunks.map((c) => `${title}\n\n${c.text}`));
  } catch (err) {
    console.error("[shelfmark] embedding failed; indexing keyword-only:", err);
  }
  await transaction(async (tx) => {
    await tx("DELETE FROM passages WHERE bookmark_id = $1", [bookmark.id]);
    for (const [i, chunk] of chunks.entries()) {
      const vector = embeddings ? `[${embeddings[i].join(",")}]` : null;
      await tx(
        `INSERT INTO passages (bookmark_id, user_id, ordinal, text, char_start, char_end, tsv, embedding)
         VALUES ($1, $2, $3, $4, $5, $6, to_tsvector('english', $7), $8::vector)`,
        [bookmark.id, bookmark.user_id, i, chunk.text, chunk.charStart, chunk.charEnd, `${title} ${chunk.text}`, vector],
      );
    }
    const hash = bookmark.source_type === "text" ? contentHash(text) : bookmark.content_hash;
    try {
      await tx(
        `UPDATE bookmarks
         SET title = $2, content_text = $3, content_hash = $4, captured_at = now(),
             status = 'ready', error = NULL, updated_at = now()
         WHERE id = $1`,
        [bookmark.id, title, text, hash],
      );
    } catch (err) {
      if ((err as { code?: string }).code === "23505") {
        throw new PermanentJobError("Another bookmark already has this exact text.");
      }
      throw err;
    }
  });
}

export async function processBookmark(id: string, pastedText?: string): Promise<void> {
  const claimed = await query<BookmarkRow>(
    `UPDATE bookmarks
     SET status = 'processing', attempts = attempts + 1, processing_started_at = now(),
         error = NULL, updated_at = now()
     WHERE id = $1 AND status IN ('pending', 'failed')
     RETURNING *`,
    [id],
  );
  if (claimed.length === 0) return;
  const bookmark = claimed[0];
  let attempt = bookmark.attempts;
  try {
    while (true) {
      try {
        await runProcess(bookmark, pastedText);
        return;
      } catch (err) {
        if (err instanceof PermanentJobError) throw err;
        if (attempt >= MAX_ATTEMPTS) throw err;
        attempt += 1;
        await query("UPDATE bookmarks SET attempts = $2, updated_at = now() WHERE id = $1", [
          id,
          attempt,
        ]);
        await sleep(150 * attempt);
      }
    }
  } catch (err) {
    const message =
      err instanceof PermanentJobError
        ? err.message
        : "Failed to process this page. You can retry, or paste the text instead.";
    await query(
      `UPDATE bookmarks SET status = 'failed', error = $2, updated_at = now() WHERE id = $1`,
      [id, message],
    );
    if (!(err instanceof PermanentJobError)) {
      console.error("[shelfmark] processing failed:", err);
    }
  }
}

// Called from GET /api/bookmarks: re-queues this user's pending rows older
// than 1 minute and crashed `processing` rows older than 5 minutes.
export async function recoverStaleJobs(userId: string): Promise<void> {
  const stale = await query<{ id: string; status: string }>(
    `SELECT id, status FROM bookmarks
     WHERE user_id = $1 AND (
       (status = 'pending' AND created_at < now() - interval '1 minute') OR
       (status = 'processing' AND processing_started_at < now() - interval '5 minutes')
     )`,
    [userId],
  );
  const stuckProcessing = stale.filter((r) => r.status === "processing").map((r) => r.id);
  if (stuckProcessing.length > 0) {
    await query(
      `UPDATE bookmarks SET status = 'pending', updated_at = now()
       WHERE id = ANY (string_to_array($1, ',')::uuid[])`,
      [stuckProcessing.join(",")],
    );
  }
  await Promise.all(stale.map((row) => scheduleProcess(row.id)));
}
