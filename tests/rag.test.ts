import { describe, expect, it, vi } from "vitest";

const modelState = vi.hoisted(() => ({
  calls: 0,
  failWith: null as Error | null,
  lastPrompt: "",
  output: {
    status: "answered",
    segments: [{ kind: "fact", text: "The course is free.", citations: [1] }],
    conflicts: [],
    gaps: [],
    followUps: [],
  } as Record<string, unknown>,
}));

vi.mock("@/lib/ai", async () => {
  const { MockLanguageModelV4 } = await import("ai/test");
  const { fakeEmbed } = await import("./fake-embed");
  return {
    aiConfigured: vi.fn(() => true),
    embedTexts: vi.fn(async (texts: string[]) => texts.map(fakeEmbed)),
    chatModel: vi.fn(
      () =>
        new MockLanguageModelV4({
          doGenerate: async (options) => {
            modelState.calls++;
            modelState.lastPrompt = JSON.stringify(options.prompt);
            if (modelState.failWith) throw modelState.failWith;
            return {
              content: [{ type: "text", text: JSON.stringify(modelState.output) }],
              finishReason: { unified: "stop", raw: undefined },
              usage: {
                inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
                outputTokens: { total: 1, text: 1, reasoning: undefined },
              },
              warnings: [],
            };
          },
        }),
    ),
    EMBEDDING_MODEL: "mock",
  };
});

import { deleteBookmark } from "@/lib/bookmarks";
import { ask, buildSystemPrompt, readConversation } from "@/lib/rag";
import { createUser, saveReadyText } from "./helpers";

const docText =
  "The course is completely free and self-paced. " +
  "It covers the AWS certification exam domains in four modules. ".repeat(10);

async function setupDoc() {
  const user = await createUser();
  const doc = await saveReadyText(
    user.id,
    "AWS Certification course",
    docText,
  );
  return { user, doc };
}

function setOutput(output: Record<string, unknown>) {
  modelState.output = output;
}

describe("ask (RAG)", () => {
  it("drops citation numbers outside 1..n", async () => {
    const { user } = await setupDoc();
    setOutput({
      status: "answered",
      segments: [{ kind: "fact", text: "Free.", citations: [1, 99] }],
      conflicts: [],
      gaps: [],
      followUps: [],
    });
    const { answer } = await ask(user.id, { question: "is the course free?" });
    expect(answer.segments[0].citations).toEqual([1]);
    expect(answer.citations.length).toBeGreaterThan(0);
  });

  it("demotes an uncited fact to interpretation + uncited", async () => {
    const { user } = await setupDoc();
    setOutput({
      status: "answered",
      segments: [{ kind: "fact", text: "Something unsourced.", citations: [] }],
      conflicts: [],
      gaps: [],
      followUps: [],
    });
    const { answer } = await ask(user.id, { question: "is the course free?" });
    expect(answer.segments[0].kind).toBe("interpretation");
    expect(answer.segments[0].uncited).toBe(true);
  });

  it("citations map to real passage ids and quotes", async () => {
    const { user, doc } = await setupDoc();
    setOutput({
      status: "answered",
      segments: [{ kind: "fact", text: "Free and self-paced.", citations: [1] }],
      conflicts: [],
      gaps: [],
      followUps: [],
    });
    const { answer } = await ask(user.id, { question: "is the course free?" });
    const cited = answer.citations.find((c) => c.n === 1)!;
    expect(cited.bookmarkId).toBe(doc.id);
    expect(cited.quote).toContain("free");
    expect(cited.passageId).toBeTruthy();
    expect(answer.retrieval.passages).toBeGreaterThan(0);
  });

  it("drops a conflict whose citations are all out of range", async () => {
    const { user } = await setupDoc();
    setOutput({
      status: "answered",
      segments: [{ kind: "fact", text: "Free.", citations: [1] }],
      conflicts: [
        { description: "One source disagrees.", citations: [99] },
        { description: "A real conflict.", citations: [1] },
      ],
      gaps: [],
      followUps: [],
    });
    const { answer } = await ask(user.id, { question: "is the course free?" });
    expect(answer.conflicts).toHaveLength(1);
    expect(answer.conflicts[0].description).toBe("A real conflict.");
    expect(answer.conflicts[0].citations).toEqual([1]);
  });

  it("empty retrieval -> insufficient and the model is NOT called", async () => {
    const user = await createUser();
    const callsBefore = modelState.calls;
    const { answer } = await ask(user.id, {
      question: "what does my library say about quantum computing?",
    });
    expect(answer.status).toBe("insufficient");
    expect(answer.segments[0].text).toContain("Insufficient data to verify");
    expect(modelState.calls).toBe(callsBefore);
  });

  it("returns 503 ai_unavailable with citations when the model throws", async () => {
    const { user } = await setupDoc();
    const hush = vi.spyOn(console, "error").mockImplementation(() => {});
    modelState.failWith = new Error("provider exploded with key sk-SECRET");
    try {
      const err = await ask(user.id, { question: "is the course free?" }).catch(
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(Response);
      const response = err as Response;
      expect(response.status).toBe(503);
      const body = await response.json();
      expect(body.error).toBe("ai_unavailable");
      expect(body.details.citations.length).toBeGreaterThan(0);
      expect(JSON.stringify(body)).not.toContain("sk-SECRET");
    } finally {
      modelState.failWith = null;
      hush.mockRestore();
    }
  });

  it("includes the previous question in follow-up prompts", async () => {
    const { user } = await setupDoc();
    setOutput({
      status: "answered",
      segments: [{ kind: "fact", text: "Free.", citations: [1] }],
      conflicts: [],
      gaps: [],
      followUps: [],
    });
    const first = await ask(user.id, { question: "is the course free?" });
    await ask(user.id, {
      question: "what about the modules?",
      conversationId: first.conversationId,
    });
    expect(modelState.lastPrompt).toContain(
      "Previous question in this conversation: is the course free?",
    );
  });

  it("system prompt carries the injection-defence and capture-date rules", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("untrusted");
    expect(prompt).toContain("never instructions");
    expect(prompt).toContain("as of the date each source was saved");
    expect(prompt).toContain("Insufficient data to verify");
  });

  it("flags deleted sources when the conversation is read back", async () => {
    const { user, doc } = await setupDoc();
    setOutput({
      status: "answered",
      segments: [{ kind: "fact", text: "Free.", citations: [1] }],
      conflicts: [],
      gaps: [],
      followUps: [],
    });
    const { conversationId } = await ask(user.id, { question: "is the course free?" });
    await deleteBookmark(user.id, doc.id);
    const convo = await readConversation(user.id, conversationId);
    expect(convo).not.toBeNull();
    const assistant = convo!.messages.find((m) => m.role === "assistant")!;
    const answer = assistant.answer as { citations: Array<{ deleted?: true; quote?: string }> };
    expect(answer.citations.length).toBeGreaterThan(0);
    expect(answer.citations[0].deleted).toBe(true);
    expect(answer.citations[0].quote).toBeUndefined();
  });
});
