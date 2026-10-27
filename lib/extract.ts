import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";

export interface Extracted {
  title: string;
  text: string;
}

// Readability first; falls back to <title> plus body text when parsing yields
// nothing. text/plain bodies pass through untouched.
export function extractReadable(body: string, contentType: string): Extracted {
  if (contentType === "text/plain") {
    return { title: "", text: body };
  }
  const { document } = parseHTML(body);
  try {
    const article = new Readability(document as never).parse();
    if (article?.textContent && article.textContent.trim().length > 0) {
      return { title: article.title?.trim() ?? "", text: article.textContent };
    }
  } catch {
    // fall through to the plain-DOM fallback
  }
  const title = document.querySelector("title")?.textContent?.trim() ?? "";
  const text = document.body?.textContent ?? "";
  return { title, text };
}
