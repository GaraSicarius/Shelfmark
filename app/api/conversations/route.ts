import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { route } from "@/lib/errors";
import { toIso } from "@/lib/serialize";

export const GET = route(async (req) => {
  const user = await requireUser(req);
  const rows = await query<{
    id: string;
    title: string | null;
    collection_id: string | null;
    updated_at: unknown;
  }>(
    "SELECT id, title, collection_id, updated_at FROM conversations WHERE user_id = $1 ORDER BY updated_at DESC",
    [user.id],
  );
  return Response.json({
    conversations: rows.map((r) => ({
      id: r.id,
      title: r.title,
      collectionId: r.collection_id,
      updatedAt: toIso(r.updated_at),
    })),
  });
});
