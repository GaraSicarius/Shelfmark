import { NextResponse } from "next/server";
import { z } from "zod";
import {
  SESSION_COOKIE,
  assertMutation,
  createSession,
  hashPassword,
  sessionCookieOptions,
} from "@/lib/auth";
import { query } from "@/lib/db";
import { apiError, route } from "@/lib/errors";
import { parseBody, readJson } from "@/lib/validate";

const signupSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
});

export const POST = route(async (req) => {
  assertMutation(req);
  const data = parseBody(signupSchema, await readJson(req));
  const email = data.email.trim().toLowerCase();

  let user: { id: string; email: string };
  try {
    const rows = await query<{ id: string; email: string }>(
      "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email",
      [email, hashPassword(data.password)],
    );
    user = rows[0];
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      throw apiError(409, "duplicate", "An account with this email already exists.");
    }
    throw err;
  }

  const { token } = await createSession(user.id);
  const res = NextResponse.json({ user: { id: user.id, email: user.email } }, { status: 201 });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return res;
});
