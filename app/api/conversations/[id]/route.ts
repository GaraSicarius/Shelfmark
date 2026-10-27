import { assertMutation, requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { notFound, route } from "@/lib/errors";
import { readConversation } from "@/lib/rag";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (req, ctx: Ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const result = await readConversation(user.id, id);
  if (!result) throw notFound();
  return Response.json(result);
});

export const DELETE = route(async (req, ctx: Ctx) => {
  const user = await requireUser(req);
  assertMutation(req);
  const { id } = await ctx.params;
  const rows = await query<{ id: string }>(
    "DELETE FROM conversations WHERE id = $1 AND user_id = $2 RETURNING id",
    [id, user.id],
  );
  if (rows.length === 0) throw notFound();
  return new Response(null, { status: 204 });
});
