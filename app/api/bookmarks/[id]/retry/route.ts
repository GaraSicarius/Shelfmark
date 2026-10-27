import { after } from "next/server";
import { z } from "zod";
import { assertMutation, requireUser } from "@/lib/auth";
import { retryBookmark } from "@/lib/bookmarks";
import { route } from "@/lib/errors";
import { scheduleProcess } from "@/lib/jobs";
import { bookmarkResponse } from "@/lib/library";
import { parseBody, readJson } from "@/lib/validate";

const retrySchema = z
  .object({ text: z.string().min(1).max(300_000).optional() })
  .optional();

export const POST = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser(req);
  assertMutation(req);
  const { id } = await ctx.params;
  const data = parseBody(retrySchema, await readJson(req));
  const row = await retryBookmark(user.id, id, data?.text);
  // Deduped: returns the in-flight promise the service already scheduled, so
  // the platform keeps the function alive until the job completes.
  after(() => scheduleProcess(id));
  return Response.json({ bookmark: await bookmarkResponse(user.id, row) }, { status: 202 });
});
