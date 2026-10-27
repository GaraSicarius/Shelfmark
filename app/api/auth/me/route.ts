import { requireUser } from "@/lib/auth";
import { route } from "@/lib/errors";

export const GET = route(async (req) => {
  const user = await requireUser(req);
  return Response.json({ user });
});
