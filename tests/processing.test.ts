import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai", async () => {
  const { fakeEmbed } = await import("./fake-embed");
  return {
    aiConfigured: vi.fn(() => true),
    chatModel: vi.fn(() => "mock-model"),
    embedTexts: vi.fn(async (texts: string[]) => texts.map(fakeEmbed)),
    EMBEDDING_MODEL: "mock",
  };
});

import { embedTexts } from "@/lib/ai";
import { createBookmark, retryBookmark } from "@/lib/bookmarks";
import { query } from "@/lib/db";
import { processBookmark } from "@/lib/jobs";
import { getBookmarkRow, semanticIndexedSet } from "@/lib/library";
import { createUser, waitForStatus } from "./helpers";

const longText =
  "A free course about AWS certification exams. " +
  "It covers exam domains, practice questions, and study plans. ".repeat(30);

describe("processing", () => {
  it("pasted text -> ready with passages and embeddings", async () => {
    const user = await createUser();
    const row = await createBookmark(user.id, { title: "My note", text: longText });
    await processBookmark(row.id);
    const done = await getBookmarkRow(user.id, row.id);
    expect(done?.status).toBe("ready");
    expect(done?.content_text).toContain("AWS certification");

    const passages = await query<{ text: string; embedding: string | null }>(
      "SELECT text, embedding FROM passages WHERE bookmark_id = $1 ORDER BY ordinal",
      [row.id],
    );
    expect(passages.length).toBeGreaterThan(0);
    expect(passages.every((p) => p.embedding !== null)).toBe(true);
    for (const p of passages) {
      expect(done!.content_text).toContain(p.text);
    }
    expect((await semanticIndexedSet(user.id)).has(row.id)).toBe(true);
  });

  it("embedding outage -> still ready, indexed keyword-only", async () => {
    vi.mocked(embedTexts).mockRejectedValueOnce(new Error("gateway down"));
    const user = await createUser();
    const row = await createBookmark(user.id, { title: "My note", text: longText });
    await processBookmark(row.id);
    const done = await getBookmarkRow(user.id, row.id);
    expect(done?.status).toBe("ready");

    const passages = await query<{ embedding: string | null }>(
      "SELECT embedding FROM passages WHERE bookmark_id = $1",
      [row.id],
    );
    expect(passages.length).toBeGreaterThan(0);
    expect(passages.every((p) => p.embedding === null)).toBe(true);
    expect((await semanticIndexedSet(user.id)).has(row.id)).toBe(false);
  });

  it("blocked URL -> failed with a readable error", async () => {
    const user = await createUser();
    const row = await createBookmark(user.id, { url: "http://127.0.0.1/" });
    await processBookmark(row.id);
    const done = await getBookmarkRow(user.id, row.id);
    expect(done?.status).toBe("failed");
    expect(done?.error).toBe("This address is not reachable from this app.");
  });

  it("retry with pasted text -> ready", async () => {
    const user = await createUser();
    const row = await createBookmark(user.id, { url: "http://127.0.0.1/" });
    await processBookmark(row.id);
    expect((await getBookmarkRow(user.id, row.id))?.status).toBe("failed");

    await retryBookmark(user.id, row.id, longText);
    const done = await waitForStatus(user.id, row.id, ["ready", "failed"]);
    expect(done.status).toBe("ready");
    expect(done.error).toBeNull();
    expect(done.content_text).toContain("AWS certification");
  });
});
