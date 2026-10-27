import { z } from "zod";
import { assertMutation, requireUser } from "@/lib/auth";
import { route } from "@/lib/errors";
import { ask } from "@/lib/rag";
import { parseBody, readJson } from "@/lib/validate";

export const maxDuration = 60;

const askSchema = z.object({
  question: z.string().min(1).max(2000),
  conversationId: z.uuid().optional(),
  collectionId: z.uuid().optional(),
});

export const POST = route(async (req) => {
  const user = await requireUser(req);
  assertMutation(req);
  const data = parseBody(askSchema, await readJson(req));
  const result = await ask(user.id, data);
  return Response.json(result);
});
