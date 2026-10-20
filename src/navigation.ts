export const pages = [
  "login",
  "dashboard",
  "feature-1",
  "feature-2",
  "feature-3",
] as const;
export type Page = (typeof pages)[number];

export function readPage(hash: string): Page {
  const page = hash.replace(/^#\/?/, "");
  return pages.includes(page as Page) ? (page as Page) : "login";
}
