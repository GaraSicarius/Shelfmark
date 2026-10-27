import { after } from "next/server";
import { z } from "zod";
import { assertMutation, requireUser } from "@/lib/auth";
import { createBookmark } from "@/lib/bookmarks";
import { query } from "@/lib/db";
import { route } from "@/lib/errors";
import { recoverStaleJobs, scheduleProcess } from "@/lib/jobs";
import { bookmarkResponse, semanticIndexedSet, tagsByBookmark } from "@/lib/library";
import { bookmarkJson, type BookmarkRow } from "@/lib/serialize";
import { filterParams, parseBody, readJson } from "@/lib/validate";

export const GET = route(async (req) => {
  const user = await requireUser(req);
  after(() => recoverStaleJobs(user.id));

  const params = new URL(req.url).searchParams;
  const args: unknown[] = [user.id];
  let sql = `SELECT b.*, c.name AS collection_name
    FROM bookmarks b LEFT JOIN collections c ON c.id = b.collection_id
    WHERE b.user_id = $1`;
  const { collectionId, tag, from, to, status } = filterParams(params);
  if (collectionId) {
    args.push(collectionId);
    sql += ` AND b.collection_id = $${args.length}`;
  }
  if (tag) {
    args.push(tag);
    sql += ` AND EXISTS (
      SELECT 1 FROM bookmark_tags bt JOIN tags t ON t.id = bt.tag_id
      WHERE bt.bookmark_id = b.id AND lower(t.name) = lower($${args.length})
    )`;
  }
  if (from) {
    args.push(from);
    sql += ` AND b.created_at >= $${args.length}::date`;
  }
  if (to) {
    args.push(to);
    sql += ` AND b.created_at < ($${args.length}::date + 1)`;
  }
  if (status) {
    args.push(status);
    sql += ` AND b.status = $${args.length}`;
  }
  sql += " ORDER BY b.created_at DESC";

  const rows = await query<BookmarkRow>(sql, args);
  const [tags, sem] = await Promise.all([tagsByBookmark(user.id), semanticIndexedSet(user.id)]);
  return Response.json({
    bookmarks: rows.map((row) => bookmarkJson(row, tags.get(row.id) ?? [], sem.has(row.id))),
  });
});

const createSchema = z
  .object({
    url: z.string().min(1).max(4000).optional(),
    text: z.string().min(1).max(300_000).optional(),
    title: z.string().min(1).max(500).optional(),
    note: z.string().max(5000).optional(),
    collectionId: z.uuid().optional(),
    tags: z.array(z.string().min(1).max(100)).max(50).optional(),
  })
  .refine((d) => (d.url === undefined) !== (d.text === undefined), {
    message: "Exactly one of url or text is required.",
  })
  .refine((d) => d.text === undefined || d.title !== undefined, {
    message: "title is required when saving text.",
  });

export const POST = route(async (req) => {
  const user = await requireUser(req);
  assertMutation(req);
  const data = parseBody(createSchema, await readJson(req));
  const row = await createBookmark(user.id, data);
  after(() => scheduleProcess(row.id));
  return Response.json({ bookmark: await bookmarkResponse(user.id, row) }, { status: 201 });
});
