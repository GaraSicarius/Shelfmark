import type { ReactNode } from "react";
import { createElement, Fragment } from "react";

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function queryWords(query: string): string[] {
  return (query.match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 12);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Returns { from, to, nodes }: the excerpt window and the same window with
// query-word prefix matches wrapped in <mark> (case-insensitive).
export function excerptWithMarks(
  text: string,
  query: string,
  windowSize = 280,
): { prefix: string; suffix: string; nodes: ReactNode } {
  const words = queryWords(query).map(escapeRegExp);
  let start = 0;
  if (words.length > 0 && text.length > windowSize) {
    const first = new RegExp(`\\b(?:${words.join("|")})`, "iu").exec(text);
    if (first) start = Math.max(0, first.index - 60);
  }
  const end = Math.min(text.length, start + windowSize);
  const slice = text.slice(start, end);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  if (words.length === 0) {
    return { prefix, suffix, nodes: createElement(Fragment, null, slice) };
  }
  const re = new RegExp(`(\\b(?:${words.join("|")})[\\p{L}\\p{N}]*)`, "giu");
  const parts = slice.split(re);
  const nodes = parts.map((part, i) =>
    i % 2 === 1 ? createElement("mark", { key: i }, part) : createElement(Fragment, { key: i }, part),
  );
  return { prefix, suffix, nodes };
}
