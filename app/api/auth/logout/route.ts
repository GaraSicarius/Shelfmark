import { NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  assertMutation,
  destroySession,
  sessionCookieOptions,
  sessionTokenFrom,
} from "@/lib/auth";
import { route } from "@/lib/errors";

export const POST = route(async (req) => {
  assertMutation(req);
  const token = sessionTokenFrom(req);
  if (token) await destroySession(token);
  const res = new NextResponse(null, { status: 204 });
  res.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions(), maxAge: 0 });
  return res;
});
