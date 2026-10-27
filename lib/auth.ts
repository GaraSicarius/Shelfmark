import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { query } from "@/lib/db";
import { forbidden, unauthorized } from "@/lib/errors";

export const SESSION_COOKIE = "session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltHex, hashHex] = parts;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return timingSafeEqual(actual, expected);
}

function sha256hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const id = sha256hex(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await query("INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3)", [
    id,
    userId,
    expiresAt,
  ]);
  return { token, expiresAt };
}

export async function destroySession(token: string): Promise<void> {
  await query("DELETE FROM sessions WHERE id = $1", [sha256hex(token)]);
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  };
}

export function sessionTokenFrom(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return rest.join("=");
  }
  return null;
}

export interface SessionUser {
  id: string;
  email: string;
}

export async function requireUser(request: Request): Promise<SessionUser> {
  const token = sessionTokenFrom(request);
  if (!token) throw unauthorized();
  const rows = await query<{ id: string; email: string }>(
    `SELECT u.id, u.email FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = $1 AND s.expires_at > now()`,
    [sha256hex(token)],
  );
  if (rows.length === 0) throw unauthorized();
  return rows[0];
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) return;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw forbidden("Bad Origin header.");
  }
  const host = request.headers.get("host") ?? new URL(request.url).host;
  if (originHost !== host) throw forbidden("Cross-origin request rejected.");
}

// Mutations must be JSON and same-origin (CSRF defence alongside SameSite=Lax).
// DELETE may omit a body, so it is exempt from the content-type check.
export function assertMutation(request: Request): void {
  assertSameOrigin(request);
  if (request.method === "DELETE") return;
  const ct = request.headers.get("content-type") ?? "";
  if (!ct.toLowerCase().startsWith("application/json")) {
    throw forbidden("Mutations require Content-Type: application/json.");
  }
}

// shortcut: per-instance in-memory rate limit; move to Redis/DB for multi-instance deploys.
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 10;
const loginAttempts = new Map<string, { failures: number; resetAt: number }>();

export function loginRateKey(email: string, request: Request): string {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  return `${email.toLowerCase()}|${ip}`;
}

export function isLoginRateLimited(key: string): boolean {
  const entry = loginAttempts.get(key);
  if (!entry) return false;
  if (Date.now() > entry.resetAt) {
    loginAttempts.delete(key);
    return false;
  }
  return entry.failures >= LOGIN_MAX_FAILURES;
}

export function recordLoginFailure(key: string): void {
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(key, { failures: 1, resetAt: now + LOGIN_WINDOW_MS });
  } else {
    entry.failures += 1;
  }
}

export function clearLoginFailures(key: string): void {
  loginAttempts.delete(key);
}
