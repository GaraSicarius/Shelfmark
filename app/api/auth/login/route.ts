import { NextResponse } from "next/server";
import { z } from "zod";
import {
  SESSION_COOKIE,
  assertMutation,
  clearLoginFailures,
  createSession,
  isLoginRateLimited,
  loginRateKey,
  recordLoginFailure,
  sessionCookieOptions,
  verifyPassword,
} from "@/lib/auth";
import { query } from "@/lib/db";
import { apiError, route, unauthorized } from "@/lib/errors";
import { parseBody, readJson } from "@/lib/validate";

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export const POST = route(async (req) => {
  assertMutation(req);
  const data = parseBody(loginSchema, await readJson(req));
  const rateKey = loginRateKey(data.email, req);
  if (isLoginRateLimited(rateKey)) {
    throw apiError(429, "rate_limited", "Too many failed attempts. Try again later.");
  }

  const rows = await query<{ id: string; email: string; password_hash: string }>(
    "SELECT id, email, password_hash FROM users WHERE lower(email) = lower($1)",
    [data.email.trim()],
  );
  const user = rows[0];
  if (!user || !verifyPassword(data.password, user.password_hash)) {
    recordLoginFailure(rateKey);
    throw unauthorized();
  }
  clearLoginFailures(rateKey);

  const { token } = await createSession(user.id);
  const res = NextResponse.json({ user: { id: user.id, email: user.email } });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return res;
});
