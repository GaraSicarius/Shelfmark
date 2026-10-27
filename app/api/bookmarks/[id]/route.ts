import { z } from "zod";
import { assertMutation, requireUser } from "@/lib/auth";
import { deleteBookmark, patchBookmark } from "@/lib/bookmarks";
import { query } from "@/lib/db";
import { notFound, route } from "@/lib/errors";
import { bookmarkResponse, getBookmarkRow } from "@/lib/library";
import { parseBody, readJson } from "@/lib/validate";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (req, ctx: Ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const row = await getBookmarkRow(user.id, id);
  if (!row) throw notFound();
  const passages = await query<{
    id: string;
    ordinal: number;
    text: string;
    char_start: number;
    char_end: number;
  }>(
    "SELECT id, ordinal, text, char_start, char_end FROM passages WHERE bookmark_id = $1 ORDER BY ordinal",
    [id],
  );
  return Response.json({
    bookmark: { ...(await bookmarkResponse(user.id, row)), contentText: row.content_text },
    passages: passages.map((p) => ({
      id: p.id,
      ordinal: p.ordinal,
      text: p.text,
      charStart: p.char_start,
      charEnd: p.char_end,
    })),
  });
});

const patchSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  note: z.string().max(5000).nullable().optional(),
  collectionId: z.uuid().nullable().optional(),
  tags: z.array(z.string().min(1).max(100)).max(50).optional(),
});

export const PATCH = route(async (req, ctx: Ctx) => {
  const user = await requireUser(req);
  assertMutation(req);
  const { id } = await ctx.params;
  const data = parseBody(patchSchema, await readJson(req));
  const row = await patchBookmark(user.id, id, data);
  return Response.json({ bookmark: await bookmarkResponse(user.id, row) });
});

export const DELETE = route(async (req, ctx: Ctx) => {
  const user = await requireUser(req);
  assertMutation(req);
  const { id } = await ctx.params;
  await deleteBookmark(user.id, id);
  return new Response(null, { status: 204 });
});
