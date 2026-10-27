import { hashPassword } from "@/lib/auth";
import { createBookmark, type CreateBookmarkInput } from "@/lib/bookmarks";
import { query } from "@/lib/db";
import { processBookmark } from "@/lib/jobs";
import { getBookmarkRow } from "@/lib/library";
import type { BookmarkRow } from "@/lib/serialize";

let counter = 0;

export async function createUser(email?: string): Promise<{ id: string; email: string }> {
  const address = email ?? `user${++counter}-${Date.now()}@test.dev`;
  const rows = await query<{ id: string; email: string }>(
    "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email",
    [address.toLowerCase(), hashPassword("password-123")],
  );
  return rows[0];
}

export async function createCollection(userId: string, name: string): Promise<string> {
  const rows = await query<{ id: string }>(
    "INSERT INTO collections (user_id, name) VALUES ($1, $2) RETURNING id",
    [userId, name],
  );
  return rows[0].id;
}

export async function saveReadyText(
  userId: string,
  title: string,
  text: string,
  extra: Partial<CreateBookmarkInput> = {},
): Promise<BookmarkRow> {
  const row = await createBookmark(userId, { text, title, ...extra });
  await processBookmark(row.id);
  const ready = await getBookmarkRow(userId, row.id);
  return ready!;
}

export async function waitForStatus(
  userId: string,
  id: string,
  statuses: string[],
  timeoutMs = 15_000,
): Promise<BookmarkRow> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = await getBookmarkRow(userId, id);
    if (row && statuses.includes(row.status)) return row;
    await new Promise((r) => setTimeout(r, 100));
  }
  const row = await getBookmarkRow(userId, id);
  throw new Error(`Timed out waiting for ${statuses.join("/")}; status=${row?.status} error=${row?.error}`);
}

export { fakeEmbed } from "./fake-embed";
