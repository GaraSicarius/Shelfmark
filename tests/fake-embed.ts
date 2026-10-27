// Leaf module with no imports — safe to await inside vi.mock factories.
// Deterministic bag-of-words embedding into 1536 dims so semantic-path tests
// behave meaningfully without an API key.
export function fakeEmbed(text: string): number[] {
  const vec = new Array<number>(1536).fill(0);
  for (const word of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    let h = 0;
    for (const ch of word) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
    vec[h % 1536] += 1;
  }
  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}
