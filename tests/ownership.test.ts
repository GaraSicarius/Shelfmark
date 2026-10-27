import { describe, expect, it } from "vitest";
import {
  createBookmark,
  deleteBookmark,
  patchBookmark,
  retryBookmark,
} from "@/lib/bookmarks";
import { query } from "@/lib/db";
import { getBookmarkRow } from "@/lib/library";
import { ask, readConversation } from "@/lib/rag";
import { createCollection, createUser } from "./helpers";

const is404 = (r: unknown) => r instanceof Response && r.status === 404;

describe("ownership at the service layer", () => {
  it("user B gets not-found for user A's bookmark and conversation", async () => {
    const a = await createUser();
    const b = await createUser();

    const bookmark = await createBookmark(a.id, { title: "A note", text: "private words" });
    const convRows = await query<{ id: string }>(
      "INSERT INTO conversations (user_id, title) VALUES ($1, $2) RETURNING id",
      [a.id, "A's conversation"],
    );
    const conversationId = convRows[0].id;

    expect(await getBookmarkRow(b.id, bookmark.id)).toBeNull();
    await expect(patchBookmark(b.id, bookmark.id, { title: "hijack" })).rejects.toSatisfy(is404);
    await expect(deleteBookmark(b.id, bookmark.id)).rejects.toSatisfy(is404);
    await expect(retryBookmark(b.id, bookmark.id)).rejects.toSatisfy(is404);
    expect(await readConversation(b.id, conversationId)).toBeNull();
    await expect(ask(b.id, { question: "hi", conversationId })).rejects.toSatisfy(is404);
  });

  it("rejects a foreign collectionId even with the user's own conversationId", async () => {
    const a = await createUser();
    const b = await createUser();
    const aCollection = await createCollection(a.id, "A's collection");
    const convRows = await query<{ id: string }>(
      "INSERT INTO conversations (user_id, title) VALUES ($1, $2) RETURNING id",
      [b.id, "B's conversation"],
    );
    await expect(
      ask(b.id, {
        question: "hi",
        conversationId: convRows[0].id,
        collectionId: aCollection,
      }),
    ).rejects.toSatisfy(is404);
  });
});
