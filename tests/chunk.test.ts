import { describe, expect, it } from "vitest";
import { chunkText } from "@/lib/chunk";

const paragraph = (i: number) =>
  `Paragraph ${i}. ` + "Some longer sentence content that fills space. ".repeat(12);

const bigText = Array.from({ length: 8 }, (_, i) => paragraph(i)).join("\n\n");

describe("chunkText", () => {
  it("produces exact slices into the source", () => {
    for (const chunk of chunkText(bigText)) {
      expect(bigText.slice(chunk.charStart, chunk.charEnd)).toBe(chunk.text);
    }
  });

  it("keeps chunks around the target size", () => {
    const chunks = chunkText(bigText);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks.slice(0, -1)) {
      expect(chunk.text.length).toBeLessThanOrEqual(1100);
      expect(chunk.text.length).toBeGreaterThanOrEqual(200);
    }
  });

  it("overlaps consecutive chunks", () => {
    const chunks = chunkText(bigText);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].charStart).toBeLessThan(chunks[i - 1].charEnd);
      // and the overlapping region is real shared text
      const overlapStart = chunks[i].charStart;
      expect(chunks[i - 1].charEnd - overlapStart).toBeGreaterThan(0);
    }
  });

  it("handles short and empty input", () => {
    expect(chunkText("")).toEqual([]);
    const tiny = chunkText("tiny text");
    expect(tiny).toHaveLength(1);
    expect(tiny[0].charStart).toBe(0);
    expect(tiny[0].charEnd).toBe(9);
  });

  it("cuts on sentence boundaries when there are no paragraph breaks", () => {
    const text =
      "Every sentence here is complete and ends with proper punctuation. ".repeat(50);
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks.slice(0, -1)) {
      expect(chunk.text).toMatch(/[.!?]$/);
    }
    for (const chunk of chunks) {
      expect(text.slice(chunk.charStart, chunk.charEnd)).toBe(chunk.text);
    }
  });

  it("cuts on word boundaries when there is no sentence punctuation", () => {
    const words = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"];
    const text = Array.from({ length: 400 }, (_, i) => words[i % words.length]).join(" ");
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks.slice(0, -1)) {
      expect(/\s/.test(text[chunk.charEnd] ?? " ")).toBe(true);
    }
    for (const chunk of chunks.slice(1)) {
      expect(chunk.charStart === 0 || /\s/.test(text[chunk.charStart - 1])).toBe(true);
    }
    for (const chunk of chunks) {
      expect(text.slice(chunk.charStart, chunk.charEnd)).toBe(chunk.text);
    }
  });
});
