import { describe, expect, it } from "vitest";
import { createBookmark } from "@/lib/bookmarks";
import { normalizeUrl } from "@/lib/url";
import { createUser } from "./helpers";

describe("normalizeUrl", () => {
  it("lowercases host, drops fragment and tracking params, sorts query", () => {
    const out = normalizeUrl(
      "HTTPS://EXAMPLE.COM/Path/Page?utm_source=news&b=2&a=1&fbclid=abc#section",
    );
    expect(out).not.toBeNull();
    expect(out!.url).toBe("https://example.com/Path/Page?a=1&b=2");
    expect(out!.domain).toBe("example.com");
  });

  it("drops a trailing slash on non-root paths but keeps the root slash", () => {
    expect(normalizeUrl("https://example.com/a/b/")!.url).toBe("https://example.com/a/b");
    expect(normalizeUrl("https://example.com/")!.url).toBe("https://example.com/");
  });

  it("drops default ports and gclid", () => {
    expect(normalizeUrl("http://example.com:80/x?gclid=9")!.url).toBe("http://example.com/x");
    expect(normalizeUrl("https://example.com:443/x")!.url).toBe("https://example.com/x");
  });

  it("rejects non-http(s) and invalid input", () => {
    expect(normalizeUrl("ftp://example.com")).toBeNull();
    expect(normalizeUrl("not a url")).toBeNull();
  });
});

describe("duplicate detection (service layer)", () => {
  it("409s a re-saved normalized URL", async () => {
    const user = await createUser();
    const first = await createBookmark(user.id, { url: "https://DUP.example/Page?utm_medium=x" });
    const second = createBookmark(user.id, { url: "https://dup.example/Page" });
    await expect(second).rejects.toSatisfy(
      (r) => r instanceof Response && r.status === 409,
    );
    const err = await second.catch((r) => r);
    const body = await err.json();
    expect(body.error).toBe("duplicate");
    expect(body.bookmark.id).toBe(first.id);
  });

  it("409s identical pasted text", async () => {
    const user = await createUser();
    await createBookmark(user.id, { title: "Note", text: "the same words" });
    await expect(
      createBookmark(user.id, { title: "Note 2", text: "the same  words" }),
    ).rejects.toSatisfy((r) => r instanceof Response && r.status === 409);
  });

  it("allows the same URL for a different user", async () => {
    const a = await createUser();
    const b = await createUser();
    await createBookmark(a.id, { url: "https://shared.example/x" });
    const other = await createBookmark(b.id, { url: "https://shared.example/x" });
    expect(other.status).toBe("pending");
  });
});
