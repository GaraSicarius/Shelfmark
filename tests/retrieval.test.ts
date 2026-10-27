import { beforeAll, describe, expect, it, vi } from "vitest";

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
import { deleteBookmark } from "@/lib/bookmarks";
import { retrievePassages } from "@/lib/retrieval";
import {
  createCollection,
  createUser,
  saveReadyText,
} from "./helpers";

let userA: { id: string; email: string };
let userB: { id: string; email: string };
let coll: string;
let certDoc: string;
let pastaDoc: string;
let courseDoc: string;
let bDoc: string;

beforeAll(async () => {
  userA = await createUser();
  userB = await createUser();
  coll = await createCollection(userA.id, "Learning");

  certDoc = (
    await saveReadyText(
      userA.id,
      "AWS Certification notes",
      "A free course covering the AWS certification exam. " +
        "It includes practice questions, study plans, and exam domain summaries.",
    )
  ).id;
  pastaDoc = (
    await saveReadyText(
      userA.id,
      "Pasta recipe",
      "A recipe for pasta with fresh tomatoes, basil, garlic, and olive oil.",
    )
  ).id;
  courseDoc = (
    await saveReadyText(
      userA.id,
      "Python course",
      "Another free course about python programming for beginners.",
      { collectionId: coll },
    )
  ).id;
  bDoc = (
    await saveReadyText(
      userB.id,
      "B's private note",
      "Secret certification material belonging to user B only.",
    )
  ).id;
});

describe("retrievePassages", () => {
  it("prefix query: 'certif' matches a Certification document", async () => {
    const { passages } = await retrievePassages(userA.id, "certif");
    expect(passages.map((p) => p.bookmarkId)).toContain(certDoc);
  });

  it("OR query: 'that free course I saved' matches course docs", async () => {
    const { passages } = await retrievePassages(userA.id, "that free course I saved");
    const ids = passages.map((p) => p.bookmarkId);
    expect(ids).toContain(certDoc);
    expect(ids).toContain(courseDoc);
    expect(ids).not.toContain(bDoc);
  });

  it("collection filter restricts results", async () => {
    const { passages } = await retrievePassages(userA.id, "course", {
      collectionId: coll,
    });
    expect(passages.length).toBeGreaterThan(0);
    expect(new Set(passages.map((p) => p.bookmarkId))).toEqual(new Set([courseDoc]));
  });

  it("user B cannot retrieve user A's passages", async () => {
    const { passages } = await retrievePassages(userB.id, "certification free course");
    const ids = passages.map((p) => p.bookmarkId);
    expect(ids).toContain(bDoc);
    expect(ids).not.toContain(certDoc);
    expect(ids).not.toContain(courseDoc);
    expect(ids).not.toContain(pastaDoc);
  });

  it("a deleted bookmark is never retrieved", async () => {
    await deleteBookmark(userA.id, pastaDoc);
    const { passages } = await retrievePassages(userA.id, "pasta recipe tomato");
    expect(passages.map((p) => p.bookmarkId)).not.toContain(pastaDoc);
  });

  it("no-AI mode returns keyword results with semantic=false", async () => {
    vi.mocked(embedTexts).mockResolvedValueOnce(null);
    const { passages, semantic } = await retrievePassages(userA.id, "certification");
    expect(semantic).toBe(false);
    expect(passages.map((p) => p.bookmarkId)).toContain(certDoc);
  });
});
