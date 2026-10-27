export interface Chunk {
  text: string;
  charStart: number;
  charEnd: number;
}

const PARAGRAPH = "\n\n";
const SENTENCE_ENDS = [". ", "! ", "? ", ".\n", "!\n", "?\n"];
const ANY_BREAK = ["\n", " ", "\t"];

// Returns 0 when nothing matches so the caller's `a || b || c` fallthrough and
// `cut > 0` guard work; -1 would be truthy and hard-cut mid-word.
function lastBreakAt(haystack: string, needles: string[], minPos: number): number {
  let best = 0;
  for (const needle of needles) {
    const idx = haystack.lastIndexOf(needle);
    if (idx >= minPos) best = Math.max(best, idx + needle.length);
  }
  return best;
}

// Splits content into ~target-char chunks on paragraph/sentence boundaries with
// ~overlap-char overlap. Offsets are exact: content.slice(charStart, charEnd) === text.
export function chunkText(content: string, target = 1000, overlap = 150): Chunk[] {
  const chunks: Chunk[] = [];
  const n = content.length;
  if (n === 0) return chunks;
  const minKeep = Math.floor(target * 0.5);
  let start = 0;

  while (start < n) {
    let end = Math.min(start + target, n);
    if (end < n) {
      const window = content.slice(start, end);
      const cut =
        lastBreakAt(window, [PARAGRAPH], minKeep) ||
        lastBreakAt(window, SENTENCE_ENDS, minKeep) ||
        lastBreakAt(window, ANY_BREAK, 1);
      if (cut > 0) end = start + cut;
    }

    let s = start;
    let e = end;
    while (s < e && /\s/.test(content[s])) s++;
    while (e > s && /\s/.test(content[e - 1])) e--;

    if (e > s) {
      chunks.push({ text: content.slice(s, e), charStart: s, charEnd: e });
      if (end >= n) break; // remainder consumed; overlap slivers have no next chunk
      start = Math.max(e - overlap, s + 1);
      // The overlap rewind can land mid-word; advance to the next boundary so
      // chunks never begin inside a word.
      if (start > 0 && start < n && !/\s/.test(content[start - 1]) && !/\s/.test(content[start])) {
        while (start < n && !/\s/.test(content[start])) start++;
      }
      while (start < n && /\s/.test(content[start])) start++;
      if (start <= s) start = s + 1;
    } else {
      start = Math.max(end, s + 1);
    }
  }
  return chunks;
}
